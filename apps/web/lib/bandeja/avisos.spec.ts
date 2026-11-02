/* eslint-disable @typescript-eslint/no-explicit-any -- el doble de la base es una tabla en memoria: sus filas son de forma libre */
import { permisosBandeja, SIN_PERMISOS, type ActorBandeja, type RolBandeja } from './acceso';
import {
  MSG_LISTA_INVALIDA,
  MSG_NUMERO_INVALIDO,
  MSG_PERSONA_AJENA,
  MSG_SIN_ESPEJO,
  MSG_SIN_NOMBRE,
  MSG_TOPE,
  estadoAvisos,
  estadoEnvio,
  guardarAvisos,
} from './avisos';
import { MSG_NO_GUARDADA } from './servicio';

/**
 * 📣 La lista de quién recibe los avisos de la Bandeja (docs/PLAN_AVISOS_AGENDADORES.md).
 * Lo que se fija: el tenant en todo, solo el ORG_ADMIN configura, el celular completo
 * solo para él, la lista sale de las personas REALES de la clínica, y el cambio y su
 * constancia van juntos o no van.
 */

const ORG = 'org-1';
const OTRA_ORG = 'org-2';
const AHORA = new Date('2026-11-02T15:00:00.000Z');

// ── Doble de la base: filtra de verdad, une las relaciones y respeta los únicos ──

type Fila = Record<string, any>;

function coincide(fila: Fila, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([campo, cond]) => {
    if (campo === 'OR') return (cond as Record<string, any>[]).some((sub) => coincide(fila, sub));
    const v = fila[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      throw new Error(`el doble no soporta la condición sobre «${campo}»`);
    }
    return v === cond;
  });
}

class Tabla {
  filas: Fila[] = [];
  private n = 0;
  constructor(
    private readonly unir: (f: Fila) => Fila = (f) => f,
    private readonly unicos: string[][] = [],
  ) {}
  private choca(f: Fila, ignorar?: Fila) {
    for (const campos of this.unicos) {
      if (campos.some((c) => f[c] == null)) continue;
      if (this.filas.some((o) => o !== ignorar && campos.every((c) => o[c] === f[c]))) {
        throw Object.assign(new Error(`Unique constraint failed on ${campos.join(',')}`), { code: 'P2002' });
      }
    }
  }
  findMany = jest.fn(async (args: any = {}) => this.filas.filter((f) => coincide(f, args.where)).map((f) => this.unir({ ...f })));
  findFirst = jest.fn(async (args: any = {}) => (await this.findMany(args))[0] ?? null);
  findUnique = jest.fn(async (args: any = {}) => (await this.findMany(args))[0] ?? null);
  updateMany = jest.fn(async (args: any) => {
    const objetivo = this.filas.filter((f) => coincide(f, args.where));
    for (const f of objetivo) {
      this.choca({ ...f, ...args.data }, f);
      Object.assign(f, args.data);
    }
    return { count: objetivo.length };
  });
  deleteMany = jest.fn(async (args: any) => {
    const antes = this.filas.length;
    this.filas = this.filas.filter((f) => !coincide(f, args.where));
    return { count: antes - this.filas.length };
  });
  create = jest.fn(async (args: any) => {
    const f = { id: `gen-${++this.n}`, createdAt: AHORA, ...args.data };
    this.choca(f);
    this.filas.push(f);
    return { ...f };
  });
}

