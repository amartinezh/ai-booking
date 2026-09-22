/* eslint-disable @typescript-eslint/no-explicit-any -- el doble de la base es una tabla en memoria: sus filas son de forma libre */
import { permisosBandeja, type ActorBandeja, type RolBandeja } from './acceso';
import {
  MAX_ACTIVAS,
  MAX_NOTA,
  MSG_ACCION_INVALIDA,
  MSG_CAMBIO_CONCURRENTE,
  MSG_NOTA_LARGA,
  MSG_NO_ENCONTRADA,
  MSG_NO_GUARDADA,
  MSG_NUMERO_INVALIDO,
  MSG_RESPALDO_IGUAL,
  MSG_RESPALDO_SIN_AGENDADOR,
  MSG_SIN_ESPEJO,
  TAMANO_PAGINA,
  aplicarAccion,
  contarPendientes,
  detalleExcepcion,
  estadoAvisos,
  guardarAvisos,
  listarExcepciones,
  resumenBandeja,
} from './servicio';
import { MSG_NO_REABRIR_AUTO } from './vista';
import { SIN_PERMISOS } from './acceso';

const ORG = 'org-1';
const OTRA_ORG = 'org-2';
const MIN = 60_000;
const AHORA = new Date('2026-09-22T15:00:00.000Z');
const haceMin = (n: number) => new Date(AHORA.getTime() - n * MIN);
const enMin = (n: number) => new Date(AHORA.getTime() + n * MIN);

// ── Doble de la base: tablas en memoria con la semántica que el servicio usa ──
//
// No es un mock que repita las llamadas: FILTRA de verdad (igualdad, `in`, `null`),
// ordena, agrupa y hace compare-and-set. Así las pruebas dicen «el agente acotado NO
// ve la excepción de otra EPS», no «se llamó a findMany con tal where».

type Fila = Record<string, any>;

function coincide(fila: Fila, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([campo, cond]) => {
    const v = fila[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      throw new Error(`el doble no soporta la condición sobre «${campo}»`);
    }
    return v === cond;
  });
}

const valor = (v: any) => (v instanceof Date ? v.getTime() : v);

function ordenar(filas: Fila[], orderBy: any): Fila[] {
  const criterios = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map(
    (o: Record<string, any>) => {
      const [campo, dir] = Object.entries(o)[0];
      const sort = typeof dir === 'string' ? dir : dir.sort;
      const nulls = typeof dir === 'string' ? 'last' : (dir.nulls ?? 'last');
      return { campo, sort, nulls };
    },
  );
  return [...filas].sort((a, b) => {
    for (const { campo, sort, nulls } of criterios) {
      const va = valor(a[campo]);
      const vb = valor(b[campo]);
      if (va == null && vb == null) continue;
      if (va == null) return nulls === 'last' ? 1 : -1;
      if (vb == null) return nulls === 'last' ? -1 : 1;
      if (va === vb) continue;
      return (va < vb ? -1 : 1) * (sort === 'asc' ? 1 : -1);
    }
    return 0;
  });
}

class Tabla {
  filas: Fila[] = [];
  private n = 0;
  constructor(private readonly reloj: () => Date = () => AHORA) {}

  findMany = jest.fn(async (args: any = {}) => {
    let r = ordenar(this.filas.filter((f) => coincide(f, args.where)), args.orderBy);
    if (args.skip) r = r.slice(args.skip);
    if (args.take != null) r = r.slice(0, args.take);
    return r.map((f) => ({ ...f }));
  });
  findFirst = jest.fn(async (args: any = {}) => (await this.findMany({ ...args, take: 1 }))[0] ?? null);
  findUnique = jest.fn(async (args: any = {}) => (await this.findMany({ ...args, take: 1 }))[0] ?? null);
  count = jest.fn(async (args: any = {}) => this.filas.filter((f) => coincide(f, args.where)).length);
  groupBy = jest.fn(async (args: any) => {
    const grupos = new Map<string, Fila>();
    for (const f of this.filas.filter((x) => coincide(x, args.where))) {
      const clave = args.by.map((c: string) => f[c]).join('|');
      const g = grupos.get(clave) ?? { ...Object.fromEntries(args.by.map((c: string) => [c, f[c]])), _count: { _all: 0 } };
      g._count._all += 1;
      grupos.set(clave, g);
    }
    return [...grupos.values()];
  });
  updateMany = jest.fn(async (args: any) => {
    const objetivo = this.filas.filter((f) => coincide(f, args.where));
    for (const f of objetivo) Object.assign(f, args.data);
    return { count: objetivo.length };
  });
  create = jest.fn(async (args: any) => {
    const f = { id: `gen-${++this.n}`, createdAt: this.reloj(), ...args.data };
    this.filas.push(f);
    return { ...f };
  });
}

function mockDb() {
  const t = {
    syncException: new Tabla(),
    syncExceptionLog: new Tabla(),
    doctorProfile: new Tabla(),
    patientProfile: new Tabla(),
    appointment: new Tabla(),
    user: new Tabla(),
    hospitalMirrorConfig: new Tabla(),
    whatsappTemplate: new Tabla(),
    syncAudit: new Tabla(),
    agentProfile: new Tabla(),
  };
  const db: any = {
    ...t,
    // Transacción con reversión real: si algo lanza, las tablas vuelven a como estaban.
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const foto = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.filas.map((f) => ({ ...f }))]));
      try {
        return await fn(db);
      } catch (error) {
        for (const [k, v] of Object.entries(t)) v.filas = foto[k];
        throw error;
      }
    }),
  };
  return db;
}

// ── Actores ──────────────────────────────────────────────────────────────────

const actor = (role: RolBandeja, over: Partial<ActorBandeja> = {}): ActorBandeja => ({
  userId: 'u-yo',
  role,
  organizationId: ORG,
  permisos: permisosBandeja(role),
  scopeEpsId: null,
  scopeDoctorId: null,
  ...over,
});
const admin = () => actor('ORG_ADMIN');
const agente = (scope: Partial<ActorBandeja> = {}) => actor('BOOKING_AGENT', scope);
const doctor = () => actor('DOCTOR');

// ── Siembra ──────────────────────────────────────────────────────────────────

