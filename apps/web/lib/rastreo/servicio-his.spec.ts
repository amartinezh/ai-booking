/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any -- los dobles de Prisma declaran `...args` para poder leer `mock.calls[n][0]`, y las filas de `create` se inspeccionan sin tipar cada campo del JSON */
import { LIMITES_CONSULTA_HIS, resolverRespuestaHis } from '@agenia/shared';
import { permisosDeRol, SIN_PERMISOS, type ActorRastreo, type RolRastreo } from './acceso';
import { armarExpedienteA, investigarCupoB, MSG_NO_REGISTRADA } from './servicio';
import {
  MSG_HIS_OCUPADO,
  MSG_LIMITE_HIS,
  MSG_NADA_QUE_CONSULTAR,
  iniciarConsultaHis,
  limitesConsultaHis,
  progresoDeConsultaHis,
} from './servicio-his';

// ══════════════════════════════════════════════════════════════════════════
// La consulta en vivo al HIS desde el rastreo (Fase 2): pedirla, sondearla y
// aplicar lo que respondió el hospital al veredicto.
//
// Lo que se fija aquí:
//   · falla RÁPIDO y sin efectos si el agente no puede contestar;
//   · la bitácora se escribe ANTES de preguntarle nada al hospital (falla cerrado);
//   · un rol acotado no pide la lista completa del paciente en el HIS;
//   · el tenant sale del actor y la consulta es de quien la pidió;
//   · el documento de un TERCERO nunca sale completo del servicio.
// ══════════════════════════════════════════════════════════════════════════

const ORG = 'org-1';
const AHORA = Date.now();
const MIN = 60_000;
const DIA = 86_400_000;
const INICIO = new Date(AHORA + 2 * DIA);

const actor = (role: RolRastreo, over: Partial<ActorRastreo> = {}): ActorRastreo => ({
  userId: 'u-1',
  role,
  organizationId: ORG,
  permisos: permisosDeRol(role),
  scopeEpsId: null,
  scopeDoctorId: null,
  ...over,
});
const admin = () => actor('ORG_ADMIN');
const agente = (scope: Partial<ActorRastreo> = {}) => actor('BOOKING_AGENT', scope);
const doctor = () => actor('DOCTOR', { scopeDoctorId: 'doc-7' });
const superAdmin = (org = ORG) => actor('SUPER_ADMIN', { organizationId: org });

const configLista = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  pushEnabled: true,
  pullEnabled: true,
  lookupEnabled: true,
  lastLookupCapable: true,
  lastHeartbeatAt: new Date(AHORA - 1 * MIN),
  lastHisReachable: true,
  lastHisDetail: null,
  ...over,
});

const paciente = (over: Record<string, unknown> = {}) => ({
  id: 'pac-1',
  fullName: 'María López Núñez',
  cedula: '1088123456',
  whatsappId: '573001112233',
  bsuid: null,
  regime: 'CONTRIBUTIVO',
  createdAt: new Date(AHORA - 30 * DIA),
  eps: { name: 'Sura' },
  _count: { appointments: 1 },
  ...over,
});

const citaBD = (over: Record<string, unknown> = {}) => ({
  id: 'apt-1',
  status: 'SCHEDULED',
  attendanceStatus: 'PENDING',
  origin: 'WHATSAPP',
  createdAt: new Date(AHORA - 30 * MIN),
  reminderSentAt: null,
  metaLog: null,
  scheduleSlot: {
    startTime: INICIO,
    doctorId: 'doc-1',
    doctor: { fullName: 'Ana Ruiz', isFunctionalAgenda: false },
    service: { name: 'Medicina General' },
  },
  eps: { name: 'Sura' },
  ...over,
});

/** El evento de envío ya entregado al agente: la cita "salió" hacia el hospital. */
const eventoEntregado = () => ({
  seq: BigInt(5),
  entityId: 'apt-1',
  op: 'INSERT',
  createdAt: new Date(AHORA - 25 * MIN),
  deliveredAt: new Date(AHORA - 24 * MIN),
  attempts: 1,
  deadLettered: false,
  nextAttemptAt: null,
  lastError: null,
});