function mockDb() {
  const t: Record<string, Tabla> = {};
  const perfilDe = (userId: string) => t.agentProfile.filas.find((p) => p.userId === userId) ?? null;
  const usuario = (id: string | null) => {
    const u = id ? t.user.filas.find((x) => x.id === id) : null;
    return u ? { ...u, agentProfile: perfilDe(u.id) } : null;
  };
  t.user = new Tabla((u) => ({ ...u, agentProfile: perfilDe(u.id) }));
  t.agentProfile = new Tabla();
  t.syncAlertRecipient = new Tabla((r) => ({ ...r, user: usuario(r.userId ?? null) }), [
    ['organizationId', 'phone'],
    ['organizationId', 'userId'],
  ]);
  t.hospitalMirrorConfig = new Tabla();
  t.whatsappTemplate = new Tabla();
  t.whatsappMessageLog = new Tabla();
  t.organization = new Tabla();
  t.eps = new Tabla();
  t.doctorProfile = new Tabla();
  t.syncAudit = new Tabla();
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

const actor = (role: RolBandeja, over: Partial<ActorBandeja> = {}): ActorBandeja => ({
  userId: 'u-admin',
  email: 'admin@hsvp.co',
  role,
  organizationId: ORG,
  permisos: permisosBandeja(role),
  scopeEpsId: null,
  scopeDoctorId: null,
  ...over,
});
const admin = () => actor('ORG_ADMIN');
const agente = (userId = 'u-karen') => actor('BOOKING_AGENT', { userId, email: `${userId}@hsvp.co` });

/** La clínica de Anserma en chico: un admin, dos agendadoras (una acotada a Sura), un médico y gente ajena. */
function sembrar(db: any, { plantillas = true } = {}) {
  db.organization.filas.push({ id: ORG, timezone: null });
  db.hospitalMirrorConfig.filas.push(
    { organizationId: ORG, enabled: true, conflictAlertsEnabled: true },
    { organizationId: OTRA_ORG, enabled: true, conflictAlertsEnabled: false },
  );
  if (plantillas) {
    db.whatsappTemplate.filas.push(
      { id: 't1', organizationId: ORG, kind: 'SYNC_EXCEPTION_ALERT', isActive: true },
      { id: 't2', organizationId: ORG, kind: 'PATIENT_REQUEST_ALERT', isActive: true },
    );
  }
  db.user.filas.push(
    { id: 'u-admin', organizationId: ORG, email: 'admin@hsvp.co', role: 'ORG_ADMIN' },
    { id: 'u-karen', organizationId: ORG, email: 'karen@hsvp.co', role: 'BOOKING_AGENT' },
    { id: 'u-ana', organizationId: ORG, email: 'ana@hsvp.co', role: 'BOOKING_AGENT' },
    { id: 'u-medico', organizationId: ORG, email: 'medico@hsvp.co', role: 'DOCTOR' },
    { id: 'u-ajeno', organizationId: OTRA_ORG, email: 'ajeno@otra.co', role: 'BOOKING_AGENT' },
  );
  db.agentProfile.filas.push(
    { userId: 'u-karen', organizationId: ORG, fullName: 'Karen Muñoz', phone: '+57 310 555 0101', epsId: null, doctorId: null },
    { userId: 'u-ana', organizationId: ORG, fullName: 'Ana García', phone: null, epsId: 'eps-sura', doctorId: 'doc-1' },
    { userId: 'u-ajeno', organizationId: OTRA_ORG, fullName: 'Ajeno', phone: null, epsId: null, doctorId: null },
  );
  db.eps.filas.push({ id: 'eps-sura', organizationId: ORG, name: 'Sura' });
  db.doctorProfile.filas.push({ id: 'doc-1', organizationId: ORG, fullName: 'Luis Pérez', isFunctionalAgenda: false });
}

const fila = (db: any, over: Fila = {}) => {
  const f = {
    id: `r-${db.syncAlertRecipient.filas.length + 1}`,
    organizationId: ORG,
    userId: null,
    label: null,
    phone: '573105550101',
    mode: 'AVISOS',
    syncAlerts: true,
    patientRequestAlerts: true,
    isActive: true,
    lastSentAt: null,
    lastWamid: null,
    lastError: null,
    lastErrorAt: null,
    lastTestAt: null,
    createdAt: AHORA,
    ...over,
  };
  db.syncAlertRecipient.filas.push(f);
  return f;
};

const entrada = (over: Fila = {}) => ({
  phone: '310 555 0101',
  mode: 'AVISOS',
  syncAlerts: true,
  patientRequestAlerts: true,
  isActive: true,
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════════
// estadoAvisos
// ═════════════════════════════════════════════════════════════════════════════

describe('estadoAvisos — ¿salen? ¿a quién?', () => {
  it('✅ con alguien en la lista y las plantillas: salen los dos avisos', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { userId: 'u-karen' });
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: true, razon: null, razonPacientes: null, alertasActivas: true, plantilla: true, plantillaPacientes: true });
    expect(d.cobertura.personas).toBe(1);
  });

  it('sin nadie en la lista: no salen y dice qué hacer', async () => {
    const db = mockDb();
    sembrar(db);
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d.salen).toBe(false);
    expect(d.razon).toMatch(/Nadie recibe el aviso.*Configurar avisos/);
    expect(d.razonPacientes).toMatch(/Nadie/);
  });

  it('solo «Solo recordatorios», o solo en pausa: tampoco salen', async () => {
    for (const over of [{ mode: 'SOLO_RECORDATORIOS' }, { isActive: false }]) {
      const db = mockDb();
      sembrar(db);
      fila(db, over);
      expect(((await estadoAvisos(db, admin())) as any).data.salen).toBe(false);
    }
  });

  it('cada aviso por su lado: quien no marcó pedidos de pacientes no los cubre', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { patientRequestAlerts: false });
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: true, razonPacientes: expect.stringMatching(/Nadie en la lista/) });
  });

  it.each([
    ['espejo apagado', (db: any) => (db.hospitalMirrorConfig.filas[0].enabled = false), /espejo.*apagado/i],
    ['avisos apagados', (db: any) => (db.hospitalMirrorConfig.filas[0].conflictAlertsEnabled = false), /apagados/],
    ['sin plantilla del aviso', (db: any) => (db.whatsappTemplate.filas = db.whatsappTemplate.filas.slice(1)), /plantilla/i],
  ])('%s: lo dice', async (_n, romper, patron) => {
    const db = mockDb();
    sembrar(db);
    fila(db);
    romper(db);
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d.salen).toBe(false);
    expect(d.razon).toMatch(patron);
  });

  it('sin la plantilla de pedidos de pacientes, el otro aviso sale igual', async () => {
    const db = mockDb();
    sembrar(db);
    db.whatsappTemplate.filas = db.whatsappTemplate.filas.slice(0, 1);
    fila(db);
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: true, plantillaPacientes: false, razonPacientes: expect.stringMatching(/pedidos de pacientes/) });
  });

  it('🏢 lee la lista y las plantillas de SU clínica', async () => {
    const db = mockDb();
    sembrar(db, { plantillas: false });
    db.whatsappTemplate.filas.push({ id: 'tx', organizationId: OTRA_ORG, kind: 'SYNC_EXCEPTION_ALERT', isActive: true });
    fila(db, { organizationId: OTRA_ORG });
    const d = ((await estadoAvisos(db, admin())) as any).data;
    expect(d).toMatchObject({ salen: false, plantilla: false });
    expect(d.cobertura.personas).toBe(0);
  });

  it('sin permiso de ver: «Sin permisos.»', async () => {
    await expect(estadoAvisos(mockDb(), actor('DOCTOR'))).resolves.toEqual({ success: false, error: SIN_PERMISOS });
  });

  describe('la lista para configurar', () => {
    it('🔒 solo para el administrador: el agendador no recibe la lista ni ningún celular completo', async () => {
      const db = mockDb();
      sembrar(db);
      fila(db, { userId: 'u-karen', phone: '573105550101' });
      fila(db, { label: 'Coordinación', phone: '573209998877' });
      const d = ((await estadoAvisos(db, agente('u-ana'))) as any).data;
      expect(d.destinatarios).toBeNull();
      expect(JSON.stringify(d)).not.toMatch(/3105550101|3209998877/);
    });

    it('trae a TODOS los agendadores y administradores de la clínica, estén o no en la lista, y después los números sin cuenta', async () => {
      const db = mockDb();
      sembrar(db);
      fila(db, { id: 'r-ana', userId: 'u-ana', phone: '573105550103', mode: 'SOLO_RECORDATORIOS' });
      fila(db, { id: 'r-coord', label: 'Coordinación', phone: '573209998877' });
      const lista = ((await estadoAvisos(db, admin())) as any).data.destinatarios as any[];

      expect(lista.map((x) => [x.nombre, x.rol, x.recibe])).toEqual([
        ['Ana García', 'BOOKING_AGENT', 'SOLO_RECORDATORIOS'],
        ['Karen Muñoz', 'BOOKING_AGENT', 'NO'],
        ['admin@hsvp.co', 'ORG_ADMIN', 'NO'],
        ['Coordinación', null, 'AVISOS'],
      ]);
      // Ni el médico, ni el agendador de otra clínica.
      expect(JSON.stringify(lista)).not.toMatch(/medico@|Ajeno/);
    });

    it('el alcance: «Todo», o la EPS y el médico del agendador acotado', async () => {
      const db = mockDb();
      sembrar(db);
      const lista = ((await estadoAvisos(db, admin())) as any).data.destinatarios as any[];
      expect(lista.find((x) => x.nombre === 'Karen Muñoz').alcance).toBe('Todo');
      expect(lista.find((x) => x.nombre === 'Ana García').alcance).toBe('EPS Sura · Dr(a). Luis Pérez');
    });

    it('quien no recibe trae precargado el celular de su perfil, ya normalizado', async () => {
      const db = mockDb();
      sembrar(db);
      const lista = ((await estadoAvisos(db, admin())) as any).data.destinatarios as any[];
      expect(lista.find((x) => x.nombre === 'Karen Muñoz')).toMatchObject({ id: null, phone: '573105550101', syncAlerts: true, patientRequestAlerts: true });
      expect(lista.find((x) => x.nombre === 'Ana García').phone).toBeNull();
    });

    it('el estado del último aviso sale del libro de mensajes de SU clínica', async () => {
      const db = mockDb();
      sembrar(db);
      fila(db, { userId: 'u-karen', lastSentAt: AHORA, lastWamid: 'wamid.k' });
      db.whatsappMessageLog.filas.push(
        { organizationId: ORG, wamid: 'wamid.k', status: 'READ', statusAt: new Date('2026-11-02T15:04:00.000Z'), errorDetail: null },
      );
      const lista = ((await estadoAvisos(db, admin())) as any).data.destinatarios as any[];
      expect(lista.find((x) => x.nombre === 'Karen Muñoz').estado).toEqual({ tono: 'ok', texto: expect.stringMatching(/^Leído · .*10:04/) });
      expect(db.whatsappMessageLog.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG });
    });
  });

  it('«yo»: el agendador sabe si recibe y a qué número (enmascarado)', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { userId: 'u-karen', phone: '573105550101', patientRequestAlerts: false });
    expect(((await estadoAvisos(db, agente('u-karen'))) as any).data.yo).toEqual({
      recibe: true,
      numero: '•••0101',
      modo: 'AVISOS',
      syncAlerts: true,
      patientRequestAlerts: false,
      enPausa: false,
    });
    expect(((await estadoAvisos(db, agente('u-ana'))) as any).data.yo).toMatchObject({ recibe: false, numero: null });
  });
});

