/* eslint-disable @typescript-eslint/no-unused-vars -- los dobles de Prisma declaran `...args` para poder leer `mock.calls[n][0]` con tipos */
import { permisosDeRol, SIN_PERMISOS, type ActorRastreo, type RolRastreo } from './acceso';
import {
  MAX_CANDIDATOS,
  MSG_LIMITE,
  MSG_NO_REGISTRADA,
  armarExpedienteA,
  buscarCandidatos,
  investigarCupoB,
  limitesDeBusqueda,
  listarConsultas,
  opcionesCupoHis,
  revelarIdentidad,
} from './servicio';

const ORG = 'org-1';
const AHORA = Date.now();
const MIN = 60_000;
const DIA = 86_400_000;

// ── Actores ─────────────────────────────────────────────────────────────────

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

// ── Doble de la base ────────────────────────────────────────────────────────

function mockDb() {
  const vacio = () => jest.fn(async (..._a: unknown[]) => [] as unknown[]);
  return {
    patientProfile: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    appointment: {
      findMany: vacio(),
      count: jest.fn(async (..._a: unknown[]) => 0),
      findFirst: jest.fn(async (..._a: unknown[]) => null as unknown),
    },
    interactionLog: { findMany: vacio() },
    waitlistEntry: { findMany: vacio() },
    chatSurvey: { findMany: vacio() },
    massNoticeRecipient: { findMany: vacio() },
    hospitalMirrorConfig: { findUnique: jest.fn(async (..._a: unknown[]) => null as unknown) },
    syncOutbox: { findMany: vacio() },
    whatsappMessageLog: { findMany: vacio() },
    syncAudit: { findMany: vacio() },
    patientLookupLog: {
      count: jest.fn(async (..._a: unknown[]) => 0),
      create: jest.fn(async (..._a: unknown[]) => ({})),
      findMany: vacio(),
    },
    organization: { findUnique: jest.fn(async (..._a: unknown[]) => ({ timezone: null as string | null })) },
    mirrorEntityMap: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    mirrorCatalogEntry: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    doctorProfile: { findMany: vacio(), findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    scheduleSlot: { findFirst: jest.fn(async (..._a: unknown[]) => null as unknown) },
    user: { findMany: vacio() },
    $queryRaw: jest.fn(async (..._a: unknown[]) => [] as unknown[]),
  };
}
type Db = ReturnType<typeof mockDb>;
const como = (db: Db) => db as never;

// ── Filas ───────────────────────────────────────────────────────────────────

const paciente = (over: Record<string, unknown> = {}) => ({
  id: 'pac-1',
  fullName: 'María López Núñez',
  cedula: '1088123456',
  whatsappId: '573001112233',
  bsuid: null,
  regime: 'CONTRIBUTIVO',
  createdAt: new Date(AHORA - 30 * DIA),
  eps: { name: 'Sura' },
  _count: { appointments: 2 },
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
    startTime: new Date(AHORA + 2 * DIA),
    doctor: { fullName: 'Ana Ruiz', isFunctionalAgenda: false },
    service: { name: 'Medicina General' },
  },
  eps: { name: 'Sura' },
  ...over,
});

const configEspejo = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  pushEnabled: true,
  pullEnabled: true,
  lastHeartbeatAt: new Date(AHORA - 1 * MIN),
  lastHisReachable: true,
  lastHisDetail: null,
  ...over,
});

const evento = (over: Record<string, unknown> = {}) => ({
  seq: BigInt(5),
  entityId: 'apt-1',
  op: 'INSERT',
  createdAt: new Date(AHORA - 25 * MIN),
  deliveredAt: null,
  attempts: 10,
  deadLettered: true,
  nextAttemptAt: null,
  lastError: 'violación de PK: cupo ya vendido',
  ...over,
});

/** Todas las consultas de modelos con tenant deben llevar el de la sesión. */
function verificaTenant(db: Db, org = ORG) {
  const modelos: [string, string][] = [
    ['appointment', 'findMany'],
    ['appointment', 'count'],
    ['interactionLog', 'findMany'],
    ['waitlistEntry', 'findMany'],
    ['chatSurvey', 'findMany'],
    ['massNoticeRecipient', 'findMany'],
    ['syncOutbox', 'findMany'],
    ['whatsappMessageLog', 'findMany'],
    ['syncAudit', 'findMany'],
    ['patientProfile', 'findFirst'],
    ['patientProfile', 'findMany'],
    ['hospitalMirrorConfig', 'findUnique'],
    ['patientLookupLog', 'count'],
  ];
  for (const [modelo, metodo] of modelos) {
    const fn = (db as unknown as Record<string, Record<string, jest.Mock>>)[modelo][metodo];
    for (const llamada of fn.mock.calls) {
      const where = (llamada[0] as { where?: { organizationId?: string } }).where;
      expect({ modelo, metodo, org: where?.organizationId }).toEqual({ modelo, metodo, org });
    }
  }
}

const MOTIVO = { motivo: 'PACIENTE_EN_VENTANILLA' };

// ═══════════════════════════════════════════════════════════════════════════
// buscarCandidatos
// ═══════════════════════════════════════════════════════════════════════════