interface FilaPeticion {
  id: string;
  kind: string;
  status: string;
  params: unknown;
  result: unknown;
  error: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

function mockDb() {
  const orden: string[] = [];
  const vacio = () => jest.fn(async (..._a: unknown[]) => [] as unknown[]);
  const peticiones: FilaPeticion[] = [];
  let n = 0;
  const db = {
    orden,
    peticiones,
    patientProfile: { findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    appointment: { findMany: vacio(), count: jest.fn(async (..._a: unknown[]) => 0) },
    interactionLog: { findMany: vacio() },
    waitlistEntry: { findMany: vacio() },
    chatSurvey: { findMany: vacio() },
    massNoticeRecipient: { findMany: vacio() },
    hospitalMirrorConfig: { findUnique: jest.fn(async (..._a: unknown[]) => configLista() as unknown) },
    syncOutbox: { findMany: vacio() },
    whatsappMessageLog: { findMany: vacio() },
    syncAudit: { findMany: vacio() },
    patientLookupLog: {
      count: jest.fn(async (..._a: unknown[]) => 0),
      create: jest.fn(async (..._a: unknown[]) => {
        orden.push('bitacora');
        return {};
      }),
    },
    organization: { findUnique: jest.fn(async (..._a: unknown[]) => ({ timezone: null as string | null })) },
    mirrorEntityMap: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    mirrorCatalogEntry: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    doctorProfile: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    scheduleSlot: { findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    user: { findMany: vacio() },
    hisLookupRequest: {
      count: jest.fn(async (..._a: unknown[]) => 0),
      create: jest.fn((..._a: unknown[]) => {
        orden.push('peticion');
        return { id: `req-${++n}` };
      }),
      // Honra `where.status` (lo usan la lectura del resultado y el progreso).
      findMany: jest.fn(async (arg: unknown) => {
        const where = (arg as { where?: { status?: string } })?.where;
        return peticiones.filter((p) => !where?.status || p.status === where.status);
      }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    $queryRaw: jest.fn(async (..._a: unknown[]) => [] as unknown[]),
  };
  return db;
}
type Db = ReturnType<typeof mockDb>;
const como = (db: Db) => db as never;

/** Un paciente con una cita vigente, de un médico homologado. */
function conCitaHomologada(db: Db, cita = citaBD()) {
  db.patientProfile.findFirst.mockResolvedValue({ id: 'pac-1', cedula: '1088123456' });
  db.appointment.findMany.mockResolvedValue([cita]);
  db.mirrorEntityMap.findMany.mockResolvedValue([{ agenIAId: 'doc-1', externalKey: '76' }]);
}

const entradaA = (over: Record<string, unknown> = {}) => ({
  modo: 'A' as const,
  pacienteId: 'pac-1',
  motivo: 'PACIENTE_EN_VENTANILLA',
  ...over,
});

const entradaB = (over: Record<string, unknown> = {}) => ({
  modo: 'B' as const,
  documento: '1088123456',
  medicoClave: '76',
  fecha: '2026-09-25',
  hora: '10:00',
  motivo: 'PACIENTE_EN_VENTANILLA',
  ...over,
});

/** Copia profunda de datos planos (`structuredClone` no existe en jsdom). */
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const creadas = (db: Db) =>
  db.hisLookupRequest.create.mock.calls.map((c) => (c[0] as { data: any }).data);

// ═══════════════════════════════════════════════════════════════════════════
describe('iniciarConsultaHis — escenario A', () => {
  it('con todo en orden: encola una petición por documento y una por cupo, y devuelve sus ids', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    const r = await iniciarConsultaHis(como(db), admin(), entradaA());

    expect(r).toEqual({
      success: true,
      data: { ids: ['req-1', 'req-2'], esperaMs: LIMITES_CONSULTA_HIS.esperaPantallaMs },
    });
    expect(creadas(db).map((d) => d.kind)).toEqual(['BY_DOCUMENT', 'BY_SLOT']);
  });

  it('cada petición lleva la organización del ACTOR y quién la pidió', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    await iniciarConsultaHis(como(db), admin(), entradaA());

    for (const d of creadas(db)) {
      expect(d).toMatchObject({ organizationId: ORG, requestedByUserId: 'u-1', patientId: 'pac-1' });
    }
  });

  it('🔒 un SUPER_ADMIN consulta la clínica que eligió (la del actor), no otra', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    await iniciarConsultaHis(como(db), superAdmin('org-7'), entradaA());

    expect(db.hospitalMirrorConfig.findUnique.mock.calls[0][0]).toMatchObject({
      where: { organizationId: 'org-7' },
    });
    for (const d of creadas(db)) expect(d.organizationId).toBe('org-7');
  });

  it('🧾 la bitácora se escribe ANTES de encolar nada (falla cerrado), y dice que fue en vivo', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    await iniciarConsultaHis(como(db), admin(), entradaA({ nota: 'reclamo en ventanilla' }));

    expect(db.orden).toEqual(['bitacora', 'peticion', 'peticion']);
    expect(db.patientLookupLog.create.mock.calls[0][0]).toMatchObject({
      data: {
        organizationId: ORG,
        actorUserId: 'u-1',
        actorRole: 'ORG_ADMIN',
        mode: 'A',
        queryKind: 'LIVE_HIS',
        // Enmascarada: la bitácora nunca guarda el documento completo.
        queryMasked: '•••3456',
        reason: 'PACIENTE_EN_VENTANILLA',
        openedPatientId: 'pac-1',
        liveHisRequested: true,
      },
    });
    expect(JSON.stringify(db.patientLookupLog.create.mock.calls[0][0])).not.toContain('1088123456');
  });

  it('🚨 si no se puede anotar en la bitácora, NO se le pregunta nada al hospital', async () => {
    const db = mockDb();
    conCitaHomologada(db);
    db.patientLookupLog.create.mockRejectedValue(new Error('base caída'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await iniciarConsultaHis(como(db), admin(), entradaA());

    expect(r).toEqual({ success: false, error: MSG_NO_REGISTRADA });
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
  });

  it('⚡ FALLA RÁPIDO: sin la consulta habilitada dice por qué, sin bitácora ni peticiones', async () => {
    const db = mockDb();
    conCitaHomologada(db);
    db.hospitalMirrorConfig.findUnique.mockResolvedValue(configLista({ lookupEnabled: false }));

    const r = await iniciarConsultaHis(como(db), admin(), entradaA());

    expect(r).toEqual({ success: false, error: expect.stringMatching(/no está habilitada/) });
    expect(db.patientLookupLog.create).not.toHaveBeenCalled();
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
    // Ni siquiera se busca al paciente: no hay nada que hacer con él.
    expect(db.patientProfile.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['sin espejo', null, /no tiene espejo/],
    ['con el agente caído', configLista({ lastHeartbeatAt: new Date(AHORA - 10 * MIN) }), /no da señales/],
    ['con el agente que no alcanza el HIS', configLista({ lastHisReachable: false }), /no puede comunicarse/],
    ['con un agente que no admite la consulta', configLista({ lastLookupCapable: null }), /no admite la consulta en vivo/],
  ])('⚡ %s: falla rápido con el motivo', async (_n, config, razon) => {
    const db = mockDb();
    conCitaHomologada(db);
    db.hospitalMirrorConfig.findUnique.mockResolvedValue(config);

    const r = await iniciarConsultaHis(como(db), admin(), entradaA());

    expect(r).toEqual({ success: false, error: expect.stringMatching(razon) });
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
  });

  it('🔒 un DOCTOR no puede: es la base productiva del hospital, y él no ve ni la sincronización', async () => {
    const db = mockDb();

    const r = await iniciarConsultaHis(como(db), doctor(), entradaA());

    expect(r).toEqual({ success: false, error: SIN_PERMISOS });
    expect(db.hospitalMirrorConfig.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['sin motivo', { motivo: undefined }],
    ['con un motivo que no es de la lista', { motivo: 'CURIOSEAR' }],
    ['con "otro" y sin nota', { motivo: 'OTRO' }],
  ])('%s: se rechaza antes de tocar nada', async (_n, over) => {
    const db = mockDb();
    conCitaHomologada(db);

    const r = await iniciarConsultaHis(como(db), admin(), entradaA(over));

    expect(r.success).toBe(false);
    expect(db.hospitalMirrorConfig.findUnique).not.toHaveBeenCalled();
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
  });

  it('una entrada que no es ni A ni B se rechaza', async () => {
    const db = mockDb();
    const r = await iniciarConsultaHis(como(db), admin(), { modo: 'C', motivo: 'OTRO' } as never);
    expect(r).toEqual({ success: false, error: 'Consulta inválida.' });
  });

  it('🔒 un paciente de otra clínica responde igual que uno inexistente, y no deja rastro', async () => {
    const db = mockDb();
    db.patientProfile.findFirst.mockResolvedValue(null);

    const r = await iniciarConsultaHis(como(db), admin(), entradaA({ pacienteId: 'de-otra-clinica' }));

    expect(r).toEqual({ success: false, error: 'Paciente no encontrado.' });
    expect(db.patientProfile.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'de-otra-clinica', organizationId: ORG },
    });
    expect(db.patientLookupLog.create).not.toHaveBeenCalled();
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
  });

  it('sujeto que no es un id: se rechaza', async () => {
    const db = mockDb();
    const r = await iniciarConsultaHis(como(db), admin(), entradaA({ pacienteId: { $ne: '' } }));
    expect(r).toEqual({ success: false, error: 'Sujeto inválido.' });
  });

  it('🔒 BOOKING_AGENT acotado a una EPS: solo cupos de las citas que ÉL ve, y NADA por documento', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    await iniciarConsultaHis(como(db), agente({ scopeEpsId: 'eps-9' }), entradaA());

    // Las citas que se leen para armar los cupos llevan su alcance…
    expect(db.appointment.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, patientId: 'pac-1', epsId: 'eps-9' },
    });
    // …y la lista completa del paciente en el HIS (que mostraría citas fuera de su EPS) no se pide.
    expect(creadas(db).map((d) => d.kind)).toEqual(['BY_SLOT']);
  });

  it('un BOOKING_AGENT SIN alcance acotado sí pide las dos', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    await iniciarConsultaHis(como(db), agente(), entradaA());

    expect(creadas(db).map((d) => d.kind)).toEqual(['BY_DOCUMENT', 'BY_SLOT']);
  });

