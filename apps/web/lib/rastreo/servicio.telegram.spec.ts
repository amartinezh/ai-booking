/* eslint-disable @typescript-eslint/no-unused-vars -- los dobles de Prisma declaran `...args` para poder leer `mock.calls[n][0]` con tipos */
import { permisosDeRol, type ActorRastreo, type RolRastreo } from './acceso';
import { armarExpedienteA } from './servicio';

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
    telegramMessageLog: { findMany: vacio() },
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

// ═══════════════════════════════════════════════════════════════════════════
// Rastreo de un paciente de Telegram (docs/PLAN_TELEGRAM.md, Fase 3)
//
// Suite aparte (con su propio doble, que SÍ tiene `telegramMessageLog`) para
// que la de siempre siga probando que un paciente de WhatsApp hace
// exactamente las mismas lecturas que antes de Telegram.
// ═══════════════════════════════════════════════════════════════════════════

const MOTIVO = { motivo: 'PACIENTE_EN_VENTANILLA' };
const abrir = (db: Db) =>
  armarExpedienteA(como(db), admin(), { sujeto: { tipo: 'PACIENTE', id: 'pac-1' }, ...MOTIVO });

describe('armarExpedienteA — Telegram', () => {
  const preparar = (cita: Record<string, unknown>, pac: Record<string, unknown> = {}) => {
    const db = mockDb();
    db.patientProfile.findFirst.mockResolvedValue(
      paciente({ whatsappId: null, telegramChatId: '777', ...pac }),
    );
    db.appointment.findMany.mockResolvedValue([citaBD(cita)]);
    return db;
  };

  it('la conversación se busca también bajo tg:<chat>', async () => {
    const db = preparar({ origin: 'TELEGRAM' }, { whatsappId: '573001112233' });
    await abrir(db);
    const where = (db.interactionLog.findMany.mock.calls[0][0] as { where: { whatsappId: { in: string[] } } }).where;
    expect(where.whatsappId.in).toEqual(expect.arrayContaining(['573001112233', 'tg:777']));
  });

  it('la confirmación de una cita de Telegram sale de SU libro, en la clínica de la sesión', async () => {
    const db = preparar({ origin: 'TELEGRAM' });
    db.telegramMessageLog.findMany.mockResolvedValue([
      { appointmentId: 'apt-1', status: 'ACCEPTED', createdAt: new Date(AHORA - 29 * MIN), errorCode: null, errorDetail: null },
    ]);

    const r = await abrir(db);

    const q = db.telegramMessageLog.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(q.where).toEqual({
      organizationId: ORG,
      appointmentId: { in: ['apt-1'] },
      kind: 'BOOKING_CONFIRMATION',
    });
    const texto = r.success ? r.data.resultado.principal.evidencia.join(' ') : '';
    expect(texto).toContain('Creada por Telegram');
    expect(texto).toContain('La confirmación por Telegram se envió');
    const pasos = r.success ? Object.fromEntries(r.data.citas[0].lineaDeVida.map((p) => [p.clave, p.estado])) : {};
    expect(pasos).toMatchObject({ confirmacion_enviada: 'ok', confirmacion_entregada: 'ok' });
  });

  it('una confirmación fallida por Telegram (bloqueó al bot) se ve como fallida', async () => {
    const db = preparar({ origin: 'TELEGRAM' });
    db.telegramMessageLog.findMany.mockResolvedValue([
      { appointmentId: 'apt-1', status: 'FAILED', createdAt: new Date(AHORA - 29 * MIN), errorCode: '403', errorDetail: 'Forbidden: bot was blocked by the user' },
    ]);
    const r = await abrir(db);
    const pasos = r.success ? Object.fromEntries(r.data.citas[0].lineaDeVida.map((p) => [p.clave, p.estado])) : {};
    expect(pasos.confirmacion_entregada).toBe('fail');
  });

  it('sin citas de Telegram, el libro de Telegram ni se consulta', async () => {
    const db = preparar({ origin: 'WHATSAPP' }, { whatsappId: '573001112233', telegramChatId: null });
    await abrir(db);
    expect(db.telegramMessageLog.findMany).not.toHaveBeenCalled();
    const where = (db.interactionLog.findMany.mock.calls[0][0] as { where: { whatsappId: { in: string[] } } }).where;
    expect(where.whatsappId.in).toEqual(['573001112233']);
  });

  it('el expediente dice si tiene Telegram (sin mostrar el chat), y un paciente de WhatsApp no gana el campo', async () => {
    const conTg = await abrir(preparar({ origin: 'TELEGRAM' }));
    expect(conTg.success && conTg.data.identidad?.telegram).toBe('VINCULADO');
    expect(JSON.stringify(conTg.success && conTg.data.identidad)).not.toContain('777');

    const bloqueado = await abrir(preparar({ origin: 'TELEGRAM' }, { telegramBlockedAt: new Date(AHORA - DIA) }));
    expect(bloqueado.success && bloqueado.data.identidad?.telegram).toBe('BLOQUEADO');

    const soloWa = await abrir(preparar({ origin: 'WHATSAPP' }, { whatsappId: '573001112233', telegramChatId: null }));
    expect(soloWa.success && soloWa.data.identidad).not.toHaveProperty('telegram');
  });
});