describe('buscarCandidatos', () => {
  describe('validaciones y límites', () => {
    it.each(['GENERAL_OBSERVER', 'PATIENT'] as const)('%s → sin permisos y no toca la base', async (rol) => {
      const db = mockDb();
      const r = await buscarCandidatos(como(db), actor(rol), { consulta: '1088123456', ...MOTIVO });
      expect(r).toEqual({ success: false, error: SIN_PERMISOS });
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
      expect(db.patientLookupLog.create).not.toHaveBeenCalled();
    });

    it('un DOCTOR sin su perfil de médico en el actor falla cerrado', async () => {
      const r = await buscarCandidatos(como(mockDb()), actor('DOCTOR'), { consulta: '1088123456', ...MOTIVO });
      expect(r).toEqual({ success: false, error: SIN_PERMISOS });
    });

    it.each([undefined, null, '', 'CURIOSEAR', 42])('el motivo %p se rechaza', async (m) => {
      const db = mockDb();
      const r = await buscarCandidatos(como(db), admin(), { consulta: '1088123456', motivo: m });
      expect(r).toEqual({ success: false, error: 'Elige el motivo de la consulta.' });
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
    });

    it('OTRO exige una nota', async () => {
      const r = await buscarCandidatos(como(mockDb()), admin(), { consulta: '1088123456', motivo: 'OTRO', nota: 'x' });
      expect(r.success).toBe(false);
      const ok = await buscarCandidatos(como(mockDb()), admin(), { consulta: '1088123456', motivo: 'OTRO', nota: 'Llamada de la EPS' });
      expect(ok.success).toBe(true);
    });

    it('una nota demasiado larga se rechaza', async () => {
      const r = await buscarCandidatos(como(mockDb()), admin(), { consulta: '1088123456', ...MOTIVO, nota: 'x'.repeat(301) });
      expect(r.success).toBe(false);
    });

    it('una consulta inválida devuelve el motivo, sin buscar', async () => {
      const db = mockDb();
      const r = await buscarCandidatos(como(db), admin(), { consulta: 'maria', ...MOTIVO });
      expect(r).toMatchObject({ success: false, error: expect.stringContaining('al menos dos palabras') });
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
    });

    it('🚦 el límite de tasa corta ANTES de buscar y no deja rastro extra', async () => {
      const db = mockDb();
      db.patientLookupLog.count.mockResolvedValue(30);

      const r = await buscarCandidatos(como(db), admin(), { consulta: '1088123456', ...MOTIVO });

      expect(r).toEqual({ success: false, error: MSG_LIMITE });
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
      expect(db.patientLookupLog.create).not.toHaveBeenCalled();
    });

    it('el límite cuenta SOLO las búsquedas de ESTE usuario en ESTA clínica dentro de la ventana', async () => {
      const db = mockDb();
      await buscarCandidatos(como(db), admin(), { consulta: '1088123456', ...MOTIVO });

      const { where } = db.patientLookupLog.count.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(where).toMatchObject({
        organizationId: ORG,
        actorUserId: 'u-1',
        queryKind: { in: ['CEDULA', 'PHONE', 'BSUID', 'NAME'] },
      });
      const desde = (where.createdAt as { gte: Date }).gte.getTime();
      expect(Date.now() - desde).toBeGreaterThanOrEqual(limitesDeBusqueda().ventanaMin * 60_000 - 1000);
    });

    it('el límite es configurable por entorno', () => {
      process.env.RASTREO_MAX_BUSQUEDAS = '5';
      process.env.RASTREO_VENTANA_MIN = '2';
      expect(limitesDeBusqueda()).toEqual({ max: 5, ventanaMin: 2 });
      delete process.env.RASTREO_MAX_BUSQUEDAS;
      delete process.env.RASTREO_VENTANA_MIN;
      expect(limitesDeBusqueda()).toEqual({ max: 30, ventanaMin: 10 });
    });
  });

  describe('por cédula', () => {
    it('busca dentro de la clínica del actor y devuelve candidatos ENMASCARADOS', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue([paciente()]);

      const r = await buscarCandidatos(como(db), admin(), { consulta: '1.088.123.456', ...MOTIVO });

      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.interpretadoComo).toBe('DOCUMENTO_O_TELEFONO');
      expect(r.data.candidatos).toEqual([
        {
          tipo: 'PACIENTE',
          id: 'pac-1',
          nombre: 'María L••• N•••',
          documento: '•••3456',
          contacto: '•••2233',
          eps: 'Sura',
          citas: 2,
          coincidePor: 'CEDULA',
        },
      ]);
      const texto = JSON.stringify(r.data);
      expect(texto).not.toContain('1088123456');
      expect(texto).not.toContain('López');
      expect(texto).not.toContain('573001112233');
      verificaTenant(db);
    });

    it('registra la búsqueda: quién, qué (enmascarado), por qué y a quiénes devolvió', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue([paciente()]);

      await buscarCandidatos(como(db), admin(), { consulta: '1088123456', motivo: 'RECLAMO_PQRS', nota: '  PQRS 123  ' });

      expect(db.patientLookupLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG,
          actorUserId: 'u-1',
          actorRole: 'ORG_ADMIN',
          mode: 'A',
          queryKind: 'CEDULA',
          queryMasked: '•••3456',
          reason: 'RECLAMO_PQRS',
          reasonNote: 'PQRS 123',
          candidateIds: ['pac-1'],
          openedPatientId: null,
          verdicts: undefined,
          liveHisRequested: false,
        },
      });
    });

    it('sin coincidencia exacta, prueba sin ceros a la izquierda (respaldo de lectura)', async () => {
      const db = mockDb();
      db.patientProfile.findMany
        .mockResolvedValueOnce([]) // exacto
        .mockResolvedValueOnce([paciente({ cedula: '0012345' })]); // por ids
      db.$queryRaw.mockResolvedValueOnce([{ id: 'pac-1' }]);

      const r = await buscarCandidatos(como(db), admin(), { consulta: '12345', ...MOTIVO });

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = db.$queryRaw.mock.calls[0][0] as { values: unknown[]; strings: string[] };
      expect(sql.values).toContain(ORG);
      expect(sql.values).toContain('12345');
      expect(sql.strings.join('?')).toContain("regexp_replace(\"cedula\", '^0+', '')");
      expect(r.success && r.data.candidatos).toHaveLength(1);
      // La segunda lectura vuelve a filtrar por clínica: el id sale de SQL crudo, no se confía.
      expect((db.patientProfile.findMany.mock.calls[1][0] as { where: unknown }).where).toMatchObject({ organizationId: ORG });
    });

    it('con coincidencia exacta NO corre el respaldo', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue([paciente()]);
      await buscarCandidatos(como(db), admin(), { consulta: '1088123456', ...MOTIVO });
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('por teléfono y BSUID', () => {
    it('busca el teléfono con y sin 57, y los remitentes que solo existen en las conversaciones', async () => {
      const db = mockDb();
      db.interactionLog.findMany.mockResolvedValue([{ whatsappId: '573001112233' }]);

      const r = await buscarCandidatos(como(db), admin(), { consulta: '300 111 2233', ...MOTIVO });

      const where = (db.patientProfile.findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({ organizationId: ORG, whatsappId: { in: ['3001112233', '573001112233'] } });
      expect(db.interactionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, whatsappId: { in: ['3001112233', '573001112233'] } } }),
      );
      expect(r.success && r.data.candidatos).toEqual([
        { tipo: 'REMITENTE', id: '573001112233', nombre: '', documento: null, contacto: '•••2233', eps: null, citas: 0, coincidePor: 'TELEFONO' },
      ]);
    });

    it('un remitente que YA tiene perfil no sale dos veces', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue([paciente()]);
      db.interactionLog.findMany.mockResolvedValue([{ whatsappId: '573001112233' }]);

      const r = await buscarCandidatos(como(db), admin(), { consulta: '573001112233', ...MOTIVO });

      expect(r.success && r.data.candidatos.map((c) => c.tipo)).toEqual(['PACIENTE']);
    });

    it('un candidato que coincide por cédula Y por teléfono sale una vez', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue([paciente({ cedula: '3001112233', whatsappId: '3001112233' })]);
      const r = await buscarCandidatos(como(db), admin(), { consulta: '3001112233', ...MOTIVO });
      expect(r.success && r.data.candidatos).toHaveLength(1);
    });

    it('BSUID: por perfil y por conversación, dentro de la clínica', async () => {
      const db = mockDb();
      await buscarCandidatos(como(db), admin(), { consulta: 'CO.13491208655302741918', ...MOTIVO });

      expect(db.patientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, bsuid: 'CO.13491208655302741918' } }),
      );
      const { data } = db.patientLookupLog.create.mock.calls[0][0] as { data: { queryKind: string; queryMasked: string } };
      expect(data.queryKind).toBe('BSUID');
      expect(data.queryMasked).toBe('CO.•••1918');
    });
  });

  describe('por nombre', () => {
    it('usa la expresión del índice trigram, una condición por palabra, dentro de la clínica', async () => {
      const db = mockDb();
      db.$queryRaw.mockResolvedValueOnce([{ id: 'pac-1' }]);
      db.patientProfile.findMany.mockResolvedValueOnce([paciente()]);

      const r = await buscarCandidatos(como(db), admin(), { consulta: 'maria lopez', ...MOTIVO });

      const sql = db.$queryRaw.mock.calls[0][0] as { values: unknown[]; strings: string[] };
      const texto = sql.strings.join('?');
      expect(texto).toContain('fn_norm_texto(p."fullName") LIKE');
      expect((texto.match(/fn_norm_texto\(p\."fullName"\)/g) ?? []).length).toBe(2);
      expect(sql.values).toEqual(expect.arrayContaining([ORG, 'maria', 'lopez']));
      expect(sql.values).toContain(MAX_CANDIDATOS + 1);
      expect(r.success && r.data.candidatos[0].coincidePor).toBe('NOMBRE');
      const log = (db.patientLookupLog.create.mock.calls[0][0] as { data: { queryKind: string; queryMasked: string } }).data;
      expect(log).toMatchObject({ queryKind: 'NAME', queryMasked: 'maria l•••' });
    });

    it('sin coincidencias no lee los perfiles', async () => {
      const db = mockDb();
      const r = await buscarCandidatos(como(db), admin(), { consulta: 'zoraida quintero', ...MOTIVO });
      expect(r.success && r.data.candidatos).toEqual([]);
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
    });

    it('🏥 un DOCTOR busca solo entre sus pacientes: la relación va DENTRO de la consulta SQL', async () => {
      const db = mockDb();
      await buscarCandidatos(como(db), doctor(), { consulta: 'maria lopez', ...MOTIVO });

      const sql = db.$queryRaw.mock.calls[0][0] as { values: unknown[]; strings: string[] };
      expect(sql.strings.join('?')).toContain('EXISTS');
      expect(sql.values).toContain('doc-7');
    });
  });

  describe('el rol condiciona qué se busca', () => {
    it('🏥 un DOCTOR filtra por la relación terapéutica y no ve remitentes sin perfil', async () => {
      const db = mockDb();
      await buscarCandidatos(como(db), doctor(), { consulta: '573001112233', ...MOTIVO });

      const where = (db.patientProfile.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({
        organizationId: ORG,
        appointments: { some: { organizationId: ORG, scheduleSlot: { doctorId: 'doc-7' } } },
      });
      expect(db.interactionLog.findMany).not.toHaveBeenCalled();
    });

    it('un BOOKING_AGENT con alcance SÍ encuentra a cualquier paciente de la clínica (el alcance acota las CITAS, no la búsqueda)', async () => {
      const db = mockDb();
      await buscarCandidatos(como(db), agente({ scopeEpsId: 'eps-1' }), { consulta: '1088123456', ...MOTIVO });
      const where = (db.patientProfile.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where).toEqual({ organizationId: ORG, cedula: { in: ['1088123456'] } });
    });

    it('un SUPER_ADMIN busca en la clínica que eligió, y solo en ella', async () => {
      const db = mockDb();
      await buscarCandidatos(como(db), superAdmin('org-9'), { consulta: '1088123456', ...MOTIVO });
      verificaTenant(db, 'org-9');
      expect((db.patientLookupLog.create.mock.calls[0][0] as { data: { organizationId: string; actorRole: string } }).data).toMatchObject({
        organizationId: 'org-9',
        actorRole: 'SUPER_ADMIN',
      });
    });
  });

  describe('tope y bitácora', () => {
    it('más de 10 resultados: devuelve 10 y avisa que hay más', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue(
        Array.from({ length: MAX_CANDIDATOS + 1 }, (_, i) => paciente({ id: `p${i}`, cedula: `10${i}` })),
      );
      const r = await buscarCandidatos(como(db), admin(), { consulta: '1088123456', ...MOTIVO });
      expect(r.success && r.data.candidatos).toHaveLength(MAX_CANDIDATOS);
      expect(r.success && r.data.hayMas).toBe(true);
    });

    it('🔒 si NO se puede registrar la búsqueda, NO se devuelve ningún candidato', async () => {
      const db = mockDb();
      db.patientProfile.findMany.mockResolvedValue([paciente()]);
      db.patientLookupLog.create.mockRejectedValue(new Error('db caída'));
      const espia = jest.spyOn(console, 'error').mockImplementation(() => {});

      const r = await buscarCandidatos(como(db), admin(), { consulta: '1088123456', ...MOTIVO });

      expect(r).toEqual({ success: false, error: MSG_NO_REGISTRADA });
      espia.mockRestore();
    });

    it('un remitente sin perfil se anota ENMASCARADO en candidateIds', async () => {
      const db = mockDb();
      db.interactionLog.findMany.mockResolvedValue([{ whatsappId: '573001112233' }]);
      await buscarCandidatos(como(db), admin(), { consulta: '573001112233', ...MOTIVO });
      const { candidateIds } = (db.patientLookupLog.create.mock.calls[0][0] as { data: { candidateIds: string[] } }).data;
      expect(candidateIds).toEqual(['remitente:•••2233']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// armarExpedienteA
// ═══════════════════════════════════════════════════════════════════════════

const abrir = (db: Db, a: ActorRastreo, extra: Record<string, unknown> = {}) =>
  armarExpedienteA(como(db), a, { sujeto: { tipo: 'PACIENTE', id: 'pac-1' }, ...MOTIVO, ...extra });

describe('armarExpedienteA', () => {
  describe('aislamiento', () => {
    it('🏢 un paciente de OTRA clínica (o inexistente) responde igual: "no encontrado", sin oráculo', async () => {
      const db = mockDb(); // findFirst → null
      const r = await abrir(db, admin());

      expect(r).toEqual({ success: false, error: 'Paciente no encontrado.' });
      expect(db.patientProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pac-1', organizationId: ORG } }),
      );
      // Sin paciente no hay lectura de nada más, ni registro.
      expect(db.appointment.findMany).not.toHaveBeenCalled();
      expect(db.patientLookupLog.create).not.toHaveBeenCalled();
    });

    it('🏥 un DOCTOR sin relación terapéutica: la relación va en el WHERE y el error es el mismo', async () => {
      const db = mockDb();
      const r = await abrir(db, doctor());

      expect(r).toEqual({ success: false, error: 'Paciente no encontrado.' });
      expect((db.patientProfile.findFirst.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
        id: 'pac-1',
        organizationId: ORG,
        appointments: { some: { organizationId: ORG, scheduleSlot: { doctorId: 'doc-7' } } },
      });
    });

    it.each(['GENERAL_OBSERVER', 'PATIENT'] as const)('%s → sin permisos', async (rol) => {
      expect(await abrir(mockDb(), actor(rol))).toEqual({ success: false, error: SIN_PERMISOS });
    });

    it('un sujeto malformado se rechaza', async () => {
      const db = mockDb();
      for (const sujeto of [null, {}, { tipo: 'PACIENTE' }, { tipo: 'PACIENTE', id: 42 }, { tipo: 'REMITENTE', whatsappId: '' }, { tipo: 'REMITENTE', whatsappId: 'x'.repeat(65) }]) {
        const r = await armarExpedienteA(como(db), admin(), { sujeto: sujeto as never, ...MOTIVO });
        expect(r.success).toBe(false);
      }
    });

    it('todas las lecturas de un expediente completo (ORG_ADMIN) llevan la clínica de la sesión', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue([citaBD()]);
      db.hospitalMirrorConfig.findUnique.mockResolvedValue(configEspejo());
      await abrir(db, admin());
      verificaTenant(db);
    });

    it('también con un SUPER_ADMIN en otra clínica', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue([citaBD()]);
      db.hospitalMirrorConfig.findUnique.mockResolvedValue(configEspejo());
      await abrir(db, superAdmin('org-9'));
      verificaTenant(db, 'org-9');
    });
  });

  describe('alcance de las citas', () => {
    it('📌 BOOKING_AGENT con EPS y médico asignados: las citas se acotan a AMBOS', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());

      await abrir(db, agente({ scopeEpsId: 'eps-1', scopeDoctorId: 'doc-1' }));

      expect((db.appointment.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({
        organizationId: ORG,
        patientId: 'pac-1',
        epsId: 'eps-1',
        scheduleSlot: { doctorId: 'doc-1' },
      });
    });

    it('📌 y cuenta las que quedan fuera (NOT del alcance) para no concluir que "no tiene cita"', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.count.mockResolvedValue(2);

      const r = await abrir(db, agente({ scopeEpsId: 'eps-1' }));

      expect((db.appointment.count.mock.calls[0][0] as { where: unknown }).where).toEqual({
        organizationId: ORG,
        patientId: 'pac-1',
        NOT: { epsId: 'eps-1' },
      });
      expect(r.success && r.data.resultado.principal.codigo).toBe('FUERA_DE_ALCANCE');
    });

    it('un BOOKING_AGENT SIN alcance ve todas las citas y no cuenta ocultas', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      await abrir(db, agente());
      expect(db.appointment.count).not.toHaveBeenCalled();
      expect((db.appointment.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ organizationId: ORG, patientId: 'pac-1' });
    });

    it('🏥 un DOCTOR ve solo SUS citas y NO se entera de que hay otras', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue([citaBD()]);

      const r = await abrir(db, doctor());

      expect((db.appointment.findMany.mock.calls[0][0] as { where: unknown }).where).toMatchObject({ scheduleSlot: { doctorId: 'doc-7' } });
      expect(db.appointment.count).not.toHaveBeenCalled();
      expect(r.success && r.data.resultado.notas.join(' ')).not.toContain('fuera de tu alcance');
    });
  });

  describe('qué lee cada rol', () => {
    const lecturas = (db: Db) => ({
      conversacion: db.interactionLog.findMany.mock.calls.length,
      outbox: db.syncOutbox.findMany.mock.calls.length,
      mensajes: db.whatsappMessageLog.findMany.mock.calls.length,
      espera: db.waitlistEntry.findMany.mock.calls.length,
      encuestas: db.chatSurvey.findMany.mock.calls.length,
      avisos: db.massNoticeRecipient.findMany.mock.calls.length,
    });
    const preparar = () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue([citaBD()]);
      db.hospitalMirrorConfig.findUnique.mockResolvedValue(configEspejo());
      return db;
    };

    it('ORG_ADMIN lee todo y ve el texto de la conversación y los internos', async () => {
      const db = preparar();
      db.interactionLog.findMany.mockResolvedValue([
        { createdAt: new Date(AHORA - 5 * MIN), status: 'SUCCESS', failureReason: null, userMessage: 'quiero cita', botReply: 'claro', metadata: null },
      ]);
      db.syncOutbox.findMany.mockResolvedValue([evento()]);

      const r = await abrir(db, admin());

      expect(lecturas(db)).toEqual({ conversacion: 1, outbox: 1, mensajes: 1, espera: 1, encuestas: 1, avisos: 1 });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.conversacion.nivel).toBe('TEXTO');
      expect(r.data.conversacion.mensajes?.[0]).toMatchObject({ paciente: 'quiero cita', bot: 'claro' });
      expect(r.data.verInternos).toBe(true);
      expect(r.data.citas[0].eventosSync?.[0]).toMatchObject({ seq: '5', rendido: true, ultimoError: 'violación de PK: cupo ya vendido' });
    });

    it('BOOKING_AGENT ve el texto de la conversación pero NO los internos (seq / reprocesar)', async () => {
      const db = preparar();
      db.syncOutbox.findMany.mockResolvedValue([evento()]);
      const r = await abrir(db, agente());

      expect(r.success && r.data.conversacion.nivel).toBe('TEXTO');
      expect(r.success && r.data.verInternos).toBe(false);
      expect(r.success && r.data.citas[0].eventosSync).toBeNull();
      // …pero sí el estado del sync (el veredicto lo necesita).
      expect(r.success && r.data.resultado.principal.codigo).toBe('CONFIRMADA_NO_LLEGO');
    });

    it('SUPER_ADMIN ve los HECHOS de la conversación pero NO el texto', async () => {
      const db = preparar();
      db.interactionLog.findMany.mockResolvedValue([
        { createdAt: new Date(AHORA - 5 * MIN), status: 'SUCCESS', failureReason: null, userMessage: 'dato sensible', botReply: 'otro dato', metadata: null },
      ]);
      const r = await abrir(db, superAdmin());

      expect(r.success && r.data.conversacion.nivel).toBe('RESUMEN');
      expect(r.success && r.data.conversacion.resumen?.mensajes).toBe(1);
      expect(r.success && r.data.conversacion.mensajes).toBeNull();
      expect(JSON.stringify(r)).not.toContain('dato sensible');
      expect(JSON.stringify(r)).not.toContain('otro dato');
    });

    it('🏥 DOCTOR: no lee conversación, sync, mensajes, lista de espera, encuestas ni avisos', async () => {
      const db = preparar();
      const r = await abrir(db, doctor());

      expect(lecturas(db)).toEqual({ conversacion: 0, outbox: 0, mensajes: 0, espera: 0, encuestas: 0, avisos: 0 });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.conversacion).toEqual({ nivel: 'NINGUNA', resumen: null, mensajes: null });
      expect(r.data.espejo).toBeNull();
      expect(r.data.citas[0].sync).toBeNull();
      expect(r.data.verInternos).toBe(false);
      // Sin sync visible, el veredicto no especula con el espejo.
      expect(r.data.resultado.principal.codigo).toBe('CITA_VIGENTE');
      expect(JSON.stringify(r.data.resultado)).not.toMatch(/agente|espejo|cola/i);
    });
  });

  describe('el veredicto sale de los datos', () => {
    const preparar = (citas: unknown[], espejo: unknown = configEspejo()) => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue(citas);
      db.hospitalMirrorConfig.findUnique.mockResolvedValue(espejo);
      return db;
    };

    it('dead-letter con motivo → CONFIRMADA_NO_LLEGO con la causa y el motivo', async () => {
      const db = preparar([citaBD()]);
      db.syncOutbox.findMany.mockResolvedValue([evento()]);

      const r = await abrir(db, admin());

      expect(r.success && r.data.resultado.principal).toMatchObject({ codigo: 'CONFIRMADA_NO_LLEGO', causa: 'DEAD_LETTER' });
      expect(r.success && r.data.resultado.principal.evidencia.join(' ')).toContain('violación de PK: cupo ya vendido');
    });

    it('evento entregado → ENTREGADA_SIN_VERIFICAR, y el libro de mensajes alimenta la confirmación', async () => {
      const db = preparar([citaBD()]);
      db.syncOutbox.findMany.mockResolvedValue([evento({ deliveredAt: new Date(AHORA - 20 * MIN), attempts: 0, deadLettered: false, lastError: null })]);
      db.whatsappMessageLog.findMany.mockResolvedValue([
        { appointmentId: 'apt-1', status: 'READ', createdAt: new Date(AHORA - 29 * MIN), statusAt: new Date(AHORA - 28 * MIN), errorCode: null, errorDetail: null },
      ]);
      db.interactionLog.findMany.mockResolvedValue([
        { createdAt: new Date(AHORA - 29 * MIN), status: 'BOOKING_CONFIRMED', failureReason: null, userMessage: 'sí', botReply: 'listo', metadata: { appointmentId: 'apt-1' } },
      ]);

      const r = await abrir(db, admin());

      expect(r.success && r.data.resultado.principal.codigo).toBe('ENTREGADA_SIN_VERIFICAR');
      expect(r.success && r.data.resultado.principal.evidencia.join(' ')).toContain('LEÍDA');
      const pasos = r.success ? Object.fromEntries(r.data.citas[0].lineaDeVida.map((p) => [p.clave, p.estado])) : {};
      expect(pasos).toMatchObject({ conversacion: 'ok', confirmacion_entregada: 'ok', entregado_al_agente: 'ok', presente_en_el_his: 'unknown' });
    });

    it('sin eventos y con el espejo encendido → NO_EVENT', async () => {
      const r = await abrir(preparar([citaBD()]), admin());
      expect(r.success && r.data.resultado.principal.causa).toBe('NO_EVENT');
    });

    it('una clínica SIN espejo: CITA_VIGENTE y no se lee el outbox', async () => {
      const db = preparar([citaBD()], null);
      const r = await abrir(db, admin());
      expect(r.success && r.data.resultado.principal.codigo).toBe('CITA_VIGENTE');
      expect(r.success && r.data.conEspejo).toBe(false);
      expect(db.syncOutbox.findMany).not.toHaveBeenCalled();
    });

    it('una cita nacida en el HIS no se busca en el outbox', async () => {
      const db = preparar([citaBD({ origin: 'MIRROR' })]);
      await abrir(db, admin());
      expect(db.syncOutbox.findMany).not.toHaveBeenCalled();
    });

    it('el outbox solo trae eventos LOCALES de las citas de este paciente (no los ecos del espejo)', async () => {
      const db = preparar([citaBD()]);
      await abrir(db, admin());
      expect(db.syncOutbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, entityType: 'APPOINTMENT', entityId: { in: ['apt-1'] }, origin: 'LOCAL' },
        }),
      );
    });

    it('cancelación del hospital: usa metaLog y la hora de SyncAudit', async () => {
      const db = preparar([
        citaBD({ status: 'CANCELLED', metaLog: { cancelledBy: 'MIRROR', reason: 'PACIENTE LLAMA A CANCELAR' } }),
      ]);
      db.syncAudit.findMany.mockResolvedValue([{ entityId: 'apt-1', createdAt: new Date(AHORA - 2 * DIA) }]);

      const r = await abrir(db, admin());

      expect(r.success && r.data.resultado.principal.codigo).toBe('CANCELADA');
      expect(r.success && r.data.citas[0].cancelacion).toMatchObject({ por: 'HIS', motivo: 'PACIENTE LLAMA A CANCELAR' });
      expect((db.syncAudit.findMany.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
        organizationId: ORG,
        op: 'CANCEL',
        direction: 'INBOUND',
        entityId: { in: ['apt-1'] },
      });
    });

    it('cancelación por el paciente: la conversación tiene APPOINTMENT_CANCELLED', async () => {
      const db = preparar([citaBD({ status: 'CANCELLED' })]);
      db.interactionLog.findMany.mockResolvedValue([
        { createdAt: new Date(AHORA - DIA), status: 'SUCCESS', failureReason: null, userMessage: 'sí', botReply: 'cancelada', metadata: { event: 'APPOINTMENT_CANCELLED', appointmentId: 'apt-1' } },
      ]);
      const r = await abrir(db, admin());
      expect(r.success && r.data.citas[0].cancelacion?.por).toBe('PACIENTE_WHATSAPP');
    });

    it('cancelación sin rastro (anterior a que el panel dejara constancia) → DESCONOCIDO', async () => {
      const r = await abrir(preparar([citaBD({ status: 'CANCELLED' })]), admin());
      expect(r.success && r.data.citas[0].cancelacion?.por).toBe('DESCONOCIDO');
    });

    // ══════════════════════════════════════════════════════════════════════
    // Cancelación hecha por el personal desde el panel. Antes no dejaba rastro;
    // ahora `metaLog` trae quién (id y rol) y cuándo, y cada rol ve de "quién"
    // lo que le corresponde: el administrador, el correo; los demás, el rol.
    // ══════════════════════════════════════════════════════════════════════
    describe('cancelación del personal desde el panel (metaLog.cancelledBy = STAFF)', () => {
      const CUANDO = new Date(AHORA - 2 * DIA).toISOString();
      const constancia = (over: Record<string, unknown> = {}) => ({
        cancelledBy: 'STAFF',
        cancelledByUserId: 'u-9',
        cancelledByRole: 'BOOKING_AGENT',
        cancelledAt: CUANDO,
        ...over,
      });
      const citaCancelada = (over: Record<string, unknown> = {}) => citaBD({ status: 'CANCELLED', metaLog: constancia(over) });
      const conUsuario = (db: Db) => {
        db.user.findMany.mockResolvedValue([{ id: 'u-9', email: 'agente@clinica.co' }]);
        return db;
      };

      it('ORG_ADMIN: ve quién (rol y correo) y cuándo', async () => {
        const db = conUsuario(preparar([citaCancelada()]));
        const r = await abrir(db, admin());

        expect(r.success && r.data.resultado.principal.codigo).toBe('CANCELADA');
        expect(r.success && r.data.citas[0].cancelacion).toEqual({
          por: 'PERSONAL',
          atIso: CUANDO,
          motivo: null,
          actor: 'agente de reservas · agente@clinica.co',
        });
        expect(r.success && r.data.resultado.principal.evidencia.join(' ')).toContain(
          'La canceló el personal de la clínica (agente de reservas · agente@clinica.co)',
        );
      });

      it('resuelve el correo con UNA consulta por id (sin acotar por clínica: un SUPER_ADMIN que cancela no pertenece a ninguna)', async () => {
        const db = conUsuario(preparar([citaCancelada()]));
        await abrir(db, admin());

        expect(db.user.findMany).toHaveBeenCalledTimes(1);
        expect(db.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-9'] } }, select: { id: true, email: true } });
      });

      it('👤 BOOKING_AGENT: solo el ROL, y ni siquiera se consulta al usuario', async () => {
        const db = conUsuario(preparar([citaCancelada()]));
        const r = await abrir(db, agente());

        expect(r.success && r.data.citas[0].cancelacion?.actor).toBe('agente de reservas');
        expect(db.user.findMany).not.toHaveBeenCalled();
        expect(JSON.stringify(r)).not.toContain('agente@clinica.co');
      });

      it('👤 DOCTOR: solo el rol, sin consultar al usuario', async () => {
        const db = conUsuario(preparar([citaCancelada()]));
        // Ana es la médica de la cita: la ve, pero no sabe quién del personal la canceló.
        const r = await abrir(db, doctor());

        expect(r.success && r.data.citas[0].cancelacion).toMatchObject({ por: 'PERSONAL', actor: 'agente de reservas' });
        expect(db.user.findMany).not.toHaveBeenCalled();
        expect(JSON.stringify(r)).not.toContain('agente@clinica.co');
      });

      it('SUPER_ADMIN ve el correo, incluso el de otro SUPER_ADMIN (que no tiene clínica)', async () => {
        const db = preparar([citaCancelada({ cancelledByRole: 'SUPER_ADMIN' })]);
        db.user.findMany.mockResolvedValue([{ id: 'u-9', email: 'soporte@plataforma.co' }]);

        const r = await abrir(db, superAdmin());

        expect(r.success && r.data.citas[0].cancelacion?.actor).toBe('súper administrador · soporte@plataforma.co');
      });

      it('la cuenta ya no existe → "usuario eliminado" (a quien puede ver identidades), no un hueco ni un error', async () => {
        const r = await abrir(preparar([citaCancelada()]), admin()); // findMany → []
        expect(r.success && r.data.citas[0].cancelacion?.actor).toBe('agente de reservas · usuario eliminado');
      });

      it('una constancia sin id de usuario: rol solo, sin consultar', async () => {
        const db = preparar([citaCancelada({ cancelledByUserId: undefined })]);
        const r = await abrir(db, admin());

        expect(r.success && r.data.citas[0].cancelacion?.actor).toBe('agente de reservas');
        expect(db.user.findMany).not.toHaveBeenCalled();
      });

      it('varias citas canceladas por la misma persona: un solo id en la consulta', async () => {
        const db = conUsuario(
          preparar([
            citaCancelada(),
            citaBD({ id: 'apt-2', status: 'CANCELLED', metaLog: constancia() }),
            citaBD({ id: 'apt-3', status: 'CANCELLED', metaLog: constancia({ cancelledByUserId: 'u-10' }) }),
          ]),
        );
        await abrir(db, admin());
        expect((db.user.findMany.mock.calls[0][0] as { where: { id: { in: string[] } } }).where.id.in.sort()).toEqual(['u-10', 'u-9']);
      });

      it('sin citas canceladas por el personal no se consulta a ningún usuario', async () => {
        const db = preparar([
          citaBD(),
          citaBD({ id: 'apt-2', status: 'CANCELLED', metaLog: { cancelledBy: 'MIRROR', reason: 'x' } }),
          citaBD({ id: 'apt-3', status: 'CANCELLED' }),
        ]);
        await abrir(db, admin());
        expect(db.user.findMany).not.toHaveBeenCalled();
      });

      it('una cita vigente con un metaLog raro NO se lee como cancelada por el personal', async () => {
        const db = preparar([citaBD({ metaLog: constancia() })]); // status SCHEDULED
        const r = await abrir(db, admin());
        expect(r.success && r.data.citas[0].cancelacion).toBeNull();
        expect(db.user.findMany).not.toHaveBeenCalled();
      });

      it('el hospital sigue ganando: una cancelación MIRROR no se atribuye al personal', async () => {
        const db = preparar([citaBD({ status: 'CANCELLED', metaLog: { cancelledBy: 'MIRROR', reason: 'PACIENTE LLAMA' } })]);
        db.syncAudit.findMany.mockResolvedValue([{ entityId: 'apt-1', createdAt: new Date(AHORA - DIA) }]);
        const r = await abrir(db, admin());
        expect(r.success && r.data.citas[0].cancelacion?.por).toBe('HIS');
      });
    });

    it('la captura elige la cita principal y se anota en las notas', async () => {
      const cercana = citaBD({ id: 'apt-b', scheduleSlot: { startTime: new Date(AHORA + 1 * DIA), doctor: { fullName: 'Pedro Gil', isFunctionalAgenda: false }, service: { name: 'Cardiología' } } });
      const db = preparar([citaBD(), cercana], null);

      const r = await abrir(db, admin(), { captura: { medico: 'ruiz' } });

      expect(r.success && r.data.resultado.principal.citaId).toBe('apt-1');
      expect(r.success && r.data.capturaIndicada).toBe(true);
      expect(r.success && r.data.resultado.notas.join(' ')).toContain('La captura coincide');
    });

    it('un médico que es agenda funcional se muestra sin honorífico', async () => {
      const db = preparar([citaBD({ scheduleSlot: { startTime: new Date(AHORA + DIA), doctor: { fullName: 'MEDICO ATENCIÓN HTA 2', isFunctionalAgenda: true }, service: { name: 'HTA' } } })], null);
      const r = await abrir(db, admin());
      expect(r.success && r.data.citas[0].doctor).toBe('MEDICO ATENCIÓN HTA 2');
    });

    it('la zona horaria sale de Organization.timezone', async () => {
      const db = preparar([citaBD()], null);
      db.organization.findUnique.mockResolvedValue({ timezone: 'America/Mexico_City' });
      const r = await abrir(db, admin());
      expect(r.success && r.data.zonaHoraria).toBe('America/Mexico_City');
      expect(db.organization.findUnique).toHaveBeenCalledWith({ where: { id: ORG }, select: { timezone: true } });
    });

    it('sin zona configurada cae a Bogotá', async () => {
      const r = await abrir(preparar([citaBD()], null), admin());
      expect(r.success && r.data.zonaHoraria).toBe('America/Bogota');
    });
  });

  describe('identidad e historial', () => {
    it('la identidad sale ENMASCARADA; el nombre completo sí (se abrió con un motivo registrado)', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente({ bsuid: 'CO.13491208655302741918' }));
      const r = await abrir(db, admin());

      expect(r.success && r.data.identidad).toMatchObject({
        nombre: 'María López Núñez',
        documento: '•••3456',
        whatsapp: '•••2233',
        bsuid: 'CO.•••1918',
        eps: 'Sura',
        regimen: 'CONTRIBUTIVO',
      });
      const texto = JSON.stringify(r);
      expect(texto).not.toContain('1088123456');
      expect(texto).not.toContain('573001112233');
    });

    it('historial: encuestas y avisos masivos por el documento (dentro de la clínica)', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.chatSurvey.findMany.mockResolvedValue([{ createdAt: new Date(AHORA - DIA), rating: 4, resolutionStatus: 'BOOKED' }]);
      db.massNoticeRecipient.findMany.mockResolvedValue([{ appointmentAtUtc: new Date(AHORA + DIA), outcome: 'ENVIADO', sentAt: new Date(AHORA - MIN) }]);

      const r = await abrir(db, admin());

      expect(r.success && r.data.historial).toMatchObject({
        encuestas: [{ calificacion: 4, resolucion: 'BOOKED' }],
        avisosMasivos: [{ resultado: 'ENVIADO' }],
      });
      expect(db.massNoticeRecipient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, patientDocument: '1088123456' } }),
      );
    });

    it('el recordatorio enviado se muestra por cita', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue([citaBD({ reminderSentAt: new Date(AHORA - 3 * MIN) })]);
      const r = await abrir(db, admin());
      expect(r.success && r.data.citas[0].recordatorioIso).toBe(new Date(AHORA - 3 * MIN).toISOString());
    });
  });

  describe('bitácora', () => {
    it('anota la apertura ANTES de devolver: los veredictos, el paciente y el motivo', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.appointment.findMany.mockResolvedValue([citaBD()]);
      db.hospitalMirrorConfig.findUnique.mockResolvedValue(configEspejo());
      db.syncOutbox.findMany.mockResolvedValue([evento()]);

      await abrir(db, admin(), { motivo: 'RECLAMO_PQRS', nota: 'PQRS 88' });

      expect(db.patientLookupLog.create).toHaveBeenCalledTimes(1);
      expect((db.patientLookupLog.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
        organizationId: ORG,
        actorUserId: 'u-1',
        actorRole: 'ORG_ADMIN',
        mode: 'A',
        queryKind: 'OPEN',
        queryMasked: '•••3456',
        reason: 'RECLAMO_PQRS',
        reasonNote: 'PQRS 88',
        candidateIds: ['pac-1'],
        openedPatientId: 'pac-1',
        verdicts: [{ codigo: 'CONFIRMADA_NO_LLEGO', citaId: 'apt-1' }],
        liveHisRequested: false,
      });
    });

    it('🔒 si NO se puede registrar la apertura, NO se devuelve el expediente', async () => {
      const db = mockDb();
      db.patientProfile.findFirst.mockResolvedValue(paciente());
      db.patientLookupLog.create.mockRejectedValue(new Error('db caída'));
      const espia = jest.spyOn(console, 'error').mockImplementation(() => {});

      const r = await abrir(db, admin());

      expect(r).toEqual({ success: false, error: MSG_NO_REGISTRADA });
      espia.mockRestore();
    });

    it('sin motivo válido no se lee nada del paciente', async () => {
      const db = mockDb();
      const r = await abrir(db, admin(), { motivo: 'CURIOSEAR' });
      expect(r.success).toBe(false);
      expect(db.patientProfile.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('remitente sin perfil', () => {
    const abrirRemitente = (db: Db, a: ActorRastreo) =>
      armarExpedienteA(como(db), a, { sujeto: { tipo: 'REMITENTE', whatsappId: '573001112233' }, ...MOTIVO });

    it('solo tiene conversación: NUNCA_CONFIRMO desde los logs, sin leer citas de nadie', async () => {
      const db = mockDb();
      db.interactionLog.findMany.mockResolvedValue([
        { createdAt: new Date(AHORA - 3 * DIA), status: 'FAILED', failureReason: 'SLOT_TAKEN', userMessage: 'x', botReply: 'y', metadata: null },
      ]);

      const r = await abrirRemitente(db, admin());

      expect(r.success && r.data.resultado.principal.codigo).toBe('NUNCA_CONFIRMO');
      expect(r.success && r.data.identidad).toBeNull();
      expect(r.success && r.data.remitente).toBe('•••2233');
      expect(db.appointment.findMany).not.toHaveBeenCalled();
      expect(db.interactionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG, whatsappId: { in: ['573001112233'] } }) }),
      );
      expect((db.patientLookupLog.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
        queryMasked: '•••2233',
        openedPatientId: null,
        candidateIds: [],
      });
    });

    it('🏥 un DOCTOR no puede abrir un remitente (no tiene conversación que ver)', async () => {
      expect(await abrirRemitente(mockDb(), doctor())).toEqual({ success: false, error: SIN_PERMISOS });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Escenario B
// ═══════════════════════════════════════════════════════════════════════════

describe('opcionesCupoHis', () => {
  it('🏥 un DOCTOR no tiene escenario B', async () => {
    expect(await opcionesCupoHis(como(mockDb()), doctor())).toEqual({ success: false, error: SIN_PERMISOS });
  });

  it('una clínica sin espejo no tiene qué ofrecer', async () => {
    const r = await opcionesCupoHis(como(mockDb()), admin());
    expect(r).toEqual({ success: false, error: 'Esta clínica no tiene espejo con un HIS.' });
  });

  it('une los homologados y los que solo están en el catálogo del HIS, sin repetir', async () => {
    const db = mockDb();
    db.hospitalMirrorConfig.findUnique.mockResolvedValue({ id: 'cfg' });
    db.mirrorEntityMap.findMany.mockResolvedValue([{ agenIAId: 'doc-1', externalKey: '76', externalLabel: 'MEDICO HTA' }]);
    db.doctorProfile.findMany.mockResolvedValue([{ id: 'doc-1', fullName: 'MEDICO HTA', isFunctionalAgenda: true }]);
    db.mirrorCatalogEntry.findMany.mockResolvedValue([
      { externalKey: '76', label: 'MEDICO HTA (catálogo)' },
      { externalKey: '91-1', label: 'ENFERMERA CyD' },
    ]);

    const r = await opcionesCupoHis(como(db), admin());

    expect(r.success && r.data.medicos).toEqual([
      { clave: '91-1', etiqueta: 'ENFERMERA CyD', homologado: false },
      { clave: '76', etiqueta: 'MEDICO HTA', homologado: true },
    ]);
    for (const m of [db.mirrorEntityMap.findMany, db.mirrorCatalogEntry.findMany, db.doctorProfile.findMany]) {
      expect((m.mock.calls[0][0] as { where: { organizationId: string } }).where.organizationId).toBe(ORG);
    }
  });
});

describe('investigarCupoB', () => {
  const entrada = (over: Record<string, unknown> = {}) => ({
    documento: '1088123456',
    medicoClave: '76',
    fecha: '2026-09-22',
    hora: '10:00',
    ...MOTIVO,
    ...over,
  });
  const INICIO = '2026-09-22T15:00:00.000Z'; // 10:00 en Bogotá
  const PREFIJO = `cupo=76|${INICIO}`;

  const preparar = () => {
    const db = mockDb();
    db.hospitalMirrorConfig.findUnique.mockResolvedValue(configEspejo());
    db.mirrorEntityMap.findFirst.mockResolvedValue({ agenIAId: 'doc-1', externalLabel: 'MEDICO HTA' });
    db.doctorProfile.findFirst.mockResolvedValue({ fullName: 'MEDICO HTA', isFunctionalAgenda: true });
    db.scheduleSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
    return db;
  };
  const perfil = (over: Record<string, unknown> = {}) => ({ id: 'pac-1', cedula: '1088123456', fullName: 'María López', whatsappId: '573001112233', bsuid: null, ...over });

  describe('validación y permisos', () => {
    it('🏥 un DOCTOR no puede', async () => {
      expect(await investigarCupoB(como(mockDb()), doctor(), entrada())).toEqual({ success: false, error: SIN_PERMISOS });
    });

    it('sin espejo → error', async () => {
      const r = await investigarCupoB(como(mockDb()), admin(), entrada());
      expect(r).toEqual({ success: false, error: 'Esta clínica no tiene espejo con un HIS.' });
    });

    it.each([
      [{ documento: 'maria' }, 'cédula'],
      [{ documento: '12' }, 'cédula'],
      [{ medicoClave: '' }, 'médico'],
      [{ fecha: '2026-02-31' }, 'fecha'],
      [{ hora: '25:00' }, 'fecha'],
      [{ motivo: 'X' }, 'motivo'],
    ])('%j se rechaza', async (mala, fragmento) => {
      const db = preparar();
      const r = await investigarCupoB(como(db), admin(), entrada(mala));
      expect(r.success).toBe(false);
      expect(!r.success && r.error.toLowerCase()).toContain(fragmento);
      expect(db.patientLookupLog.create).not.toHaveBeenCalled();
    });

    it('un médico que no está en el mapa NI en el catálogo se rechaza', async () => {
      const db = preparar();
      db.mirrorEntityMap.findFirst.mockResolvedValue(null);
      const r = await investigarCupoB(como(db), admin(), entrada());
      expect(r).toEqual({ success: false, error: 'Ese médico no está en el catálogo de esta clínica.' });
    });

    it('el límite de tasa también aplica al escenario B', async () => {
      const db = preparar();
      db.patientLookupLog.count.mockResolvedValue(99);
      expect(await investigarCupoB(como(db), admin(), entrada())).toEqual({ success: false, error: MSG_LIMITE });
    });
  });

  describe('veredictos', () => {
    it('SIN_EVENTO_DEL_HIS: ningún evento para ese cupo (y busca por el prefijo exacto, dentro de la clínica)', async () => {
      const db = preparar();
      const r = await investigarCupoB(como(db), admin(), entrada());

      expect(r.success && r.data.resultado.principal.codigo).toBe('SIN_EVENTO_DEL_HIS');
      expect((db.syncAudit.findMany.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
        organizationId: ORG,
        entityType: 'APPOINTMENT',
        direction: 'INBOUND',
        detail: { startsWith: PREFIJO },
      });
    });

    it('CITA_DEL_HIS_NO_ESPEJADA: el evento llegó y AgenIA solo ocupó el cupo', async () => {
      const db = preparar();
      db.syncAudit.findMany.mockResolvedValue([
        { outcome: 'OK', op: 'INSERT', detail: `${PREFIJO}; cita del HIS con paciente sin homologar: solo se ocupó el cupo, no se creó Appointment`, createdAt: new Date(AHORA - 3 * DIA) },
      ]);
      const r = await investigarCupoB(como(db), admin(), entrada());

      expect(r.success && r.data.resultado.principal.codigo).toBe('CITA_DEL_HIS_NO_ESPEJADA');
      // La clave `cupo=…` no se repite en la nota que ve el funcionario.
      expect(r.success && r.data.auditorias[0].nota).toBe('cita del HIS con paciente sin homologar: solo se ocupó el cupo, no se creó Appointment');
      // §12 #7: lo que la pantalla necesita para ofrecer la confirmación al paciente.
      expect(r.success && r.data.cupo.slotId).toBe('slot-1');
      expect(r.success && r.data.puedeConfirmar).toBe(true);
    });

    it('§12 #7: un SUPER_ADMIN investiga pero NO confirma (no atiende pacientes); sin cupo en AgenIA no hay slotId', async () => {
      const db = preparar();
      db.scheduleSlot.findFirst.mockResolvedValue(null);
      const r = await investigarCupoB(como(db), superAdmin(), entrada());
      expect(r.success && r.data.puedeConfirmar).toBe(false);
      expect(r.success && r.data.cupo.slotId).toBeNull();
      const a = await investigarCupoB(como(preparar()), agente(), entrada());
      expect(a.success && a.data.puedeConfirmar).toBe(true);
    });

    it('MEDICO_NO_ESPEJADO: solo está en el catálogo del HIS', async () => {
      const db = preparar();
      db.mirrorEntityMap.findFirst.mockResolvedValue(null);
      db.mirrorCatalogEntry.findFirst.mockResolvedValue({ label: 'MEDICO AJENO' });
      const r = await investigarCupoB(como(db), admin(), entrada());

      expect(r.success && r.data.resultado.principal.codigo).toBe('MEDICO_NO_ESPEJADO');
      expect(r.success && r.data.cupo).toMatchObject({ medico: 'MEDICO AJENO', homologado: false });
      expect(db.scheduleSlot.findFirst).not.toHaveBeenCalled();
    });

    it('SIN_CUPO: médico homologado y AgenIA no generó el cupo', async () => {
      const db = preparar();
      db.scheduleSlot.findFirst.mockResolvedValue(null);
      const r = await investigarCupoB(como(db), admin(), entrada());
      expect(r.success && r.data.resultado.principal.codigo).toBe('SIN_CUPO');
    });

    it('CITA_VIGENTE: AgenIA ya tiene la cita de ese paciente en ese cupo', async () => {
      const db = preparar();
      db.$queryRaw.mockResolvedValue([perfil()]);
      db.appointment.findFirst.mockResolvedValue({ id: 'apt-9' });

      const r = await investigarCupoB(como(db), admin(), entrada());

      expect(r.success && r.data.resultado.principal.codigo).toBe('CITA_VIGENTE');
      expect((db.appointment.findFirst.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
        organizationId: ORG,
        patientId: 'pac-1',
        status: { not: 'CANCELLED' },
        scheduleSlot: { startTime: new Date(INICIO), doctorId: 'doc-1' },
      });
    });

    it('la hora se convierte con la zona de la clínica: 10:00 en Bogotá = 15:00 UTC', async () => {
      const db = preparar();
      await investigarCupoB(como(db), admin(), entrada());
      expect((db.scheduleSlot.findFirst.mock.calls[0][0] as { where: { startTime: Date } }).where.startTime.toISOString()).toBe(INICIO);
    });
  });

  describe('identidad', () => {
    it('documento con ceros en AgenIA que el paciente no escribió: IDENTIDAD_NO_COINCIDE', async () => {
      const db = preparar();
      db.$queryRaw.mockResolvedValue([perfil({ cedula: '0012345' })]);
      db.syncAudit.findMany.mockResolvedValue([{ outcome: 'OK', op: 'INSERT', detail: `${PREFIJO}; no se creó Appointment`, createdAt: new Date(AHORA - DIA) }]);

      const r = await investigarCupoB(como(db), admin(), entrada({ documento: '12345' }));

      expect(r.success && r.data.identidad).toMatchObject({ encontrada: true, coincidencia: 'SIN_CEROS', documento: '•••2345' });
      expect(r.success && r.data.resultado.veredictos.map((v) => v.codigo)).toContain('IDENTIDAD_NO_COINCIDE');
      const sql = db.$queryRaw.mock.calls[0][0] as { values: unknown[] };
      expect(sql.values).toEqual(expect.arrayContaining([ORG, '12345']));
    });

    it('sin perfil: no es un veredicto; el documento se enmascara igual', async () => {
      const db = preparar();
      const r = await investigarCupoB(como(db), admin(), entrada());
      expect(r.success && r.data.identidad).toMatchObject({ encontrada: false, pacienteId: null, documento: '•••3456' });
      expect(JSON.stringify(r)).not.toContain('1088123456');
    });

    it('dos perfiles con el mismo número base: cuenta la variante', async () => {
      const db = preparar();
      db.$queryRaw.mockResolvedValue([perfil(), perfil({ id: 'pac-2', cedula: '01088123456' })]);
      const r = await investigarCupoB(como(db), admin(), entrada());
      expect(r.success && r.data.identidad).toMatchObject({ coincidencia: 'EXACTA', perfilesConVariante: 1 });
    });

    it('el nombre sale enmascarado', async () => {
      const db = preparar();
      db.$queryRaw.mockResolvedValue([perfil()]);
      const r = await investigarCupoB(como(db), admin(), entrada());
      expect(r.success && r.data.identidad.nombre).toBe('María L•••');
    });
  });

  it('anota la consulta con modo B, el documento ENMASCARADO y los veredictos', async () => {
    const db = preparar();
    db.$queryRaw.mockResolvedValue([perfil()]);
    await investigarCupoB(como(db), admin(), entrada({ motivo: 'SOPORTE_TECNICO' }));

    expect((db.patientLookupLog.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
      organizationId: ORG,
      mode: 'B',
      queryKind: 'CEDULA',
      queryMasked: '•••3456',
      reason: 'SOPORTE_TECNICO',
      candidateIds: ['pac-1'],
      openedPatientId: 'pac-1',
      verdicts: [{ codigo: 'SIN_EVENTO_DEL_HIS', citaId: null }],
    });
    expect(JSON.stringify(db.patientLookupLog.create.mock.calls[0][0])).not.toContain('1088123456');
  });

  it('🔒 si NO se puede registrar, NO se devuelve el resultado', async () => {
    const db = preparar();
    db.patientLookupLog.create.mockRejectedValue(new Error('caída'));
    const espia = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await investigarCupoB(como(db), admin(), entrada())).toEqual({ success: false, error: MSG_NO_REGISTRADA });
    espia.mockRestore();
  });

  it('todas las lecturas llevan la clínica de la sesión (SUPER_ADMIN en otra clínica)', async () => {
    const db = preparar();
    db.$queryRaw.mockResolvedValue([perfil()]);
    await investigarCupoB(como(db), superAdmin('org-9'), entrada());
    verificaTenant(db, 'org-9');
    for (const m of [db.mirrorEntityMap.findFirst, db.mirrorCatalogEntry.findFirst, db.scheduleSlot.findFirst, db.doctorProfile.findFirst]) {
      expect((m.mock.calls[0][0] as { where: { organizationId: string } }).where.organizationId).toBe('org-9');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Revelar y bitácora
// ═══════════════════════════════════════════════════════════════════════════

describe('revelarIdentidad', () => {
  it('devuelve los datos completos y lo ANOTA como REVEAL', async () => {
    const db = mockDb();
    db.patientProfile.findFirst.mockResolvedValue({ id: 'pac-1', cedula: '1088123456', whatsappId: '573001112233', bsuid: null });

    const r = await revelarIdentidad(como(db), admin(), { pacienteId: 'pac-1', ...MOTIVO });

    expect(r).toEqual({ success: true, data: { documento: '1088123456', whatsapp: '573001112233', bsuid: null } });
    expect((db.patientLookupLog.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
      queryKind: 'REVEAL',
      queryMasked: '•••3456',
      openedPatientId: 'pac-1',
      reason: 'PACIENTE_EN_VENTANILLA',
    });
    expect(db.patientProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pac-1', organizationId: ORG } }),
    );
  });

  it('🏢 un paciente de otra clínica: "no encontrado" y NO deja de anotar nada raro', async () => {
    const db = mockDb();
    expect(await revelarIdentidad(como(db), admin(), { pacienteId: 'pac-x', ...MOTIVO })).toEqual({ success: false, error: 'Paciente no encontrado.' });
    expect(db.patientLookupLog.create).not.toHaveBeenCalled();
  });

  it('🏥 un DOCTOR solo revela pacientes con relación terapéutica', async () => {
    const db = mockDb();
    await revelarIdentidad(como(db), doctor(), { pacienteId: 'pac-1', ...MOTIVO });
    expect((db.patientProfile.findFirst.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
      appointments: { some: { scheduleSlot: { doctorId: 'doc-7' } } },
    });
  });

  it('🔒 sin poder anotarlo, no revela', async () => {
    const db = mockDb();
    db.patientProfile.findFirst.mockResolvedValue({ id: 'pac-1', cedula: '1088123456', whatsappId: null, bsuid: null });
    db.patientLookupLog.create.mockRejectedValue(new Error('caída'));
    const espia = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await revelarIdentidad(como(db), admin(), { pacienteId: 'pac-1', ...MOTIVO })).toEqual({ success: false, error: MSG_NO_REGISTRADA });
    espia.mockRestore();
  });

  it('exige motivo, y un id que no sea texto no consulta nada', async () => {
    const db = mockDb();
    expect((await revelarIdentidad(como(db), admin(), { pacienteId: 'pac-1', motivo: 'X' })).success).toBe(false);
    expect((await revelarIdentidad(como(db), admin(), { pacienteId: { $ne: 1 }, ...MOTIVO })).success).toBe(false);
    expect(db.patientProfile.findFirst).not.toHaveBeenCalled();
  });
});

describe('listarConsultas', () => {
  it.each(['BOOKING_AGENT', 'DOCTOR'] as const)('%s no puede ver la bitácora', async (rol) => {
    const a = rol === 'DOCTOR' ? doctor() : agente();
    expect(await listarConsultas(como(mockDb()), a)).toEqual({ success: false, error: SIN_PERMISOS });
  });

  it('ORG_ADMIN ve las consultas DE SU CLÍNICA, con el correo de quien consultó', async () => {
    const db = mockDb();
    db.patientLookupLog.count.mockResolvedValue(60);
    db.patientLookupLog.findMany.mockResolvedValue([
      {
        id: 'l-1', createdAt: new Date(AHORA), actorUserId: 'u-9', actorRole: 'BOOKING_AGENT', mode: 'A', queryKind: 'OPEN',
        queryMasked: '•••3456', reason: 'RECLAMO_PQRS', reasonNote: 'PQRS 1', candidateIds: ['pac-1'], openedPatientId: 'pac-1',
        verdicts: [{ codigo: 'CONFIRMADA_NO_LLEGO', citaId: 'apt-1' }],
      },
      {
        id: 'l-2', createdAt: new Date(AHORA - MIN), actorUserId: 'u-9', actorRole: 'BOOKING_AGENT', mode: 'A', queryKind: 'CEDULA',
        queryMasked: '•••3456', reason: 'PACIENTE_EN_VENTANILLA', reasonNote: null, candidateIds: ['pac-1', 'pac-2'], openedPatientId: null, verdicts: null,
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: 'u-9', email: 'agente@clinica.co' }]);

    const r = await listarConsultas(como(db), admin(), { pagina: 2 });

    expect(r.success && r.data).toMatchObject({ total: 60, pagina: 2, paginas: 3 });
    expect(r.success && r.data.filas).toEqual([
      expect.objectContaining({ actorEmail: 'agente@clinica.co', tipo: 'OPEN', abrioExpediente: true, candidatos: 1, veredictos: ['CONFIRMADA_NO_LLEGO'], nota: 'PQRS 1' }),
      expect.objectContaining({ tipo: 'CEDULA', abrioExpediente: false, candidatos: 2, veredictos: [] }),
    ]);
    expect(db.patientLookupLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG }, skip: 25, take: 25, orderBy: { createdAt: 'desc' } }),
    );
    expect(db.patientLookupLog.count).toHaveBeenCalledWith({ where: { organizationId: ORG } });
  });

  it('🏥 marca las consultas que incluyeron lo que el HIS respondió en vivo (la bitácora las distingue)', async () => {
    const db = mockDb();
    const fila = (id: string, queryKind: string, liveHisRequested: boolean) => ({
      id, createdAt: new Date(AHORA), actorUserId: 'u-9', actorRole: 'ORG_ADMIN', mode: 'A', queryKind,
      queryMasked: '•••3456', reason: 'RECLAMO_PQRS', reasonNote: null, candidateIds: [], openedPatientId: 'pac-1', verdicts: null, liveHisRequested,
    });
    db.patientLookupLog.findMany.mockResolvedValue([fila('a', 'LIVE_HIS', true), fila('b', 'OPEN', true), fila('c', 'OPEN', false)]);

    const r = await listarConsultas(como(db), admin());

    expect(r.success && r.data.filas.map((f) => [f.tipo, f.enVivo])).toEqual([
      ['LIVE_HIS', true],
      ['OPEN', true],
      ['OPEN', false],
    ]);
  });

  it('SUPER_ADMIN ve las de la clínica elegida', async () => {
    const db = mockDb();
    await listarConsultas(como(db), superAdmin('org-9'));
    expect(db.patientLookupLog.count).toHaveBeenCalledWith({ where: { organizationId: 'org-9' } });
  });

  it('una página inválida cae a la 1', async () => {
    const db = mockDb();
    const r = await listarConsultas(como(db), admin(), { pagina: -5 });
    expect(r.success && r.data.pagina).toBe(1);
    expect((db.patientLookupLog.findMany.mock.calls[0][0] as { skip: number }).skip).toBe(0);
  });
});