describe('estadoEnvio — la columna «Estado»', () => {
  const base = { lastSentAt: null as Date | null, lastError: null as string | null, lastErrorAt: null as Date | null };
  const antes = new Date('2026-11-01T15:00:00.000Z');

  it.each([
    ['nunca se le envió', base, null, 'nunca', /Sin envíos/],
    ['Meta lo aceptó y no ha dicho más', { ...base, lastSentAt: AHORA }, null, 'pendiente', /^Enviado/],
    ['entregado', { ...base, lastSentAt: AHORA }, { status: 'DELIVERED', statusAt: AHORA, errorDetail: null }, 'ok', /^Entregado/],
    ['Meta no lo entregó después', { ...base, lastSentAt: AHORA }, { status: 'FAILED', statusAt: AHORA, errorDetail: 'no tiene WhatsApp' }, 'error', /no lo entregó.*no tiene WhatsApp/],
    ['el último rechazo es más nuevo que el último envío', { lastSentAt: antes, lastError: 'número inválido', lastErrorAt: AHORA }, null, 'error', /No le salió.*número inválido/],
    ['el rechazo es viejo y después salió', { lastSentAt: AHORA, lastError: 'x', lastErrorAt: antes }, null, 'pendiente', /^Enviado/],
  ])('%s', (_n, f, mensaje, tono, texto) => {
    const e = estadoEnvio(f, mensaje as any);
    expect(e.tono).toBe(tono);
    expect(e.texto).toMatch(texto);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// guardarAvisos
// ═════════════════════════════════════════════════════════════════════════════

describe('guardarAvisos', () => {
  const lista = (db: any) => db.syncAlertRecipient.filas.filter((f: Fila) => f.organizationId === ORG);

  it('guarda a cada persona con su celular normalizado, su modo y sus avisos, y la constancia ENMASCARADA', async () => {
    const db = mockDb();
    sembrar(db);
    const r = await guardarAvisos(db, admin(), {
      activos: true,
      destinatarios: [
        entrada({ userId: 'u-karen', phone: '+57 310 555 0101' }),
        entrada({ userId: 'u-ana', phone: '3105550103', mode: 'SOLO_RECORDATORIOS', patientRequestAlerts: false }),
        entrada({ label: '  Coordinación  de citas ', phone: '320 999 8877' }),
      ],
    });
    expect(r).toEqual({ success: true, data: { activos: true, personas: 3 } });
    expect(lista(db).map((f: Fila) => [f.userId, f.label, f.phone, f.mode, f.patientRequestAlerts, f.createdByUserId])).toEqual([
      ['u-karen', null, '573105550101', 'AVISOS', true, 'u-admin'],
      ['u-ana', null, '573105550103', 'SOLO_RECORDATORIOS', false, 'u-admin'],
      [null, 'Coordinación de citas', '573209998877', 'AVISOS', true, 'u-admin'],
    ]);
    const a = db.syncAudit.filas[0];
    expect(a).toMatchObject({ organizationId: ORG, direction: 'CONFIG', entityType: 'SyncAlertRecipient', op: 'ALERT_SETTINGS_CHANGE', outcome: 'OK' });
    expect(a.detail).toMatch(/activos; 3 personas reciben/);
    expect(a.detail).toMatch(/\+Karen Muñoz \(•••0101, avisos y recordatorios, citas y pedidos\)/);
    expect(a.detail).toMatch(/admin@hsvp\.co/);
    expect(a.detail).not.toMatch(/3105550101|3209998877/);
  });

  it('quien no llega sale de la lista; quien sigue conserva su fila (y su historial de envíos)', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { id: 'r-karen', userId: 'u-karen', phone: '573105550101', lastSentAt: AHORA, lastWamid: 'w1' });
    fila(db, { id: 'r-viejo', label: 'Configurado antes', phone: '573128513575' });

    await guardarAvisos(db, admin(), { activos: true, destinatarios: [entrada({ userId: 'u-karen', patientRequestAlerts: false })] });

    expect(lista(db)).toHaveLength(1);
    expect(lista(db)[0]).toMatchObject({ id: 'r-karen', patientRequestAlerts: false, lastSentAt: AHORA, lastWamid: 'w1' });
    expect(db.syncAudit.filas[0].detail).toMatch(/−Configurado antes \(•••3575\)/);
    expect(db.syncAudit.filas[0].detail).toMatch(/Karen Muñoz: •••0101, avisos y recordatorios, citas/);
  });

  it('otro número para la misma persona: lo que se sabía del anterior se borra', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { id: 'r-karen', userId: 'u-karen', phone: '573105550101', lastSentAt: AHORA, lastWamid: 'w1', lastError: 'x', lastErrorAt: AHORA, lastTestAt: AHORA });
    await guardarAvisos(db, admin(), { activos: true, destinatarios: [entrada({ userId: 'u-karen', phone: '3005550000' })] });
    expect(lista(db)[0]).toMatchObject({ id: 'r-karen', phone: '573005550000', lastSentAt: null, lastWamid: null, lastError: null, lastErrorAt: null, lastTestAt: null });
  });

  it('un número sin cuenta se reconoce por su fila: se le puede cambiar el nombre', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { id: 'r-coord', label: 'Configurado antes', phone: '573128513575' });
    await guardarAvisos(db, admin(), { activos: true, destinatarios: [entrada({ id: 'r-coord', label: 'Andrés (soporte)', phone: '312 851 3575' })] });
    expect(lista(db)).toEqual([expect.objectContaining({ id: 'r-coord', label: 'Andrés (soporte)' })]);
  });

  it('un celular puede pasar de un número suelto a la cuenta de su dueño en el mismo guardado', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { id: 'r-viejo', label: 'Configurado antes', phone: '573105550101' });
    const r = await guardarAvisos(db, admin(), { activos: true, destinatarios: [entrada({ userId: 'u-karen', phone: '3105550101' })] });
    expect(r.success).toBe(true);
    expect(lista(db)).toEqual([expect.objectContaining({ userId: 'u-karen', phone: '573105550101' })]);
  });

  it('lista vacía: nadie recibe (los avisos quedan solo en la bandeja)', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db);
    await expect(guardarAvisos(db, admin(), { activos: false, destinatarios: [] })).resolves.toEqual({
      success: true,
      data: { activos: false, personas: 0 },
    });
    expect(lista(db)).toHaveLength(0);
    expect(db.hospitalMirrorConfig.filas[0].conflictAlertsEnabled).toBe(false);
    expect(db.syncAudit.filas[0].detail).toMatch(/apagados; 0 personas reciben/);
  });

  it('🏢 solo toca SU clínica: la lista y el interruptor de la otra quedan igual', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { id: 'r-otra', organizationId: OTRA_ORG, phone: '573000000001' });
    await guardarAvisos(db, admin(), { activos: true, destinatarios: [] });
    expect(db.syncAlertRecipient.filas).toEqual([expect.objectContaining({ id: 'r-otra' })]);
    expect(db.hospitalMirrorConfig.filas[1].conflictAlertsEnabled).toBe(false);
  });

  describe('lo que se rechaza, y entonces NADA cambia', () => {
    const casos: [string, unknown[], string | RegExp][] = [
      ['un celular inválido (dice de quién)', [entrada({ userId: 'u-karen', phone: '12345' })], `Karen Muñoz: ${MSG_NUMERO_INVALIDO}`],
      ['un celular vacío', [entrada({ label: 'Coordinación', phone: ' ' })], `Coordinación: ${MSG_NUMERO_INVALIDO}`],
      ['el mismo celular dos veces', [entrada({ userId: 'u-karen' }), entrada({ label: 'X', phone: '+573105550101' })], /•••0101 está dos veces/],
      ['la misma persona dos veces', [entrada({ userId: 'u-karen' }), entrada({ userId: 'u-karen', phone: '3005550000' })], MSG_LISTA_INVALIDA],
      ['una persona de OTRA clínica', [entrada({ userId: 'u-ajeno' })], MSG_PERSONA_AJENA],
      ['un médico (no es agendador ni administrador)', [entrada({ userId: 'u-medico' })], MSG_PERSONA_AJENA],
      ['un número sin cuenta y sin nombre', [entrada({ label: '   ' })], MSG_SIN_NOMBRE],
      ['un nombre larguísimo', [entrada({ label: 'x'.repeat(61) })], MSG_SIN_NOMBRE],
      ['una fila que ya no existe (pantalla vieja)', [entrada({ id: 'r-borrada', label: 'X' })], MSG_LISTA_INVALIDA],
      ['sin ningún aviso marcado', [entrada({ userId: 'u-karen', syncAlerts: false, patientRequestAlerts: false })], /Karen Muñoz: marca al menos un aviso/],
      ['un modo que no existe', [entrada({ userId: 'u-karen', mode: 'TODO' })], MSG_LISTA_INVALIDA],
      ['casillas que no son booleanos', [entrada({ userId: 'u-karen', isActive: 'true' })], MSG_LISTA_INVALIDA],
      ['algo que no es una fila', [null], MSG_LISTA_INVALIDA],
      ['«Solo recordatorios» sin nadie que reciba el primer aviso', [entrada({ userId: 'u-karen', mode: 'SOLO_RECORDATORIOS' })], /Nadie recibe el primer aviso/],
    ];
    it.each(casos)('%s', async (_n, destinatarios, error) => {
      const db = mockDb();
      sembrar(db);
      fila(db, { id: 'r-karen', userId: 'u-karen' });
      const r = (await guardarAvisos(db, admin(), { activos: false, destinatarios })) as { success: false; error: string };
      expect(r.success).toBe(false);
      if (typeof error === 'string') expect(r.error).toBe(error);
      else expect(r.error).toMatch(error);
      expect(lista(db)).toEqual([expect.objectContaining({ id: 'r-karen' })]);
      expect(db.hospitalMirrorConfig.filas[0].conflictAlertsEnabled).toBe(true);
      expect(db.syncAudit.filas).toHaveLength(0);
    });

    it(`más de 15 activas (N7); en pausa no cuentan`, async () => {
      const db = mockDb();
      sembrar(db);
      const muchas = (n: number, isActive = true) =>
        Array.from({ length: n }, (_, i) => entrada({ label: `P${i}`, phone: `30055500${String(i).padStart(2, '0')}`, isActive }));
      await expect(guardarAvisos(db, admin(), { activos: true, destinatarios: muchas(16) })).resolves.toEqual({ success: false, error: MSG_TOPE });
      const r = await guardarAvisos(db, admin(), {
        activos: true,
        destinatarios: [...muchas(15), entrada({ label: 'En pausa', phone: '3209990000', isActive: false })],
      });
      expect(r).toEqual({ success: true, data: { activos: true, personas: 15 } });
    });

    it('«activos» tiene que ser un booleano y la lista un arreglo', async () => {
      const db = mockDb();
      sembrar(db);
      for (const e of [{ activos: 'true', destinatarios: [] }, { activos: true, destinatarios: 'x' }, { activos: true, destinatarios: undefined }]) {
        expect((await guardarAvisos(db, admin(), e as any)).success).toBe(false);
      }
      expect(db.syncAudit.filas).toHaveLength(0);
    });
  });

  it('🔒 solo el ORG_ADMIN: un BOOKING_AGENT, un DOCTOR o un SUPER_ADMIN reciben «Sin permisos.»', async () => {
    const db = mockDb();
    sembrar(db);
    for (const a of [agente(), actor('DOCTOR'), actor('SUPER_ADMIN')]) {
      await expect(guardarAvisos(db, a, { activos: true, destinatarios: [entrada({ userId: 'u-karen' })] })).resolves.toEqual({
        success: false,
        error: SIN_PERMISOS,
      });
    }
    expect(lista(db)).toHaveLength(0);
  });

  it('sin fila de espejo para la clínica: se dice y nada queda guardado', async () => {
    const db = mockDb();
    sembrar(db);
    db.hospitalMirrorConfig.filas = db.hospitalMirrorConfig.filas.filter((f: Fila) => f.organizationId !== ORG);
    await expect(guardarAvisos(db, admin(), { activos: true, destinatarios: [entrada({ userId: 'u-karen' })] })).resolves.toEqual({
      success: false,
      error: MSG_SIN_ESPEJO,
    });
    expect(lista(db)).toHaveLength(0);
    expect(db.syncAudit.filas).toHaveLength(0);
  });

  it('⚛️ si la constancia falla, todo se revierte (la lista y el interruptor)', async () => {
    const db = mockDb();
    sembrar(db);
    fila(db, { id: 'r-viejo', label: 'Configurado antes', phone: '573128513575' });
    db.syncAudit.create.mockRejectedValueOnce(new Error('sin espacio'));
    const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await guardarAvisos(db, admin(), { activos: false, destinatarios: [entrada({ userId: 'u-karen' })] });

    expect(r).toEqual({ success: false, error: MSG_NO_GUARDADA });
    expect(lista(db)).toEqual([expect.objectContaining({ id: 'r-viejo' })]);
    expect(db.hospitalMirrorConfig.filas[0].conflictAlertsEnabled).toBe(true);
    consola.mockRestore();
  });
});