let seq = 0;
function sembrar(db: any, over: Fila = {}): Fila {
  seq += 1;
  const f: Fila = {
    id: `ex-${seq}`,
    organizationId: ORG,
    kind: 'CITA_NO_ENTREGADA',
    dedupeKey: `cita:c${seq}:${seq}`,
    severity: 'MEDIA',
    status: 'ABIERTA',
    title: 'Cita que el hospital aún no tiene',
    detail: 'Lleva 25 min. Último error del agente: ECONNREFUSED 10.0.0.5:1433',
    appointmentId: `cita-${seq}`,
    patientId: 'pac-1',
    epsId: 'eps-1',
    doctorId: 'doc-1',
    appointmentStartAt: enMin(300),
    meta: { motivo: 'EN_COLA', desdeIso: haceMin(25).toISOString(), intentos: 0 },
    firstSeenAt: haceMin(30),
    lastSeenAt: haceMin(1),
    occurrences: 1,
    assignedToUserId: null,
    assignedAt: null,
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionNote: null,
    notifiedAt: null,
    notifiedSeverity: null,
    ...over,
  };
  db.syncException.filas.push(f);
  return f;
}

function sembrarCatalogo(db: any) {
  db.doctorProfile.filas.push(
    { id: 'doc-1', organizationId: ORG, fullName: 'Ana Ruiz', isFunctionalAgenda: false },
    { id: 'doc-2', organizationId: ORG, fullName: 'Luis Pérez', isFunctionalAgenda: false },
  );
  db.patientProfile.filas.push({ id: 'pac-1', organizationId: ORG, fullName: 'María López Núñez', cedula: '1053123456' });
  db.user.filas.push(
    { id: 'u-yo', organizationId: ORG, email: 'yo@clinica.co', role: 'ORG_ADMIN' },
    { id: 'u-otro', organizationId: ORG, email: 'otro@clinica.co', role: 'BOOKING_AGENT' },
    { id: 'u-ajeno', organizationId: OTRA_ORG, email: 'ajeno@otra.co', role: 'BOOKING_AGENT' },
  );
}

const ids = (r: { success: boolean; data?: { filas: { id: string }[] } }) => (r.data?.filas ?? []).map((f) => f.id);