  it('sin nada que preguntar (ningún médico homologado y alcance acotado): lo dice, sin bitácora', async () => {
    const db = mockDb();
    conCitaHomologada(db);
    db.mirrorEntityMap.findMany.mockResolvedValue([]);

    const r = await iniciarConsultaHis(como(db), agente({ scopeEpsId: 'eps-9' }), entradaA());

    expect(r).toEqual({ success: false, error: MSG_NADA_QUE_CONSULTAR });
    expect(db.patientLookupLog.create).not.toHaveBeenCalled();
  });

  it('los cupos que se preguntan llevan el documento SOLO para comparar (compareDocuments)', async () => {
    const db = mockDb();
    conCitaHomologada(db);

    await iniciarConsultaHis(como(db), admin(), entradaA());

    const porCupo = creadas(db).find((d) => d.kind === 'BY_SLOT');
    expect(porCupo.params).toEqual({
      slots: [{ doctorExternalKey: '76', startTimeIso: INICIO.toISOString() }],
      compareDocuments: ['1088123456'],
    });
  });

  describe('topes', () => {
    it('🚦 supera el límite de consultas por usuario: se rechaza, sin bitácora ni peticiones', async () => {
      const db = mockDb();
      conCitaHomologada(db);
      db.patientLookupLog.count.mockResolvedValue(limitesConsultaHis().max);

      const r = await iniciarConsultaHis(como(db), admin(), entradaA());

      expect(r).toEqual({ success: false, error: MSG_LIMITE_HIS });
      expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
    });

    it('el límite cuenta SOLO las consultas en vivo de ESE usuario en ESA clínica', async () => {
      const db = mockDb();
      conCitaHomologada(db);

      await iniciarConsultaHis(como(db), admin(), entradaA());

      expect(db.patientLookupLog.count.mock.calls[0][0]).toMatchObject({
        where: { organizationId: ORG, actorUserId: 'u-1', queryKind: 'LIVE_HIS' },
      });
    });

    it('el límite de consultas en vivo es más bajo que el de búsquedas (cada una lee la base del hospital)', () => {
      expect(limitesConsultaHis().max).toBeLessThan(30);
    });

    it('🚦 hay demasiadas consultas en curso en la clínica: se rechaza', async () => {
      const db = mockDb();
      conCitaHomologada(db);
      db.hisLookupRequest.count.mockResolvedValue(LIMITES_CONSULTA_HIS.maxPendientesPorOrg - 1);

      const r = await iniciarConsultaHis(como(db), admin(), entradaA());

      expect(r).toEqual({ success: false, error: MSG_HIS_OCUPADO });
      expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
    });

    it('lo que cuenta como "en curso" es solo lo pendiente de ESTA clínica', async () => {
      const db = mockDb();
      conCitaHomologada(db);

      await iniciarConsultaHis(como(db), admin(), entradaA());

      expect(db.hisLookupRequest.count.mock.calls[0][0]).toMatchObject({
        where: { organizationId: ORG, status: 'PENDIENTE' },
      });
    });
  });