beforeEach(() => {
  seq = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// Lectura
// ═════════════════════════════════════════════════════════════════════════════

describe('listarExcepciones — aislamiento y alcance', () => {
  it('🏢 solo la clínica del actor: lo de otra organización no aparece', async () => {
    const db = mockDb();
    const mia = sembrar(db);
    sembrar(db, { organizationId: OTRA_ORG });

    const r = await listarExcepciones(db, admin(), {}, AHORA);
    expect(ids(r as any)).toEqual([mia.id]);
  });

  it('🎯 un BOOKING_AGENT acotado a una EPS ve SOLO las de esa EPS', async () => {
    const db = mockDb();
    const suya = sembrar(db, { epsId: 'eps-1' });
    sembrar(db, { epsId: 'eps-2' });

    const r = await listarExcepciones(db, agente({ scopeEpsId: 'eps-1' }), {}, AHORA);
    expect(ids(r as any)).toEqual([suya.id]);
  });

  it('🎯 acotado a un médico: solo las de ese médico; con los dos, las dos condiciones', async () => {
    const db = mockDb();
    const a = sembrar(db, { epsId: 'eps-1', doctorId: 'doc-1' });
    sembrar(db, { epsId: 'eps-1', doctorId: 'doc-2' });
    sembrar(db, { epsId: 'eps-2', doctorId: 'doc-1' });

    expect(ids((await listarExcepciones(db, agente({ scopeDoctorId: 'doc-1' }), {}, AHORA)) as any)).toHaveLength(2);
    expect(ids((await listarExcepciones(db, agente({ scopeEpsId: 'eps-1', scopeDoctorId: 'doc-1' }), {}, AHORA)) as any)).toEqual([a.id]);
  });

  it('🔒 una excepción SIN EPS o SIN médico conocidos queda FUERA para un agente acotado (falla cerrado)', async () => {
    const db = mockDb();
    sembrar(db, { epsId: null });
    sembrar(db, { doctorId: null });

    expect(ids((await listarExcepciones(db, agente({ scopeEpsId: 'eps-1' }), {}, AHORA)) as any)).toHaveLength(1);
    expect(ids((await listarExcepciones(db, agente({ scopeDoctorId: 'doc-1' }), {}, AHORA)) as any)).toHaveLength(1);
  });

  it('un agente GLOBAL (sin alcance) y el administrador ven todo, incluso lo sin EPS ni médico', async () => {
    const db = mockDb();
    sembrar(db, { epsId: null, doctorId: null });
    sembrar(db);

    expect(ids((await listarExcepciones(db, agente(), {}, AHORA)) as any)).toHaveLength(2);
    expect(ids((await listarExcepciones(db, admin(), {}, AHORA)) as any)).toHaveLength(2);
  });

  it('sin permiso de ver: «Sin permisos.» y NO se toca la base', async () => {
    const db = mockDb();
    sembrar(db);
    for (const a of [doctor(), actor('SUPER_ADMIN'), actor('PATIENT' as RolBandeja)]) {
      await expect(listarExcepciones(db, a, {}, AHORA)).resolves.toEqual({ success: false, error: SIN_PERMISOS });
    }
    expect(db.syncException.findMany).not.toHaveBeenCalled();
    expect(db.syncException.groupBy).not.toHaveBeenCalled();
  });
});

describe('listarExcepciones — orden, filtros y páginas', () => {
  it('⏱️ lo activo va por URGENCIA: gravedad primero y, dentro de ella, la cita más próxima; sin hora, al final', async () => {
    const db = mockDb();
    const mediaTarde = sembrar(db, { severity: 'MEDIA', appointmentStartAt: enMin(600) });
    const mediaPronto = sembrar(db, { severity: 'MEDIA', appointmentStartAt: enMin(120) });
    const critica = sembrar(db, { severity: 'CRITICA', appointmentStartAt: enMin(60) });
    const altaSinHora = sembrar(db, { severity: 'ALTA', appointmentStartAt: null });
    const altaHoy = sembrar(db, { severity: 'ALTA', appointmentStartAt: enMin(200) });
    const baja = sembrar(db, { severity: 'BAJA', appointmentStartAt: enMin(10) });

    const r = await listarExcepciones(db, admin(), {}, AHORA);
    expect(ids(r as any)).toEqual([critica.id, altaHoy.id, altaSinHora.id, mediaPronto.id, mediaTarde.id, baja.id]);
  });

  it('por defecto muestra las ACTIVAS (abiertas y en revisión), no las cerradas', async () => {
    const db = mockDb();
    const abierta = sembrar(db);
    const enRevision = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    sembrar(db, { status: 'RESUELTA' });
    sembrar(db, { status: 'DESCARTADA' });
    sembrar(db, { status: 'AUTO_RESUELTA' });

    expect(new Set(ids((await listarExcepciones(db, admin(), {}, AHORA)) as any))).toEqual(new Set([abierta.id, enRevision.id]));
  });

  it('MIAS: solo las que YO tengo en revisión', async () => {
    const db = mockDb();
    const mia = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-yo' });
    sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    sembrar(db);

    expect(ids((await listarExcepciones(db, admin(), { estado: 'MIAS' }, AHORA)) as any)).toEqual([mia.id]);
  });

  it('SIN_DUENO: solo las abiertas', async () => {
    const db = mockDb();
    const libre = sembrar(db);
    sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro' });

    expect(ids((await listarExcepciones(db, admin(), { estado: 'SIN_DUENO' }, AHORA)) as any)).toEqual([libre.id]);
  });

  it('CERRADAS: las tres formas de cierre, la más reciente primero', async () => {
    const db = mockDb();
    const vieja = sembrar(db, { status: 'RESUELTA', resolvedAt: haceMin(300) });
    const reciente = sembrar(db, { status: 'AUTO_RESUELTA', resolvedAt: haceMin(5) });
    const media = sembrar(db, { status: 'DESCARTADA', resolvedAt: haceMin(60) });
    sembrar(db);

    const r = await listarExcepciones(db, admin(), { estado: 'CERRADAS' }, AHORA);
    expect(ids(r as any)).toEqual([reciente.id, media.id, vieja.id]);
  });

  it('filtra por tipo y por gravedad', async () => {
    const db = mockDb();
    const a = sembrar(db, { kind: 'ERROR_SYNC', severity: 'ALTA' });
    sembrar(db, { kind: 'CITA_NO_ENTREGADA', severity: 'ALTA' });
    sembrar(db, { kind: 'ERROR_SYNC', severity: 'BAJA' });

    expect(ids((await listarExcepciones(db, admin(), { tipo: 'ERROR_SYNC', gravedad: 'ALTA' }, AHORA)) as any)).toEqual([a.id]);
  });

  it('un filtro inventado se IGNORA (no revienta ni deja pasar nada raro)', async () => {
    const db = mockDb();
    sembrar(db);
    const r = await listarExcepciones(db, admin(), { estado: 'TODO' as never, tipo: 'X' as never, gravedad: 'Y' as never }, AHORA);
    expect(ids(r as any)).toHaveLength(1);
  });

  it('📄 pagina de a 25, recorta la página pedida a las que hay y dice cuántas hay', async () => {
    const db = mockDb();
    for (let i = 0; i < 60; i += 1) sembrar(db, { appointmentStartAt: enMin(100 + i) });

    const p1 = await listarExcepciones(db, admin(), { pagina: 1 }, AHORA);
    const p3 = await listarExcepciones(db, admin(), { pagina: 3 }, AHORA);
    const p9 = await listarExcepciones(db, admin(), { pagina: 9 }, AHORA);
    const basura = await listarExcepciones(db, admin(), { pagina: -4 }, AHORA);

    expect((p1 as any).data).toMatchObject({ total: 60, pagina: 1, paginas: 3 });
    expect((p1 as any).data.filas).toHaveLength(TAMANO_PAGINA);
    expect((p3 as any).data.filas).toHaveLength(10);
    expect((p9 as any).data).toMatchObject({ pagina: 3, paginas: 3 });
    expect((p9 as any).data.filas).toHaveLength(10);
    expect((basura as any).data.pagina).toBe(1);
    // Ninguna se repite entre páginas.
    const p2 = await listarExcepciones(db, admin(), { pagina: 2 }, AHORA);
    const todas = [...ids(p1 as any), ...ids(p2 as any), ...ids(p3 as any)];
    expect(new Set(todas).size).toBe(60);
  });

  it('📄 una página de más entre las CERRADAS se recorta a la última (no «página 9 de 2» con la lista vacía)', async () => {
    const db = mockDb();
    for (let i = 0; i < 30; i += 1) sembrar(db, { status: 'RESUELTA', resolvedAt: haceMin(i) });

    const r = await listarExcepciones(db, admin(), { estado: 'CERRADAS', pagina: 9 }, AHORA);
    expect((r as any).data).toMatchObject({ pagina: 2, paginas: 2 });
    expect((r as any).data.filas).toHaveLength(5);
  });

  it('📄 sin nada que mostrar: página 1 de 1 (no «página 1 de 0»)', async () => {
    const db = mockDb();
    for (const estado of ['ACTIVAS', 'CERRADAS'] as const) {
      const r = await listarExcepciones(db, admin(), { estado }, AHORA);
      expect((r as any).data).toMatchObject({ filas: [], total: 0, pagina: 1, paginas: 1 });
    }
  });

  it('las CERRADAS se paginan en la base (skip/take), no en memoria', async () => {
    const db = mockDb();
    for (let i = 0; i < 30; i += 1) sembrar(db, { status: 'RESUELTA', resolvedAt: haceMin(i) });

    const r = await listarExcepciones(db, admin(), { estado: 'CERRADAS', pagina: 2 }, AHORA);
    expect((r as any).data).toMatchObject({ total: 30, pagina: 2, paginas: 2 });
    expect((r as any).data.filas).toHaveLength(5);
    expect(db.syncException.findMany.mock.calls[0][0]).toMatchObject({ skip: 25, take: 25 });
  });

  it('las activas traen a lo sumo MAX_ACTIVAS filas de la base', async () => {
    const db = mockDb();
    sembrar(db);
    await listarExcepciones(db, admin(), {}, AHORA);
    expect(db.syncException.findMany.mock.calls[0][0]).toMatchObject({ take: MAX_ACTIVAS });
  });
});

describe('listarExcepciones — lo que llega a la pantalla', () => {
  it('🔒 paciente enmascarado, y sin el detalle técnico para un agente', async () => {
    const db = mockDb();
    sembrarCatalogo(db);
    sembrar(db);

    const r = await listarExcepciones(db, agente(), {}, AHORA);
    const texto = JSON.stringify(r);
    expect(texto).toContain('María L••• N•••');
    expect(texto).toContain('•••3456');
    expect(texto).not.toContain('López');
    expect(texto).not.toContain('1053123456');
    expect(texto).not.toContain('ECONNREFUSED');
  });

  it('el administrador sí ve el detalle técnico', async () => {
    const db = mockDb();
    sembrarCatalogo(db);
    sembrar(db);
    const r = await listarExcepciones(db, admin(), {}, AHORA);
    expect((r as any).data.filas[0].detalleTecnico).toContain('ECONNREFUSED');
  });

  it('el dueño se nombra: «Tú», o el rol; y solo se buscan usuarios de ESTA clínica', async () => {
    const db = mockDb();
    sembrarCatalogo(db);
    sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-yo' });

    const r = await listarExcepciones(db, admin(), {}, AHORA);
    const duenos = (r as any).data.filas.map((f: any) => f.dueno.etiqueta).sort();
    expect(duenos).toEqual(['Tú', 'agente de reservas · otro@clinica.co']);
    expect(db.user.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG });
  });

  it('🏢 las búsquedas de médicos, pacientes y citas también van con la clínica', async () => {
    const db = mockDb();
    sembrarCatalogo(db);
    sembrar(db);
    await listarExcepciones(db, admin(), {}, AHORA);
    for (const tabla of ['doctorProfile', 'patientProfile', 'appointment'] as const) {
      expect(db[tabla].findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG });
    }
  });

  it('un paciente de OTRA clínica con el mismo id no se cuela', async () => {
    const db = mockDb();
    db.patientProfile.filas.push({ id: 'pac-1', organizationId: OTRA_ORG, fullName: 'Persona Ajena', cedula: '999999' });
    sembrar(db);
    const r = await listarExcepciones(db, admin(), {}, AHORA);
    expect(JSON.stringify(r)).not.toContain('Persona');
    expect((r as any).data.filas[0].cita.paciente).toBeNull();
  });

  it('el servicio sale por el árbol de la cita (cupo → servicio)', async () => {
    const db = mockDb();
    db.appointment.filas.push({ id: 'cita-1', organizationId: ORG, scheduleSlot: { service: { name: 'Odontología' } } });
    sembrar(db, { appointmentId: 'cita-1' });
    const r = await listarExcepciones(db, admin(), {}, AHORA);
    expect((r as any).data.filas[0].cita.servicio).toBe('Odontología');
  });
});

describe('resumenBandeja y contarPendientes', () => {
  it('cuenta activas, sin dueño, mías, críticas y por gravedad', async () => {
    const db = mockDb();
    sembrar(db, { severity: 'CRITICA' });
    sembrar(db, { severity: 'ALTA' });
    sembrar(db, { severity: 'ALTA', status: 'EN_REVISION', assignedToUserId: 'u-yo' });
    sembrar(db, { severity: 'MEDIA', status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    sembrar(db, { severity: 'CRITICA', status: 'RESUELTA' });

    await expect(resumenBandeja(db, admin())).resolves.toEqual({
      activas: 4,
      sinDueno: 2,
      mias: 1,
      criticas: 1,
      porGravedad: { BAJA: 0, MEDIA: 1, ALTA: 2, CRITICA: 1 },
    });
  });

  it('🎯 el resumen de un agente acotado cuenta SOLO lo suyo', async () => {
    const db = mockDb();
    sembrar(db, { epsId: 'eps-1', severity: 'CRITICA' });
    sembrar(db, { epsId: 'eps-2', severity: 'CRITICA' });
    sembrar(db, { epsId: null, severity: 'CRITICA' });
    sembrar(db, { epsId: 'eps-1', organizationId: OTRA_ORG });

    const r = await resumenBandeja(db, agente({ scopeEpsId: 'eps-1' }));
    expect(r).toMatchObject({ activas: 1, criticas: 1, sinDueno: 1 });
  });

  it('el resumen NO cambia con los filtros de la lista', async () => {
    const db = mockDb();
    sembrar(db, { kind: 'ERROR_SYNC' });
    sembrar(db, { kind: 'CITA_NO_ENTREGADA' });
    const r = await listarExcepciones(db, admin(), { tipo: 'ERROR_SYNC' }, AHORA);
    expect((r as any).data.filas).toHaveLength(1);
    expect((r as any).data.resumen.activas).toBe(2);
  });

  it('sin permiso de ver, el resumen lanza y el contador da 0 sin tocar la base', async () => {
    const db = mockDb();
    await expect(resumenBandeja(db, doctor())).rejects.toThrow(SIN_PERMISOS);
    await expect(contarPendientes(db, doctor())).resolves.toBe(0);
    expect(db.syncException.count).not.toHaveBeenCalled();
  });

  it('el contador del menú cuenta lo que espera a alguien: abiertas, con el alcance del actor', async () => {
    const db = mockDb();
    sembrar(db, { epsId: 'eps-1' });
    sembrar(db, { epsId: 'eps-2' });
    sembrar(db, { epsId: 'eps-1', status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    sembrar(db, { epsId: 'eps-1', status: 'RESUELTA' });
    sembrar(db, { epsId: 'eps-1', organizationId: OTRA_ORG });

    await expect(contarPendientes(db, admin())).resolves.toBe(2);
    await expect(contarPendientes(db, agente({ scopeEpsId: 'eps-1' }))).resolves.toBe(1);
  });
});

describe('detalleExcepcion', () => {
  it('devuelve la excepción con su historial, cada línea con quién la hizo', async () => {
    const db = mockDb();
    sembrarCatalogo(db);
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    db.syncExceptionLog.filas.push(
      { id: 'l2', exceptionId: ex.id, action: 'TOMADA', actorUserId: 'u-otro', actorRole: 'BOOKING_AGENT', note: null, createdAt: haceMin(10) },
      { id: 'l1', exceptionId: ex.id, action: 'CREADA', actorUserId: null, actorRole: null, note: 'Cita que el hospital aún no tiene', createdAt: haceMin(30) },
      { id: 'lx', exceptionId: 'otra', action: 'CREADA', actorUserId: null, actorRole: null, note: 'de otra excepción', createdAt: haceMin(30) },
    );

    const r = await detalleExcepcion(db, admin(), ex.id, AHORA);
    expect(r.success).toBe(true);
    expect((r as any).data.historial.map((h: any) => [h.accion, h.por])).toEqual([
      ['Detectada', 'El sistema'],
      ['La tomó', 'agente de reservas · otro@clinica.co'],
    ]);
    expect(JSON.stringify(r)).not.toContain('de otra excepción');
  });

  it('🔒 inexistente, de otra clínica y fuera de alcance responden IGUAL (no es un oráculo)', async () => {
    const db = mockDb();
    const ajena = sembrar(db, { organizationId: OTRA_ORG });
    const deOtraEps = sembrar(db, { epsId: 'eps-2' });

    const esperado = { success: false, error: MSG_NO_ENCONTRADA };
    await expect(detalleExcepcion(db, admin(), 'no-existe', AHORA)).resolves.toEqual(esperado);
    await expect(detalleExcepcion(db, admin(), ajena.id, AHORA)).resolves.toEqual(esperado);
    await expect(detalleExcepcion(db, agente({ scopeEpsId: 'eps-1' }), deOtraEps.id, AHORA)).resolves.toEqual(esperado);
  });

  it('un id que no es texto, vacío o larguísimo ni llega a la base', async () => {
    const db = mockDb();
    for (const id of [undefined, null, 42, {}, '', 'x'.repeat(65)]) {
      await expect(detalleExcepcion(db, admin(), id, AHORA)).resolves.toEqual({ success: false, error: MSG_NO_ENCONTRADA });
    }
    expect(db.syncException.findFirst).not.toHaveBeenCalled();
  });

  it('sin permiso de ver: «Sin permisos.»', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    await expect(detalleExcepcion(db, doctor(), ex.id, AHORA)).resolves.toEqual({ success: false, error: SIN_PERMISOS });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Trabajar una excepción
// ═════════════════════════════════════════════════════════════════════════════

describe('aplicarAccion', () => {
  const fila = (db: any, id: string) => db.syncException.filas.find((f: Fila) => f.id === id) as Fila;
  const logs = (db: any, id: string) => db.syncExceptionLog.filas.filter((l: Fila) => l.exceptionId === id) as Fila[];

  it('TOMAR: pasa a EN_REVISION con dueño y hora, y deja la línea del historial', async () => {
    const db = mockDb();
    const ex = sembrar(db);

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'TOMAR' }, AHORA);

    expect(r).toEqual({ success: true, data: { estado: 'EN_REVISION' } });
    expect(fila(db, ex.id)).toMatchObject({ status: 'EN_REVISION', assignedToUserId: 'u-yo', assignedAt: AHORA });
    expect(logs(db, ex.id)).toEqual([expect.objectContaining({ action: 'TOMADA', actorUserId: 'u-yo', actorRole: 'BOOKING_AGENT', note: null })]);
  });

  it('SOLTAR: vuelve a ABIERTA y sin dueño', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-yo', assignedAt: haceMin(5) });

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'SOLTAR' }, AHORA);
    expect(r).toEqual({ success: true, data: { estado: 'ABIERTA' } });
    expect(fila(db, ex.id)).toMatchObject({ status: 'ABIERTA', assignedToUserId: null, assignedAt: null });
    expect(logs(db, ex.id)[0].action).toBe('SOLTADA');
  });

  it('RESOLVER con nota: cierra, deja quién y cuándo, suelta al dueño y guarda la nota RECORTADA', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-yo', assignedAt: haceMin(5) });

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'RESOLVER', nota: '   Se agendó en ventanilla   ' }, AHORA);

    expect(r).toEqual({ success: true, data: { estado: 'RESUELTA' } });
    expect(fila(db, ex.id)).toMatchObject({
      status: 'RESUELTA',
      resolvedAt: AHORA,
      resolvedByUserId: 'u-yo',
      resolutionNote: 'Se agendó en ventanilla',
      assignedToUserId: null,
      assignedAt: null,
    });
    expect(logs(db, ex.id)[0]).toMatchObject({ action: 'RESUELTA', note: 'Se agendó en ventanilla' });
  });

  it('DESCARTAR con nota: queda DESCARTADA', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'DESCARTAR', nota: 'Era una cita de prueba' }, AHORA);
    expect(r).toEqual({ success: true, data: { estado: 'DESCARTADA' } });
    expect(fila(db, ex.id)).toMatchObject({ status: 'DESCARTADA', resolvedByUserId: 'u-yo' });
    expect(logs(db, ex.id)[0].action).toBe('DESCARTADA');
  });

  it('📝 cerrar SIN nota (o con solo espacios) se rechaza y NO cambia nada ni deja línea', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    for (const nota of [undefined, '', '     ', 'abc', 42]) {
      const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'RESOLVER', nota }, AHORA);
      expect(r.success).toBe(false);
      expect((r as any).error).toMatch(/nota/i);
    }
    expect(fila(db, ex.id).status).toBe('ABIERTA');
    expect(logs(db, ex.id)).toHaveLength(0);
  });

  it('REABRIR una resuelta: vuelve a ABIERTA y limpia el cierre', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'RESUELTA', resolvedAt: haceMin(9), resolvedByUserId: 'u-otro', resolutionNote: 'ya está' });

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'REABRIR' }, AHORA);
    expect(r).toEqual({ success: true, data: { estado: 'ABIERTA' } });
    expect(fila(db, ex.id)).toMatchObject({ status: 'ABIERTA', resolvedAt: null, resolvedByUserId: null, resolutionNote: null });
    expect(logs(db, ex.id)[0].action).toBe('REABIERTA');
  });

  it('🤖 reabrir lo que cerró el SISTEMA se rechaza con la razón', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'AUTO_RESUELTA', resolvedAt: haceMin(9) });
    await expect(aplicarAccion(db, admin(), { id: ex.id, accion: 'REABRIR' }, AHORA)).resolves.toEqual({ success: false, error: MSG_NO_REABRIR_AUTO });
    expect(fila(db, ex.id).status).toBe('AUTO_RESUELTA');
  });

  it('👑 el administrador que toma la de otro la REASIGNA, y así consta', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro', assignedAt: haceMin(30) });

    const r = await aplicarAccion(db, admin(), { id: ex.id, accion: 'TOMAR' }, AHORA);
    expect(r).toEqual({ success: true, data: { estado: 'EN_REVISION' } });
    expect(fila(db, ex.id)).toMatchObject({ status: 'EN_REVISION', assignedToUserId: 'u-yo' });
    expect(logs(db, ex.id)[0].action).toBe('REASIGNADA');
  });

  it('🧟 una EN_REVISION sin dueño (dato inconsistente) no queda trabada: un agente la toma y consta como TOMADA, no como reasignación', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: null });

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'TOMAR' }, AHORA);

    expect(r).toEqual({ success: true, data: { estado: 'EN_REVISION' } });
    expect(fila(db, ex.id)).toMatchObject({ status: 'EN_REVISION', assignedToUserId: 'u-yo' });
    expect(logs(db, ex.id)[0].action).toBe('TOMADA');
  });

  it('🔒 un agente NO puede tomar, soltar ni cerrar la que tiene un compañero', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    for (const [accion, nota] of [['TOMAR'], ['SOLTAR'], ['RESOLVER', 'Ya la resolví yo'], ['DESCARTAR', 'No hacía falta']] as const) {
      const r = await aplicarAccion(db, agente(), { id: ex.id, accion, nota }, AHORA);
      expect(r.success).toBe(false);
    }
    expect(fila(db, ex.id)).toMatchObject({ status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    expect(logs(db, ex.id)).toHaveLength(0);
  });

  it('🏢 una excepción de OTRA clínica: «no encontrada» y NADA cambia', async () => {
    const db = mockDb();
    const ajena = sembrar(db, { organizationId: OTRA_ORG });
    await expect(aplicarAccion(db, admin(), { id: ajena.id, accion: 'TOMAR' }, AHORA)).resolves.toEqual({ success: false, error: MSG_NO_ENCONTRADA });
    expect(fila(db, ajena.id).status).toBe('ABIERTA');
    expect(db.syncExceptionLog.filas).toHaveLength(0);
  });

  it('🎯 un agente acotado NO puede trabajar una excepción fuera de su alcance, aunque conozca el id', async () => {
    const db = mockDb();
    const deOtraEps = sembrar(db, { epsId: 'eps-2' });
    const sinEps = sembrar(db, { epsId: null });
    const a = agente({ scopeEpsId: 'eps-1' });

    for (const ex of [deOtraEps, sinEps]) {
      for (const accion of ['TOMAR', 'RESOLVER', 'DESCARTAR'] as const) {
        await expect(aplicarAccion(db, a, { id: ex.id, accion, nota: 'Una nota válida' }, AHORA)).resolves.toEqual({ success: false, error: MSG_NO_ENCONTRADA });
      }
      expect(fila(db, ex.id).status).toBe('ABIERTA');
    }
    expect(db.syncExceptionLog.filas).toHaveLength(0);
  });

  it('el alcance se vuelve a comprobar aunque la consulta lo dejara pasar (doble comprobación)', async () => {
    const db = mockDb();
    const ex = sembrar(db, { epsId: 'eps-2' });
    // Una consulta defectuosa que ignora el alcance: la regla del agente debe frenarlo igual.
    db.syncException.findFirst.mockImplementationOnce(async () => ({ ...ex }));
    await expect(aplicarAccion(db, agente({ scopeEpsId: 'eps-1' }), { id: ex.id, accion: 'TOMAR' }, AHORA)).resolves.toEqual({ success: false, error: MSG_NO_ENCONTRADA });
    expect(db.syncException.updateMany).not.toHaveBeenCalled();
  });

  it('quien no puede trabajar («Sin permisos.») no toca la base', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    for (const a of [doctor(), actor('SUPER_ADMIN')]) {
      await expect(aplicarAccion(db, a, { id: ex.id, accion: 'TOMAR' }, AHORA)).resolves.toEqual({ success: false, error: SIN_PERMISOS });
    }
    expect(db.syncException.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('una acción inventada, o una nota de más de 500 caracteres, se rechazan antes de leer nada', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    for (const accion of ['BORRAR', undefined, null, 5, {}]) {
      await expect(aplicarAccion(db, admin(), { id: ex.id, accion }, AHORA)).resolves.toEqual({ success: false, error: MSG_ACCION_INVALIDA });
    }
    await expect(aplicarAccion(db, admin(), { id: ex.id, accion: 'RESOLVER', nota: 'x'.repeat(MAX_NOTA + 1) }, AHORA)).resolves.toEqual({ success: false, error: MSG_NOTA_LARGA });
    // 500 exactos sí.
    await expect(aplicarAccion(db, admin(), { id: ex.id, accion: 'RESOLVER', nota: 'x'.repeat(MAX_NOTA) }, AHORA)).resolves.toMatchObject({ success: true });
    expect(db.syncException.findFirst).toHaveBeenCalledTimes(1);
  });

  it('tomar con una nota de puros espacios no guarda una nota vacía', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    await aplicarAccion(db, admin(), { id: ex.id, accion: 'TOMAR', nota: '   ' }, AHORA);
    expect(logs(db, ex.id)[0].note).toBeNull();
  });

  it('🏁 si otra persona cambió la excepción entre la lectura y la escritura, NO se pisa y no queda línea', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    const leer = db.syncException.findFirst.getMockImplementation()!;
    db.syncException.findFirst.mockImplementationOnce(async (a: unknown) => {
      const leida = await leer(a);
      // Un compañero la toma justo después de que esta petición la leyó.
      Object.assign(fila(db, ex.id), { status: 'EN_REVISION', assignedToUserId: 'u-otro' });
      return leida;
    });

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'TOMAR' }, AHORA);

    expect(r).toEqual({ success: false, error: MSG_CAMBIO_CONCURRENTE });
    expect(fila(db, ex.id)).toMatchObject({ status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    expect(logs(db, ex.id)).toHaveLength(0);
  });

  it('el compare-and-set condiciona al estado y al dueño que se leyeron, y a la clínica', async () => {
    const db = mockDb();
    const ex = sembrar(db, { status: 'EN_REVISION', assignedToUserId: 'u-yo' });
    await aplicarAccion(db, agente(), { id: ex.id, accion: 'SOLTAR' }, AHORA);
    expect(db.syncException.updateMany.mock.calls[0][0].where).toEqual({
      id: ex.id,
      organizationId: ORG,
      status: 'EN_REVISION',
      assignedToUserId: 'u-yo',
    });
  });

  it('⚛️ el cambio y su constancia van JUNTOS: si la línea de historial falla, el cambio se revierte', async () => {
    const db = mockDb();
    const ex = sembrar(db);
    db.syncExceptionLog.create.mockRejectedValueOnce(new Error('disco lleno'));
    const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await aplicarAccion(db, agente(), { id: ex.id, accion: 'TOMAR' }, AHORA);

    expect(r).toEqual({ success: false, error: MSG_NO_GUARDADA });
    expect(fila(db, ex.id)).toMatchObject({ status: 'ABIERTA', assignedToUserId: null });
    expect(consola).toHaveBeenCalled();
    consola.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Avisos al agendador
// ═════════════════════════════════════════════════════════════════════════════

describe('estadoAvisos — ¿salen los avisos? Si no, por qué', () => {
  const config = (db: any, over: Fila = {}) =>
    db.hospitalMirrorConfig.filas.push({ organizationId: ORG, enabled: true, conflictAlertsEnabled: true, agendadorWhatsapp: '573001234567', ...over });
  const plantilla = (db: any, over: Fila = {}) =>
    db.whatsappTemplate.filas.push({ id: 't1', organizationId: ORG, kind: 'SYNC_EXCEPTION_ALERT', isActive: true, ...over });

  it('✅ todo en orden: salen', async () => {
    const db = mockDb();
    config(db);
    plantilla(db);
    const r = await estadoAvisos(db, admin());
    expect(r).toEqual({
      success: true,
      data: {
        salen: true,
        razon: null,
        alertasActivas: true,
        plantilla: true,
        tieneNumero: true,
        tieneRespaldo: false,
        numero: '573001234567',
        respaldo: null,
      },
    });
  });

  it('sin fila de configuración, o con el espejo apagado: dice que el espejo está apagado', async () => {
    const dbSin = mockDb();
    plantilla(dbSin);
    expect(((await estadoAvisos(dbSin, admin())) as any).data).toMatchObject({ salen: false, razon: expect.stringMatching(/espejo.*apagado/i) });

    const dbOff = mockDb();
    config(dbOff, { enabled: false });
    plantilla(dbOff);
    expect(((await estadoAvisos(dbOff, admin())) as any).data.razon).toMatch(/espejo.*apagado/i);
  });

  it('avisos apagados', async () => {
    const db = mockDb();
    config(db, { conflictAlertsEnabled: false });
    plantilla(db);
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: false, alertasActivas: false });
    expect(d.razon).toMatch(/apagados/);
  });

  it('falta el número', async () => {
    const db = mockDb();
    config(db, { agendadorWhatsapp: null });
    plantilla(db);
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: false, tieneNumero: false, numero: null });
    expect(d.razon).toMatch(/número/);
  });

  it('falta la plantilla, o está desactivada, o es de OTRA clínica, o de OTRO tipo', async () => {
    for (const p of [null, { isActive: false }, { organizationId: OTRA_ORG }, { kind: 'REMINDER' }]) {
      const db = mockDb();
      config(db);
      if (p) plantilla(db, p);
      const d = ((await estadoAvisos(db, admin())) as any).data;
      expect(d).toMatchObject({ salen: false, plantilla: false });
      expect(d.razon).toMatch(/plantilla/i);
    }
  });

  it('🔒 el número completo es solo de quien lo configura (ORG_ADMIN); un agente ve que hay, no cuál', async () => {
    const db = mockDb();
    config(db);
    plantilla(db);
    const d = ((await estadoAvisos(db, agente())) as any).data;
    expect(d).toMatchObject({ tieneNumero: true, numero: null, salen: true });
    expect(JSON.stringify(d)).not.toContain('3001234567');
  });

  it('🔒 el respaldo (§12 #14), igual: el administrador lo ve, el agente solo sabe que existe', async () => {
    const db = mockDb();
    config(db, { agendadorRespaldoWhatsapp: '573007654321' });
    plantilla(db);
    expect(((await estadoAvisos(db, admin())) as any).data).toMatchObject({
      tieneRespaldo: true,
      respaldo: '573007654321',
    });
    const d = ((await estadoAvisos(db, agente())) as any).data;
    expect(d).toMatchObject({ tieneRespaldo: true, respaldo: null });
    expect(JSON.stringify(d)).not.toContain('3007654321');
  });

  it('sin permiso de ver: «Sin permisos.»', async () => {
    await expect(estadoAvisos(mockDb(), doctor())).resolves.toEqual({ success: false, error: SIN_PERMISOS });
  });

  it('🏢 lee la configuración y la plantilla de la clínica del actor', async () => {
    const db = mockDb();
    config(db, { organizationId: OTRA_ORG });
    plantilla(db, { organizationId: OTRA_ORG });
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: false, tieneNumero: false, plantilla: false });
  });
});