  it('si la base falla al encolar: un error genérico, sin filtrar el motivo interno', async () => {
    const db = mockDb();
    conCitaHomologada(db);
    db.$transaction.mockRejectedValue(new Error('duplicate key value violates unique constraint "HisLookupRequest_pkey"'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await iniciarConsultaHis(como(db), admin(), entradaA());

    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/duplicate|constraint|pkey/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('iniciarConsultaHis — escenario B', () => {
  const conMedicoEnCatalogo = (db: Db) =>
    db.mirrorCatalogEntry.findFirst.mockResolvedValue({ id: 'c-1' });

  it('cupo exacto y citas del documento alrededor; la bitácora dice modo B y enmascara el documento', async () => {
    const db = mockDb();
    conMedicoEnCatalogo(db);

    const r = await iniciarConsultaHis(como(db), admin(), entradaB());

    expect(r.success).toBe(true);
    expect(creadas(db).map((d) => d.kind)).toEqual(['BY_DOCUMENT', 'BY_SLOT']);
    expect(db.patientLookupLog.create.mock.calls[0][0]).toMatchObject({
      data: { mode: 'B', queryKind: 'LIVE_HIS', queryMasked: '•••3456', liveHisRequested: true },
    });
    expect(db.orden[0]).toBe('bitacora');
  });

  it('la hora del cupo se convierte de la zona de la clínica a UTC', async () => {
    const db = mockDb();
    conMedicoEnCatalogo(db);

    await iniciarConsultaHis(como(db), admin(), entradaB({ fecha: '2026-09-25', hora: '10:00' }));

    const porCupo = creadas(db).find((d) => d.kind === 'BY_SLOT');
    // 10:00 en Bogotá (UTC-5) = 15:00 UTC.
    expect(porCupo.params.slots).toEqual([{ doctorExternalKey: '76', startTimeIso: '2026-09-25T15:00:00.000Z' }]);
  });

  it('con un perfil de esa clínica, la consulta queda ligada a él', async () => {
    const db = mockDb();
    conMedicoEnCatalogo(db);
    db.$queryRaw.mockResolvedValue([{ id: 'pac-1', cedula: '1088123456', fullName: 'María', whatsappId: null, bsuid: null }]);

    await iniciarConsultaHis(como(db), admin(), entradaB());

    for (const d of creadas(db)) expect(d.patientId).toBe('pac-1');
  });

  it('sin perfil (el paciente nunca escribió a AgenIA): igual se consulta, sin ligarla a nadie', async () => {
    const db = mockDb();
    conMedicoEnCatalogo(db);

    await iniciarConsultaHis(como(db), admin(), entradaB());

    for (const d of creadas(db)) expect(d.patientId).toBeNull();
  });

  it('🔒 un médico que no es de ESTA clínica se rechaza', async () => {
    const db = mockDb();

    const r = await iniciarConsultaHis(como(db), admin(), entradaB({ medicoClave: '99' }));

    expect(r).toEqual({ success: false, error: 'Ese médico no está en el catálogo de esta clínica.' });
    expect(db.mirrorEntityMap.findFirst.mock.calls[0][0]).toMatchObject({ where: { organizationId: ORG } });
    expect(db.mirrorCatalogEntry.findFirst.mock.calls[0][0]).toMatchObject({ where: { organizationId: ORG } });
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ['un documento que no es un número', { documento: 'abc' }, /cédula/],
    ['un médico vacío', { medicoClave: '  ' }, /médico/],
    ['un médico con una clave absurda', { medicoClave: 'x'.repeat(33) }, /médico/],
    ['una fecha imposible', { fecha: '2026-13-45' }, /fecha/],
    ['una hora imposible', { hora: '99:99' }, /fecha/],
  ])('%s: se rechaza sin tocar el hospital', async (_n, over, mensaje) => {
    const db = mockDb();
    conMedicoEnCatalogo(db);

    const r = await iniciarConsultaHis(como(db), admin(), entradaB(over));

    expect(r).toEqual({ success: false, error: expect.stringMatching(mensaje) });
    expect(db.hisLookupRequest.create).not.toHaveBeenCalled();
  });

  it('🔒 BOOKING_AGENT acotado: solo el cupo, sin la lista por documento', async () => {
    const db = mockDb();
    conMedicoEnCatalogo(db);

    await iniciarConsultaHis(como(db), agente({ scopeDoctorId: 'doc-1' }), entradaB());

    expect(creadas(db).map((d) => d.kind)).toEqual(['BY_SLOT']);
  });

  it('el DOCTOR no puede tampoco aquí', async () => {
    const db = mockDb();
    expect(await iniciarConsultaHis(como(db), doctor(), entradaB())).toEqual({ success: false, error: SIN_PERMISOS });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('progresoDeConsultaHis', () => {
  it('quien no tiene el permiso no sondea nada', async () => {
    const db = mockDb();
    expect(await progresoDeConsultaHis(como(db), doctor(), { ids: ['a'] })).toEqual({
      success: false,
      error: SIN_PERMISOS,
    });
    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
  });

  it('ids inválidos: se rechazan', async () => {
    const db = mockDb();
    expect(await progresoDeConsultaHis(como(db), admin(), { ids: 'x' })).toEqual({
      success: false,
      error: 'Consulta inválida.',
    });
  });

  it('🔒 lee solo las peticiones de la clínica del actor y que él pidió', async () => {
    const db = mockDb();

    await progresoDeConsultaHis(como(db), admin(), { ids: ['a'] });

    expect(db.hisLookupRequest.findMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ['a'] }, organizationId: ORG, requestedByUserId: 'u-1' },
    });
  });

  it('quien ve internos (ORG_ADMIN) recibe el texto de error del agente; el agente de reservas, una frase genérica', async () => {
    const fila = {
      id: 'a', kind: 'BY_SLOT', status: 'ERROR', params: {}, result: null,
      error: 'Failed to connect to 192.168.1.16:1433', createdAt: new Date(), resolvedAt: null,
    };
    const dbAdmin = mockDb();
    dbAdmin.peticiones.push(fila);
    const dbAgente = mockDb();
    dbAgente.peticiones.push(fila);

    const deAdmin = await progresoDeConsultaHis(como(dbAdmin), admin(), { ids: ['a'] });
    const deAgente = await progresoDeConsultaHis(como(dbAgente), agente(), { ids: ['a'] });

    expect(deAdmin).toEqual({ success: true, data: { estado: 'FALLIDA', detalle: 'Failed to connect to 192.168.1.16:1433' } });
    expect(JSON.stringify(deAgente)).not.toContain('192.168');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lo que respondió el HIS, aplicado al expediente
// ═══════════════════════════════════════════════════════════════════════════
describe('expediente A con la consulta en vivo', () => {
  const INI = INICIO.toISOString();
  const PARAMS_CUPO = { slots: [{ doctorExternalKey: '76', startTimeIso: INI }], compareDocuments: ['1088123456'] };
  const PARAMS_DOC = { patientDocuments: ['1088123456'], fromIso: new Date(AHORA - 7 * DIA).toISOString(), toIso: new Date(AHORA + 60 * DIA).toISOString() };

  const fila = (over: Record<string, unknown> = {}) => ({
    doctorExternalKey: '76', startTimeIso: INI, serviceExternalKey: '890201',
    patientDocument: '1088123456', status: 'SCHEDULED', ...over,
  });
  const guardar = (db: Db, kind: 'BY_SLOT' | 'BY_DOCUMENT', filas: unknown[], id = kind, status = 'RESUELTA') => {
    const params = kind === 'BY_SLOT' ? PARAMS_CUPO : PARAMS_DOC;
    db.peticiones.push({
      id, kind, status,
      // Una COPIA: alguna prueba muta los params y no debe contaminar a las demás.
      params: copia(params),
      result: status === 'RESUELTA' ? resolverRespuestaHis(kind, params, filas) : null,
      error: status === 'ERROR' ? 'timeout' : null,
      createdAt: new Date(AHORA - 5_000), resolvedAt: new Date(AHORA - 2_000),
    });
  };

  const abrir = async (db: Db, a: ActorRastreo, over: Record<string, unknown> = {}) => {
    db.patientProfile.findFirst.mockResolvedValue(paciente());
    db.appointment.findMany.mockResolvedValue([citaBD()]);
    db.syncOutbox.findMany.mockResolvedValue([eventoEntregado()]);
    db.mirrorEntityMap.findMany.mockResolvedValue([{ agenIAId: 'doc-1', externalKey: '76' }]);
    const r = await armarExpedienteA(como(db), a, {
      sujeto: { tipo: 'PACIENTE', id: 'pac-1' },
      motivo: 'PACIENTE_EN_VENTANILLA',
      consultaHisIds: ['BY_SLOT', 'BY_DOCUMENT'],
      ...over,
    });
    if (!r.success) throw new Error(r.error);
    return r.data;
  };
  const codigos = (e: { resultado: { veredictos: { codigo: string }[] } }) =>
    e.resultado.veredictos.map((v) => v.codigo);

  it('el cupo está a nombre del paciente → CONFIRMADA_EN_EL_HIS', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', [fila()]);

    const e = await abrir(db, admin());

    expect(codigos(e)).toContain('CONFIRMADA_EN_EL_HIS');
    expect(e.hisEnVivo.consulta?.cuposConsultados).toBe(1);
  });

  it('⚠️ entregada al agente pero el HIS no la tiene → ENTREGADA_PERO_AUSENTE', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', []);

    const e = await abrir(db, admin());

    expect(codigos(e)).toContain('ENTREGADA_PERO_AUSENTE');
  });

  it('🚨 el cupo está a nombre de OTRA persona → OTRA_IDENTIDAD, y su documento NUNCA sale completo', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', [fila({ patientDocument: '52123456' })]);

    const e = await abrir(db, admin());

    expect(codigos(e)).toContain('OTRA_IDENTIDAD');
    const todo = JSON.stringify(e);
    expect(todo).not.toContain('52123456');
    expect(todo).toContain('•••3456');
  });

  it('sin consulta en vivo (sin ids) nada cambia: los veredictos son los de AgenIA y la vista lo dice', async () => {
    const db = mockDb();

    const e = await abrir(db, admin(), { consultaHisIds: undefined });

    expect(codigos(e)).not.toContain('CONFIRMADA_EN_EL_HIS');
    expect(e.hisEnVivo).toMatchObject({ visible: true, consulta: null, aviso: null });
    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
  });

  it('🔒 la lectura del resultado va acotada a la clínica y al usuario del actor', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', []);

    await abrir(db, admin());

    expect(db.hisLookupRequest.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, requestedByUserId: 'u-1', status: 'RESUELTA', purgedAt: null },
    });
  });

  it('🔒 el resultado de una consulta hecha sobre OTRO documento no se aplica a este paciente', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', []);
    (db.peticiones[0].params as { compareDocuments: string[] }).compareDocuments = ['52123456'];

    const e = await abrir(db, admin());

    expect(e.hisEnVivo.consulta).toBeNull();
    expect(codigos(e)).not.toContain('ENTREGADA_PERO_AUSENTE');
  });

  it('🔒 un DOCTOR nunca lee lo del HIS, aunque mande ids: la vista ni siquiera lo ofrece', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', []);

    const e = await abrir(db, doctor());

    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
    expect(e.hisEnVivo).toMatchObject({ visible: false, consulta: null });
  });

  it('una clínica sin espejo no ofrece la consulta ni lee nada', async () => {
    const db = mockDb();
    db.hospitalMirrorConfig.findUnique.mockResolvedValue(null);
    guardar(db, 'BY_SLOT', []);

    const e = await abrir(db, admin());

    expect(e.hisEnVivo.visible).toBe(false);
    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
  });

  it('la vista ofrece el botón cuando se puede y dice POR QUÉ cuando no', async () => {
    const dbOk = mockDb();
    const dbCaido = mockDb();
    dbCaido.hospitalMirrorConfig.findUnique.mockResolvedValue(configLista({ lastHeartbeatAt: new Date(AHORA - 30 * MIN) }));

    const ok = await abrir(dbOk, admin(), { consultaHisIds: undefined });
    const caido = await abrir(dbCaido, admin(), { consultaHisIds: undefined });

    expect(ok.hisEnVivo.disponibilidad).toEqual({ puede: true, razon: null });
    expect(caido.hisEnVivo.disponibilidad).toMatchObject({ puede: false, razon: expect.stringMatching(/no da señales/) });
  });

  it('las citas del paciente en el HIS llegan con el médico por nombre y sin documentos', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', [fila()]);
    guardar(db, 'BY_DOCUMENT', [fila({ startTimeIso: new Date(AHORA + 9 * DIA).toISOString() })]);

    const e = await abrir(db, admin());

    expect(e.hisEnVivo.consulta?.porDocumento?.citas).toHaveLength(1);
    expect(e.hisEnVivo.consulta?.porDocumento?.citas[0]).toMatchObject({ estado: 'SCHEDULED', medico: expect.any(String) });
    expect(JSON.stringify(e.hisEnVivo)).not.toContain('1088123456');
  });

  it('⚠️ una búsqueda falló y la otra no: el resultado se marca PARCIAL', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', [fila()]);
    guardar(db, 'BY_DOCUMENT', [], 'BY_DOCUMENT', 'ERROR');

    const e = await abrir(db, admin());

    expect(e.hisEnVivo.aviso).toMatch(/parcial/);
    // Lo que sí llegó se aplica.
    expect(codigos(e)).toContain('CONFIRMADA_EN_EL_HIS');
  });

  it('🧾 abrir con lo que respondió el HIS queda anotado como consulta en vivo', async () => {
    const db = mockDb();
    guardar(db, 'BY_SLOT', []);

    await abrir(db, admin());

    expect(db.patientLookupLog.create.mock.calls[0][0]).toMatchObject({
      data: { queryKind: 'OPEN', liveHisRequested: true },
    });
  });

  it('abrir SIN lo del HIS no se anota como consulta en vivo', async () => {
    const db = mockDb();

    await abrir(db, admin(), { consultaHisIds: undefined });

    expect(db.patientLookupLog.create.mock.calls[0][0]).toMatchObject({ data: { liveHisRequested: false } });
  });

  it('ids que no son válidos se ignoran sin romper el expediente', async () => {
    const db = mockDb();

    const e = await abrir(db, admin(), { consultaHisIds: { $ne: null } });

    expect(e.hisEnVivo.consulta).toBeNull();
    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('expediente B con la consulta en vivo', () => {
  const INI = '2026-09-25T15:00:00.000Z';
  const DOCS = ['1088123456'];
  const PARAMS_CUPO = { slots: [{ doctorExternalKey: '76', startTimeIso: INI }], compareDocuments: DOCS };
  const fila = (over: Record<string, unknown> = {}) => ({
    doctorExternalKey: '76', startTimeIso: INI, patientDocument: '1088123456', status: 'SCHEDULED', ...over,
  });
  const guardar = (db: Db, filas: unknown[]) =>
    db.peticiones.push({
      id: 'BY_SLOT', kind: 'BY_SLOT', status: 'RESUELTA', params: copia(PARAMS_CUPO),
      result: resolverRespuestaHis('BY_SLOT', PARAMS_CUPO, filas), error: null,
      createdAt: new Date(AHORA - 5_000), resolvedAt: new Date(AHORA - 2_000),
    });

  const investigar = async (db: Db, a: ActorRastreo, over: Record<string, unknown> = {}) => {
    db.mirrorCatalogEntry.findFirst.mockResolvedValue({ label: 'RUIZ ANA' });
    const r = await investigarCupoB(como(db), a, {
      documento: '1088123456', medicoClave: '76', fecha: '2026-09-25', hora: '10:00',
      motivo: 'PACIENTE_EN_VENTANILLA', consultaHisIds: ['BY_SLOT'], ...over,
    });
    if (!r.success) throw new Error(r.error);
    return r.data;
  };
  const codigos = (e: { resultado: { veredictos: { codigo: string }[] } }) =>
    e.resultado.veredictos.map((v) => v.codigo);

  it('el HIS no tiene nada en ese cupo → NO_ESTA_EN_EL_HIS', async () => {
    const db = mockDb();
    guardar(db, []);

    const e = await investigar(db, admin());

    expect(codigos(e)).toContain('NO_ESTA_EN_EL_HIS');
  });

  it('🚨 el cupo es de OTRA persona → OTRA_IDENTIDAD, con su documento enmascarado', async () => {
    const db = mockDb();
    guardar(db, [fila({ patientDocument: '52123456' })]);

    const e = await investigar(db, admin());

    expect(codigos(e)).toContain('OTRA_IDENTIDAD');
    expect(JSON.stringify(e)).not.toContain('52123456');
  });

  it('el cupo es del paciente → el HIS lo confirma', async () => {
    const db = mockDb();
    guardar(db, [fila()]);

    const e = await investigar(db, admin());

    expect(codigos(e)).not.toContain('NO_ESTA_EN_EL_HIS');
    expect(codigos(e)).not.toContain('OTRA_IDENTIDAD');
    expect(e.hisEnVivo.consulta?.cuposConsultados).toBe(1);
  });

  it('sin ids, B sigue siendo el parcial de la Fase 1 y la vista ofrece la consulta', async () => {
    const db = mockDb();

    const e = await investigar(db, admin(), { consultaHisIds: undefined });

    expect(e.hisEnVivo).toMatchObject({ visible: true, consulta: null });
    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
  });

  it('🔒 lee solo lo pedido por este usuario en esta clínica, y solo con el permiso', async () => {
    const db = mockDb();
    guardar(db, []);

    await investigar(db, admin());

    expect(db.hisLookupRequest.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, requestedByUserId: 'u-1' },
    });
  });

  it('🔒 una consulta hecha sobre otro documento no se aplica', async () => {
    const db = mockDb();
    guardar(db, []);
    (db.peticiones[0].params as { compareDocuments: string[] }).compareDocuments = ['52123456'];

    const e = await investigar(db, admin());

    expect(e.hisEnVivo.consulta).toBeNull();
    expect(codigos(e)).not.toContain('NO_ESTA_EN_EL_HIS');
  });

  it('🧾 queda anotado como consulta en vivo', async () => {
    const db = mockDb();
    guardar(db, []);

    await investigar(db, admin());

    expect(db.patientLookupLog.create.mock.calls[0][0]).toMatchObject({ data: { mode: 'B', liveHisRequested: true } });
  });
});