describe('guardarAvisos', () => {
  const conConfig = (over: Fila = {}) => {
    const db = mockDb();
    db.hospitalMirrorConfig.filas.push({ organizationId: ORG, enabled: true, conflictAlertsEnabled: false, agendadorWhatsapp: null, ...over });
    db.hospitalMirrorConfig.filas.push({ organizationId: OTRA_ORG, enabled: true, conflictAlertsEnabled: false, agendadorWhatsapp: null });
    return db;
  };
  const cfg = (db: any, org = ORG) => db.hospitalMirrorConfig.filas.find((f: Fila) => f.organizationId === org) as Fila;

  it('guarda el celular como lo espera el envío (solo dígitos, con el 57) y activa los avisos', async () => {
    const db = conConfig();
    const r = await guardarAvisos(db, admin(), { numero: '300 123 4567', activos: true });
    expect(r).toEqual({ success: true, data: { numero: '573001234567', respaldo: null, activos: true } });
    expect(cfg(db)).toMatchObject({ agendadorWhatsapp: '573001234567', conflictAlertsEnabled: true });
  });

  it('acepta el celular escrito con +57 o con el 57', async () => {
    for (const escrito of ['+57 300 123 4567', '573001234567']) {
      const db = conConfig();
      await guardarAvisos(db, admin(), { numero: escrito, activos: true });
      expect(cfg(db).agendadorWhatsapp).toBe('573001234567');
    }
  });

  it('🏢 solo toca la configuración de SU clínica', async () => {
    const db = conConfig();
    await guardarAvisos(db, admin(), { numero: '3001234567', activos: true });
    expect(cfg(db, OTRA_ORG)).toMatchObject({ agendadorWhatsapp: null, conflictAlertsEnabled: false });
    expect(db.hospitalMirrorConfig.updateMany.mock.calls[0][0].where).toEqual({ organizationId: ORG });
  });

  it('vacío: quita el destinatario (los avisos dejan de salir)', async () => {
    const db = conConfig({ agendadorWhatsapp: '573001234567', conflictAlertsEnabled: true });
    const r = await guardarAvisos(db, admin(), { numero: '  ', activos: false });
    expect(r).toEqual({ success: true, data: { numero: null, respaldo: null, activos: false } });
    expect(cfg(db)).toMatchObject({ agendadorWhatsapp: null, conflictAlertsEnabled: false });
  });

  it('un número inválido se rechaza y NO se toca nada', async () => {
    const db = conConfig();
    for (const numero of ['12345', '6013001234', 'abc', '300 123 456']) {
      await expect(guardarAvisos(db, admin(), { numero, activos: true })).resolves.toEqual({ success: false, error: MSG_NUMERO_INVALIDO });
    }
    expect(db.hospitalMirrorConfig.updateMany).not.toHaveBeenCalled();
    expect(db.syncAudit.filas).toHaveLength(0);
  });

  it('«activos» tiene que ser un booleano de verdad', async () => {
    const db = conConfig();
    for (const activos of ['true', 1, null, undefined]) {
      const r = await guardarAvisos(db, admin(), { numero: '3001234567', activos });
      expect(r.success).toBe(false);
    }
    expect(db.hospitalMirrorConfig.updateMany).not.toHaveBeenCalled();
  });

  it('🔒 solo el ORG_ADMIN: un BOOKING_AGENT, un DOCTOR o un SUPER_ADMIN reciben «Sin permisos.» y nada cambia', async () => {
    const db = conConfig();
    for (const a of [agente(), doctor(), actor('SUPER_ADMIN')]) {
      await expect(guardarAvisos(db, a, { numero: '3001234567', activos: true })).resolves.toEqual({ success: false, error: SIN_PERMISOS });
    }
    expect(db.hospitalMirrorConfig.updateMany).not.toHaveBeenCalled();
    expect(cfg(db).agendadorWhatsapp).toBeNull();
  });

  it('📒 deja constancia en la bitácora del espejo, con el número ENMASCARADO', async () => {
    const db = conConfig();
    await guardarAvisos(db, admin(), { numero: '300 123 4567', activos: true });
    expect(db.syncAudit.filas).toHaveLength(1);
    const a = db.syncAudit.filas[0];
    expect(a).toMatchObject({ organizationId: ORG, direction: 'CONFIG', entityType: 'HospitalMirrorConfig', op: 'ALERT_SETTINGS_CHANGE', outcome: 'OK' });
    expect(a.detail).toContain('•••4567');
    expect(a.detail).toContain('activos');
    expect(a.detail).not.toContain('3001234567');
  });

  it('la constancia dice «sin número» cuando se quita', async () => {
    const db = conConfig({ agendadorWhatsapp: '573001234567' });
    await guardarAvisos(db, admin(), { numero: '', activos: false });
    expect(db.syncAudit.filas[0].detail).toMatch(/apagados.*sin número/);
  });

  describe('el número de respaldo (§12 #14)', () => {
    it('se guarda normalizado junto al del agendador, y la constancia lo enmascara', async () => {
      const db = conConfig();
      const r = await guardarAvisos(db, admin(), { numero: '300 123 4567', respaldo: '+57 300 765 4321', activos: true });
      expect(r).toEqual({ success: true, data: { numero: '573001234567', respaldo: '573007654321', activos: true } });
      expect(cfg(db)).toMatchObject({ agendadorWhatsapp: '573001234567', agendadorRespaldoWhatsapp: '573007654321' });
      const detalle = db.syncAudit.filas[0].detail as string;
      expect(detalle).toMatch(/respaldo •••4321/);
      expect(detalle).not.toContain('3007654321');
    });

    it('vacío: se quita el respaldo (los recordatorios van solo al agendador)', async () => {
      const db = conConfig({ agendadorWhatsapp: '573001234567', agendadorRespaldoWhatsapp: '573007654321' });
      await guardarAvisos(db, admin(), { numero: '3001234567', respaldo: '', activos: true });
      expect(cfg(db).agendadorRespaldoWhatsapp).toBeNull();
      expect(db.syncAudit.filas[0].detail).toMatch(/respaldo sin número/);
    });

    it('sin respaldo en la entrada (cliente viejo): se trata como vacío', async () => {
      const db = conConfig({ agendadorRespaldoWhatsapp: '573007654321' });
      await guardarAvisos(db, admin(), { numero: '3001234567', activos: true });
      expect(cfg(db).agendadorRespaldoWhatsapp).toBeNull();
    });

    it.each([
      ['inválido', { numero: '3001234567', respaldo: '12345' }, MSG_NUMERO_INVALIDO],
      ['sin agendador (es un segundo destinatario, no un sustituto)', { numero: '', respaldo: '3007654321' }, MSG_RESPALDO_SIN_AGENDADOR],
      ['igual al agendador (no sería un escalamiento)', { numero: '300 123 4567', respaldo: '+573001234567' }, MSG_RESPALDO_IGUAL],
    ])('%s: se rechaza y NO se toca nada', async (_n, entrada, error) => {
      const db = conConfig();
      await expect(guardarAvisos(db, admin(), { ...entrada, activos: true })).resolves.toEqual({ success: false, error });
      expect(db.hospitalMirrorConfig.updateMany).not.toHaveBeenCalled();
      expect(db.syncAudit.filas).toHaveLength(0);
    });
  });

  it('sin fila de espejo para la clínica: se dice y NO se deja constancia de algo que no pasó', async () => {
    const db = mockDb();
    await expect(guardarAvisos(db, admin(), { numero: '3001234567', activos: true })).resolves.toEqual({ success: false, error: MSG_SIN_ESPEJO });
    expect(db.syncAudit.filas).toHaveLength(0);
  });

  it('⚛️ si la constancia falla, el cambio de configuración se revierte', async () => {
    const db = conConfig();
    db.syncAudit.create.mockRejectedValueOnce(new Error('sin espacio'));
    const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await guardarAvisos(db, admin(), { numero: '3001234567', activos: true });

    expect(r).toEqual({ success: false, error: MSG_NO_GUARDADA });
    expect(cfg(db)).toMatchObject({ agendadorWhatsapp: null, conflictAlertsEnabled: false });
    consola.mockRestore();
  });
});
