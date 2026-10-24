import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotService } from './chatbot.service';
import { ChatState } from './chatbot.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { RedisService } from '../redis/redis.service';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { ChannelActivityService } from '../interaction-log/channel-activity.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { WhatsappMessageLogService } from '../whatsapp-config/whatsapp-message-log.service';
import { SurveyService } from '../survey/survey.service';
import { AudioConfigService } from '../audio-config/audio-config.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
import { SchedulingExtraction } from '../llm/interfaces/llm-provider.interface';
import { ConsultaHisBotService } from './consulta-his-bot.service';
import { MirrorExceptionsService } from '../mirror/mirror-exceptions.service';

// ════════════════════════════════════════════════════════════════════
// CONSULTA DE CITAS ("¿qué citas tengo?") — E2E conversacional
//
// Nace de dos capturas de Telegram del 2026-10-02: con el menú abierto y
// desde una sesión vacía, «¿Qué citas tengo?» recibía «Perfecto, con gusto
// le agendo su cita» y el menú de servicios. Como en chatbot.flows.e2e.spec,
// cada prueba conversa con `processIncomingMessage` y solo se simula el envío.
// ════════════════════════════════════════════════════════════════════

const ORG_ID = 'org-1';
const PHONE_ID = 'phone-number-id-123';
const SENDER = '573001112233';
const OTRO_NUMERO = '573009998877';
const CEDULA = '1088123456';
const SOPORTE = '6068538838';

// 2 de octubre de 2026, 10:00 a. m. en Bogotá (UTC-5).
const AHORA = new Date('2026-10-02T15:00:00.000Z');
const HOY_8AM = new Date('2026-10-02T13:00:00.000Z'); // ya pasó
const HOY_4PM = new Date('2026-10-02T21:00:00.000Z');
const MANANA = new Date('2026-10-03T14:00:00.000Z');
const SEMANA_PASADA = new Date('2026-09-25T14:00:00.000Z');

const SVC_MEDICINA = { id: 'svc-med', name: 'Medicina General' };
const SVC_ODONTO = { id: 'svc-odo', name: 'Odontología' };

function createFakeRedis() {
  const store = new Map<string, string>();
  const globToRegex = (pattern: string) =>
    new RegExp(
      '^' +
        pattern.replace(/[.+?^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') +
        '$',
    );
  return {
    store,
    get: jest.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, String(v));
      return 'OK';
    }),
    del: jest.fn((...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    keys: jest.fn((pattern: string) => {
      const re = globToRegex(pattern);
      return [...store.keys()].filter((k) => re.test(k));
    }),
    expire: jest.fn((k: string) => (store.has(k) ? 1 : 0)),
    ttl: jest.fn((k: string) => (store.has(k) ? -1 : -2)),
  };
}

function extraction(
  over: Partial<SchedulingExtraction> = {},
): SchedulingExtraction {
  return {
    transcript: null,
    cedula: null,
    nombre: null,
    eps: null,
    especialidad: null,
    doctor: null,
    fechaSolicitada: null,
    intent: 'otro',
    isEscape: false,
    outOfContext: false,
    ininteligible: false,
    isFallback: false,
    isCancellation: false,
    isModification: false,
    isEmergency: false,
    isRateLimited: false,
    ...over,
  };
}

type Db = {
  patients: any[];
  appointments: any[];
  slots: any[];
  mirror: any;
  /** HisLookupRequest */
  requests: any[];
  /** MirrorEntityMap */
  maps: any[];
  doctors: any[];
  /** SyncException: los casos de la Bandeja (los que abre el bot quedan aquí). */
  casos: any[];
};

/**
 * Un `where` de Prisma sobre una fila en memoria: igualdad, `null`, `{ in }`,
 * `{ gte }` y `{ lt }`. Suficiente para las consultas del bot al HIS; lo que no
 * entiende lo rechaza (mejor una prueba que falla que una que pasa por error).
 */
function cumple(fila: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    const v = fila[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v?.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      return Object.entries(cond).every(([op, x]: [string, any]) => {
        if (op === 'in') return x.includes(v);
        if (op === 'gte') return v >= x;
        if (op === 'lt') return v < x;
        throw new Error(`operador no soportado en el doble: ${op}`);
      });
    }
    return v === cond;
  });
}

/** ¿El perfil cumple alguna de las condiciones de canal (teléfono / BSUID / chat)? */
const esDeAlgunCanal = (canales: any[], pac: any): boolean =>
  !!pac &&
  canales.some(
    (c) =>
      (c.whatsappId?.in ?? []).includes(pac.whatsappId) ||
      (typeof c.bsuid === 'string' && c.bsuid === pac.bsuid) ||
      (c.bsuid?.in ?? []).includes(pac.bsuid) ||
      (!!c.telegramChatId && c.telegramChatId === pac.telegramChatId),
  );

function createPrisma(db: Db) {
  const slotDe = (a: any) => db.slots.find((s) => s.id === a.scheduleSlotId);
  /**
   * 🩺 El alcance del bot sobre el cupo de una cita, como lo pide la consulta:
   * médico con «WhatsApp ON», servicio activo, o cualquiera de un `OR`.
   */
  const cupoCumple = (filtro: any, slot: any): boolean => {
    if (!filtro) return true;
    if (Array.isArray(filtro.OR)) {
      return filtro.OR.some((f: any) => cupoCumple(f, slot));
    }
    const medico = filtro.doctor?.whatsappBookingEnabled;
    const servicio = filtro.service?.isActive;
    return (
      (medico === undefined ||
        (slot?.doctor?.whatsappBookingEnabled ?? true) === medico) &&
      (servicio === undefined || (slot?.service?.isActive ?? true) === servicio)
    );
  };
  const pacientesDe = (where: any) =>
    db.patients.filter((p) =>
      where.OR
        ? esDeAlgunCanal(where.OR, p)
        : !where.telegramChatId || where.telegramChatId === p.telegramChatId,
    );
  const tx = {
    scheduleSlot: {
      findUnique: jest.fn(({ where }: any) =>
        db.slots.find((s) => s.id === where.id),
      ),
      update: jest.fn(({ where, data }: any) => {
        const s = db.slots.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    appointment: {
      update: jest.fn(({ where, data }: any) => {
        const a = db.appointments.find((x) => x.id === where.id);
        if (a) Object.assign(a, data);
        return a;
      }),
    },
  };
  return {
    whatsappAccountConfig: {
      findUnique: jest.fn(() => ({
        organization: {
          id: ORG_ID,
          name: 'Hospital San Vicente',
          isActive: true,
          supportPhone: SOPORTE,
        },
      })),
    },
    organization: {
      findMany: jest.fn(() => []),
      findUnique: jest.fn(() => ({
        id: ORG_ID,
        name: 'Hospital San Vicente',
        supportPhone: SOPORTE,
        timezone: null,
      })),
    },
    hospitalMirrorConfig: {
      findUnique: jest.fn(() => db.mirror),
    },
    syncException: {
      findMany: jest.fn(({ where }: any) =>
        db.casos.filter(
          (c) =>
            c.kind === where.kind &&
            where.status.in.includes(c.status) &&
            where.patientId.in.includes(c.patientId),
        ),
      ),
    },
    medicalService: {
      findMany: jest.fn(({ where }: any = {}) =>
        [SVC_MEDICINA, SVC_ODONTO].filter(
          (sv) => !where?.id?.in || where.id.in.includes(sv.id),
        ),
      ),
      findFirst: jest.fn(() => null),
    },
    eps: {
      findMany: jest.fn(() => []),
      findFirst: jest.fn(() => null),
      findUnique: jest.fn(() => null),
    },
    patientProfile: {
      findFirst: jest.fn(
        ({ where }: any) =>
          db.patients.find((p) => p.cedula === where.cedula) ?? null,
      ),
      // La baja de recordatorios («no quiero más recordatorios», «número equivocado»).
      updateMany: jest.fn(({ where, data }: any) => {
        const filas = pacientesDe(where);
        for (const p of filas) Object.assign(p, data);
        return { count: filas.length };
      }),
      // La consulta por canal del remitente (OR de teléfono / BSUID / chat).
      findMany: jest.fn(({ where }: any) =>
        db.patients.filter((p) => esDeAlgunCanal(where.OR ?? [], p)),
      ),
    },
    doctorProfile: {
      findMany: jest.fn(({ where }: any = {}) =>
        db.doctors.filter((d) => !where?.id?.in || where.id.in.includes(d.id)),
      ),
    },
    mirrorEntityMap: {
      findMany: jest.fn(({ where }: any) =>
        db.maps.filter((m) => cumple(m, where)),
      ),
    },
    hisLookupRequest: {
      findFirst: jest.fn(({ where }: any) => {
        const filas = db.requests.filter((r) => cumple(r, where));
        return filas.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      }),
      count: jest.fn(
        ({ where }: any) => db.requests.filter((r) => cumple(r, where)).length,
      ),
      create: jest.fn(({ data }: any) => {
        const r = {
          id: `req-${db.requests.length + 1}`,
          status: 'PENDIENTE',
          result: null,
          botFollowupAt: null,
          purgedAt: null,
          createdAt: new Date(),
          ...data,
        };
        db.requests.push(r);
        return { id: r.id };
      }),
      findMany: jest.fn(({ where }: any) =>
        db.requests.filter((r) => cumple(r, where)),
      ),
      updateMany: jest.fn(({ where, data }: any) => {
        const filas = db.requests.filter((r) => cumple(r, where));
        for (const r of filas) Object.assign(r, data);
        return { count: filas.length };
      }),
    },
    appointment: {
      findMany: jest.fn(({ where, take }: any) => {
        const desde: Date | undefined = where.scheduleSlot?.startTime?.gte;
        const despues: Date | undefined = where.scheduleSlot?.startTime?.gt;
        // Por paciente, o por el canal de quien escribe (el aviso de «no puedo ir»).
        const delPaciente = (a: any) =>
          where.patient?.OR
            ? esDeAlgunCanal(
                where.patient.OR,
                db.patients.find((x) => x.id === a.patientId),
              )
            : a.patientId === where.patientId;
        // Las recordadas de quien escribe (respuestas al recordatorio).
        const recordadaDesde: Date | undefined = where.reminderSentAt?.gte;
        // 🩺 Solo médicos con «WhatsApp ON» y servicios activos, si lo pide.
        const filas = db.appointments
          .filter((a) => delPaciente(a) && a.status === where.status)
          .filter((a) => cupoCumple(where.scheduleSlot, slotDe(a)))
          .filter(
            (a) =>
              !recordadaDesde ||
              (!!a.reminderSentAt && a.reminderSentAt >= recordadaDesde),
          )
          // Como Prisma con `include: { patient }`: el paciente de la cita.
          .map((a) => ({
            ...a,
            scheduleSlot: slotDe(a),
            patient: db.patients.find((x) => x.id === a.patientId),
          }))
          .filter((a) => !desde || a.scheduleSlot.startTime >= desde)
          .filter((a) => !despues || a.scheduleSlot.startTime > despues)
          .sort(
            (x, y) =>
              x.scheduleSlot.startTime.getTime() -
              y.scheduleSlot.startTime.getTime(),
          );
        return take ? filas.slice(0, take) : filas;
      }),
      findUnique: jest.fn(({ where }: any) => {
        const a = db.appointments.find((x) => x.id === where.id);
        return a ? { ...a, scheduleSlot: slotDe(a) } : null;
      }),
      // Cuántas citas próximas tiene quien escribe («no puedo asistir» sin recordatorio).
      count: jest.fn(({ where }: any) => {
        const despues: Date | undefined = where.scheduleSlot?.startTime?.gt;
        const desde: Date | undefined = where.scheduleSlot?.startTime?.gte;
        return db.appointments.filter(
          (a) =>
            a.status === where.status &&
            (where.patientId
              ? a.patientId === where.patientId
              : esDeAlgunCanal(
                  where.patient?.OR ?? [],
                  db.patients.find((x) => x.id === a.patientId),
                )) &&
            (!despues || slotDe(a).startTime > despues) &&
            (!desde || slotDe(a).startTime >= desde) &&
            cupoCumple(where.scheduleSlot, slotDe(a)),
        ).length;
      }),
      // La cita recordada de quien escribe (respuesta al recordatorio).
      findFirst: jest.fn(({ where }: any) => {
        // Por id (p. ej. comprobar el médico de la cita antes de cancelarla).
        if (where.id) {
          const a = db.appointments.find(
            (x) =>
              x.id === where.id && x.organizationId === where.organizationId,
          );
          return a ? { ...a, scheduleSlot: slotDe(a) } : null;
        }
        // 🔎 La cita que el asistente le acaba de agendar (revisar una cita).
        if (where.createdAt?.gte) {
          return (
            db.appointments
              .filter(
                (a) =>
                  a.organizationId === where.organizationId &&
                  a.status === where.status &&
                  where.origin.in.includes(a.origin) &&
                  a.createdAt &&
                  a.createdAt >= where.createdAt.gte,
              )
              .map((a) => ({ ...a, scheduleSlot: slotDe(a) }))
              .filter(
                (a) =>
                  a.scheduleSlot.startTime > where.scheduleSlot.startTime.gt &&
                  esDeAlgunCanal(
                    where.patient?.OR ?? [],
                    db.patients.find((x) => x.id === a.patientId),
                  ),
              )
              .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0] ??
            null
          );
        }
        if (!where.reminderSentAt) return null;
        const canales: any[] = where.patient?.OR ?? [];
        const esDelRemitente = (pac: any) => esDeAlgunCanal(canales, pac);
        return (
          db.appointments
            .filter(
              (a) =>
                a.organizationId === where.organizationId &&
                a.status === where.status &&
                a.reminderSentAt &&
                a.reminderSentAt >= where.reminderSentAt.gte,
            )
            .map((a) => ({ ...a, scheduleSlot: slotDe(a) }))
            .filter(
              (a) =>
                a.scheduleSlot.startTime >= where.scheduleSlot.startTime.gte &&
                esDelRemitente(db.patients.find((x) => x.id === a.patientId)),
            )
            .sort(
              (x, y) =>
                x.scheduleSlot.startTime.getTime() -
                y.scheduleSlot.startTime.getTime(),
            )[0] ?? null
        );
      }),
      update: tx.appointment.update,
    },
    scheduleSlot: {
      findUnique: tx.scheduleSlot.findUnique,
      update: tx.scheduleSlot.update,
    },
    $transaction: jest.fn((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
  };
}

const slotRow = (id: string, fecha: Date, doctor: string, service: any) => ({
  id,
  startTime: fecha,
  isAvailable: false,
  organizationId: ORG_ID,
  serviceId: service.id,
  allowedEpsId: null,
  doctorId: `doc-${doctor}`,
  doctor: { fullName: doctor, whatsappBookingEnabled: true },
  service,
});

describe('ChatbotService — consulta de citas (E2E conversacional)', () => {
  let service: ChatbotService;
  let redis: ReturnType<typeof createFakeRedis>;
  let db: Db;
  let provider: { name: string; extractSchedulingIntent: jest.Mock };
  let interactionLog: Record<string, jest.Mock>;
  let sendSpy: jest.SpyInstance;
  /** `OrganizationSettings.bookingEnabled` de la clínica (se lee en cada turno). */
  let bookingEnabled: boolean;
  /**
   * `cancelEnabled` / `rescheduleEnabled`. `null` = siguen a `bookingEnabled`,
   * que es como nacen en la migración: las pruebas de «solo consultas» apagan
   * las tres con solo `bookingEnabled = false`.
   */
  let cancelEnabled: boolean | null;
  let rescheduleEnabled: boolean | null;
  /** La bandeja del personal: lo que el bot deja ahí (avisos de pacientes). */
  let avisos: { registrar: jest.Mock };

  const sent = (): string[] =>
    sendSpy.mock.calls.map((c: any[]) => c[1] as string);
  const lastSent = (): string => sent()[sent().length - 1] ?? '';
  const state = (): string | null =>
    redis.store.get(`chat_state:${ORG_ID}:${SENDER}`) ?? null;
  const say = (body: string, from = SENDER) =>
    service.processIncomingMessage({
      from,
      type: 'text',
      text: { body },
      metadata: { phone_number_id: PHONE_ID },
    });
  /** Todo lo que el bot dejó en la bitácora en los pasos de la consulta. */
  const pasos = (): any[] =>
    [...interactionLog.logSuccess.mock.calls, ...interactionLog.log.mock.calls]
      .map((c: any[]) => c[0])
      .filter((e: any) => /LOOKUP/.test(JSON.stringify(e?.metadata ?? {})));

  const seedPaciente = (over: Record<string, unknown> = {}) => {
    const p = {
      id: 'pat-1',
      cedula: CEDULA,
      fullName: 'Juan Pérez',
      organizationId: ORG_ID,
      epsId: null,
      whatsappId: SENDER,
      bsuid: null,
      telegramChatId: null,
      ...over,
    };
    db.patients.push(p);
    return p;
  };
  const seedCita = (
    id: string,
    fecha: Date,
    service = SVC_MEDICINA,
    patientId = 'pat-1',
    status = 'SCHEDULED',
  ) => {
    db.slots.push(slotRow(`slot-${id}`, fecha, `Dr ${id}`, service));
    db.appointments.push({
      id,
      patientId,
      scheduleSlotId: `slot-${id}`,
      status,
      epsId: null,
      organizationId: ORG_ID,
    });
  };

  beforeEach(async () => {
    // Solo se congela el reloj: los temporizadores siguen siendo reales.
    jest.useFakeTimers({
      now: AHORA,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    });
    redis = createFakeRedis();
    // Como la Bandeja de verdad: el caso de teléfono equivocado queda abierto.
    avisos = {
      registrar: jest.fn(async (_org: string, entrada: any) => {
        if (entrada?.kind === 'TELEFONO_EQUIVOCADO') {
          db.casos.push({
            kind: entrada.kind,
            status: 'ABIERTA',
            patientId: entrada.patientId,
          });
        }
        return 'CREADA';
      }),
    };
    bookingEnabled = true;
    cancelEnabled = null;
    rescheduleEnabled = null;
    db = {
      patients: [],
      appointments: [],
      slots: [],
      mirror: null,
      requests: [],
      maps: [],
      doctors: [],
      casos: [],
    };
    provider = {
      name: 'GEMINI',
      extractSchedulingIntent: jest.fn(() => extraction()),
    };
    interactionLog = {
      logSuccess: jest.fn(async () => {}),
      logFailure: jest.fn(async () => {}),
      log: jest.fn(async () => {}),
      logWaitlistJoined: jest.fn(async () => {}),
      logBookingConfirmed: jest.fn(async () => {}),
      logWaitlistNotification: jest.fn(async () => {}),
      logOutbound: jest.fn(async () => {}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        // El servicio REAL de la Fase B, sobre el mismo doble de la base.
        ConsultaHisBotService,
        { provide: PrismaService, useValue: createPrisma(db) },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: HttpService, useValue: { post: jest.fn() } },
        { provide: RedisService, useValue: redis },
        {
          provide: AppointmentsService,
          useValue: {
            getAvailableSlots: jest.fn(() => []),
            bookAppointment: jest.fn(),
            regimenDelPadron: jest.fn(() => null),
          },
        },
        {
          provide: WaitlistService,
          useValue: { notifyWaitlist: jest.fn(() => undefined) },
        },
        { provide: InteractionLogService, useValue: interactionLog },
        {
          provide: ChannelActivityService,
          useValue: { record: jest.fn(async () => undefined) },
        },
        {
          provide: WhatsappMessageLogService,
          useValue: { recordOutbound: jest.fn() },
        },
        {
          provide: KnowledgeBaseService,
          useValue: { hasContent: jest.fn(() => false) },
        },
        {
          provide: OrganizationSettingsService,
          useValue: {
            getBotName: jest.fn(() => 'Vicente'),
            getMaxRetries: jest.fn(() => 3),
            getCommunicationStyle: jest.fn(() => 'FORMAL'),
            isBookingEnabled: jest.fn(() => bookingEnabled),
            operacionesDelBot: jest.fn(() => ({
              agendar: bookingEnabled,
              cancelar: cancelEnabled ?? bookingEnabled,
              modificar: rescheduleEnabled ?? bookingEnabled,
            })),
          },
        },
        {
          provide: LlmFactoryService,
          useValue: { forOrgOrNull: jest.fn(() => provider) },
        },
        {
          provide: WhatsappCredentialsService,
          useValue: { forOrg: jest.fn(() => null) },
        },
        {
          provide: SurveyService,
          useValue: { generateSurveyToken: jest.fn(() => 'tok') },
        },
        {
          provide: AudioConfigService,
          useValue: { getEffective: jest.fn(() => null) },
        },
        {
          provide: TtsFactoryService,
          useValue: { synthesize: jest.fn(() => null) },
        },
        { provide: MirrorExceptionsService, useValue: avisos },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);
    service.reloadPatterns();
    sendSpy = jest
      .spyOn(service as any, 'sendWhatsAppMessage')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'sendSurveyLink').mockResolvedValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  // ──────────────────────────────────────────────────────────────────
  // Las dos capturas
  // ──────────────────────────────────────────────────────────────────
  describe('las capturas del 2026-10-02', () => {
    it('captura 1: con el menú abierto, «Que citas tengo?» muestra sus citas en vez de re-mostrar el menú', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);

      await say('Hola');
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);
      const llamadasLlm = provider.extractSchedulingIntent.mock.calls.length;

      await say('Que citas tengo?');
      const r = lastSent();
      expect(r).not.toContain('le agendo');
      expect(r).toContain('Citas de *Juan Pérez*');
      expect(r).toContain('Medicina General');
      expect(r).toContain('Odontología');
      expect(r).toContain('*A)* Cancelar una cita');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);
      // Determinista: no gastó una llamada al LLM.
      expect(provider.extractSchedulingIntent.mock.calls.length).toBe(
        llamadasLlm,
      );
    });

    it('captura 2: desde una sesión vacía, «Que citas tengo hoy?» separa las de hoy (aunque ya hayan pasado) de las próximas', async () => {
      seedPaciente();
      seedCita('apt-hoy-1', HOY_8AM);
      seedCita('apt-hoy-2', HOY_4PM, SVC_ODONTO);
      seedCita('apt-man', MANANA);
      seedCita('apt-vieja', SEMANA_PASADA);

      await say('Que citas tengo hoy?');
      const r = lastSent();
      const hoy = r.slice(r.indexOf('*Hoy:*'), r.indexOf('*Próximas:*'));
      expect(hoy).toContain('Dr apt-hoy-1');
      expect(hoy).toContain('Dr apt-hoy-2');
      expect(r.slice(r.indexOf('*Próximas:*'))).toContain('Dr apt-man');
      expect(r).not.toContain('Dr apt-vieja');
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
    });

    it.each(['Consultar', 'consultar', 'Consultar.', 'CONSULTAR'])(
      'captura del 2026-10-03: «%s» a secas muestra sus citas, no el menú de servicios',
      async (texto) => {
        seedPaciente();
        seedCita('apt-1', MANANA);

        await say(texto);
        expect(lastSent()).toContain('Citas de *Juan Pérez*');
        expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);
        expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      },
    );

    it('«Consultar» con el menú de servicios abierto también muestra sus citas', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);

      await say('Hola');
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);
      await say('Consultar');
      expect(lastSent()).toContain('Citas de *Juan Pérez*');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);
    });

    it('«consultar las citas» (frase) también abre la consulta', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);

      await say('quiero consultar las citas');
      expect(lastSent()).toContain('Citas de *Juan Pérez*');
    });

    it('sin «hoy», lo que ya pasó hoy no se lista', async () => {
      seedPaciente();
      seedCita('apt-hoy-1', HOY_8AM);
      seedCita('apt-man', MANANA);

      await say('qué citas tengo');
      expect(lastSent()).not.toContain('Dr apt-hoy-1');
      expect(lastSent()).toContain('Dr apt-man');
      expect(lastSent()).not.toContain('*Hoy:*');
    });

    it('«hoy» sin citas hoy lo dice y muestra las próximas', async () => {
      seedPaciente();
      seedCita('apt-man', MANANA);

      await say('tengo cita hoy?');
      expect(lastSent()).toContain('Hoy no tiene citas agendadas.');
      expect(lastSent()).toContain('Dr apt-man');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Regla de identidad: detalle solo al paciente
  // ──────────────────────────────────────────────────────────────────
  describe('identidad', () => {
    it('remitente desconocido: pide la cédula; con la de otro paciente da solo una respuesta mínima y cierra', async () => {
      seedPaciente({ whatsappId: OTRO_NUMERO });
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'));

      await say('mis citas');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CEDULA);
      expect(lastSent()).toContain('cédula');

      await say(CEDULA);
      const r = lastSent();
      expect(r).toContain('hay citas próximas registradas: *2*');
      expect(r).toContain(SOPORTE);
      for (const dato of ['Juan', 'Medicina', 'Dr apt-1', 'oct']) {
        expect(r).not.toContain(dato);
      }
      expect(state()).toBe(ChatState.IDLE);

      // Ni la cédula queda en la bitácora: quien la escribió no probó ser su dueño.
      const minimo = pasos().find((e) => e.metadata.step === 'LOOKUP_MINIMAL');
      expect(minimo.userMessage).toBe('[cédula]');
      expect(JSON.stringify(minimo)).not.toContain(CEDULA);
    });

    it('a un tercero no le distingue «ese documento no existe» de «no tiene citas»', async () => {
      seedPaciente({ whatsappId: OTRO_NUMERO });

      await say('mis citas');
      await say(CEDULA); // existe, sin citas
      const existeSinCitas = lastSent();

      await say('mis citas');
      await say('99999999'); // no existe
      expect(lastSent()).toBe(existeSinCitas);
      expect(existeSinCitas).toContain('No encuentro citas próximas');
    });

    it('celular compartido por dos pacientes: pide la cédula y, con una de ellas, muestra el detalle', async () => {
      seedPaciente();
      seedPaciente({ id: 'pat-2', cedula: '555', fullName: 'Ana Pérez' });
      seedCita('apt-ana', MANANA, SVC_ODONTO, 'pat-2');

      await say('cuando es mi cita');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CEDULA);

      await say('555');
      expect(lastSent()).toContain('Citas de *Ana Pérez*');
      expect(lastSent()).toContain('Odontología');
    });

    it('la cédula escrita en el mismo mensaje se usa sin volver a pedirla', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);

      await say(`mis citas, cédula ${CEDULA}`);
      expect(lastSent()).toContain('Citas de *Juan Pérez*');
    });

    it('el paciente sin citas recibe su nombre y la invitación a agendar', async () => {
      seedPaciente();

      await say('que citas tengo');
      expect(lastSent()).toContain('*Juan Pérez* no tiene citas próximas');
      expect(state()).toBe(ChatState.IDLE);
    });

    it('número oculto: lo reconoce por el BSUID', async () => {
      seedPaciente({ whatsappId: null, bsuid: 'CO.777' });
      seedCita('apt-1', MANANA);

      await service.processIncomingMessage({
        from_user_id: 'CO.777',
        type: 'text',
        text: { body: 'que citas tengo' },
        metadata: { phone_number_id: PHONE_ID },
      } as any);
      const r = sendSpy.mock.calls.at(-1)?.[1] as string;
      expect(r).toContain('Citas de *Juan Pérez*');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Conexión con el hospital (genérica: sin saber qué HIS hay detrás)
  // ──────────────────────────────────────────────────────────────────
  describe('conexión con el hospital', () => {
    beforeEach(() => {
      seedPaciente();
      seedCita('apt-1', MANANA);
    });

    it('clínica sin hospital: sin advertencia', async () => {
      await say('que citas tengo');
      expect(lastSent()).not.toContain('directamente en el hospital');
      expect(pasos()[0].metadata.conexionHis).toBe('SIN_HOSPITAL');
    });

    it('con el interruptor del bot apagado manda el del bot, no el del personal: APAGADA, advierte y no consulta', async () => {
      db.mirror = {
        enabled: true,
        lookupEnabled: true, // el del personal, prendido
        botLookupMode: 'OFF',
        lastLookupCapable: true,
        lastHeartbeatAt: new Date(AHORA.getTime() - 60_000),
        lastHisReachable: true,
      };
      await say('que citas tengo');
      expect(lastSent()).toContain('directamente en el hospital');
      expect(lastSent()).toContain(SOPORTE);
      expect(pasos()[0].metadata.conexionHis).toBe('APAGADA');
      expect(db.requests).toHaveLength(0);
    });

    it('con el espejo apagado registra APAGADA y también advierte', async () => {
      db.mirror = {
        enabled: false,
        lookupEnabled: false,
        lastLookupCapable: null,
        lastHeartbeatAt: null,
        lastHisReachable: null,
      };
      await say('que citas tengo');
      expect(lastSent()).toContain('directamente en el hospital');
      expect(pasos()[0].metadata.conexionHis).toBe('APAGADA');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Qué hacer con las citas (A-D)
  // ──────────────────────────────────────────────────────────────────
  describe('opciones tras el detalle', () => {
    beforeEach(async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);
      await say('que citas tengo');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);
    });

    it('A) entra a cancelar con su cédula, sin volver a pedirla', async () => {
      await say('A');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_SELECTION);
      expect(lastSent()).toContain('cancelar');
      await say('B');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      await say('SI');
      expect(db.appointments.find((a) => a.id === 'apt-2').status).toBe(
        'CANCELLED',
      );
      expect(db.appointments.find((a) => a.id === 'apt-1').status).toBe(
        'SCHEDULED',
      );
    });

    it('B) entra a reprogramar con su cédula', async () => {
      await say('B');
      expect(state()).toBe(ChatState.AWAITING_MODIFY_SELECTION);
    });

    it('C) abre el menú de servicios para una cita nueva', async () => {
      await say('C');
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);
      expect(lastSent()).toContain('Medicina General');
    });

    it('D) se despide y cierra', async () => {
      await say('D');
      expect(state()).toBe(ChatState.IDLE);
    });

    it('otra cosa: vuelve a mostrar las opciones sin perder el paso', async () => {
      await say('quizás');
      expect(lastSent()).toContain('*A*, *B*, *C* o *D*');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Lo que NO es una consulta
  // ──────────────────────────────────────────────────────────────────
  describe('lo que no es una consulta', () => {
    beforeEach(() => {
      seedPaciente();
      seedCita('apt-1', MANANA);
    });

    it('«quiero cancelar mis citas» va a cancelación', async () => {
      await say('quiero cancelar mis citas');
      expect(state()).not.toBe(ChatState.AWAITING_LOOKUP_CHOICE);
      expect(pasos()).toHaveLength(0);
    });

    it('«quiero consultar con un médico» NO es consultar sus citas (lo decide el LLM)', async () => {
      await say('quiero consultar con un médico');
      expect(provider.extractSchedulingIntent).toHaveBeenCalled();
      expect(pasos()).toHaveLength(0);
    });

    it('«no tengo cita, quiero una» no abre la consulta (lo decide el LLM)', async () => {
      await say('no tengo cita, quiero una');
      expect(provider.extractSchedulingIntent).toHaveBeenCalled();
      expect(pasos()).toHaveLength(0);
    });

    it('a mitad del agendamiento (eligiendo horario) no se le tira el flujo', async () => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_DATE,
      );
      await say('mis citas');
      expect(pasos()).toHaveLength(0);
    });

    it('una paráfrasis que solo el LLM reconoce (isLookup) también abre la consulta', async () => {
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'agendar_cita', isLookup: true }),
      );
      await say('me recuerda para qué día me dieron la consulta?');
      expect(lastSent()).toContain('Citas de *Juan Pérez*');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Fase B: el bot le pregunta al HIS (docs/PLAN_CONSULTA_CITAS.md)
  // ──────────────────────────────────────────────────────────────────
  describe('Fase B — consulta al HIS en vivo', () => {
    const MED_AGENIA = 'doc-Dr apt-1';
    // Horas NO redondas en AgenIA: el HIS guarda minutos.
    const MANANA_CON_SEGUNDOS = new Date(MANANA.getTime() + 27_412);
    const EN_5_DIAS = '2026-10-07T19:30:00.000Z';

    const viva = (modo: 'OFF' | 'SHADOW' | 'ON') => ({
      enabled: true,
      lookupEnabled: false, // el del personal: no importa para el bot
      botLookupMode: modo,
      lastLookupCapable: true,
      lastHeartbeatAt: new Date(AHORA.getTime() - 60_000),
      lastHisReachable: true,
    });
    const filaHis = (over: Record<string, unknown> = {}) => ({
      doctorExternalKey: 'MED-HIS-1',
      startIso: MANANA.toISOString(),
      serviceExternalKey: 'SRV-HIS-1',
      status: 'SCHEDULED',
      titular: 'PACIENTE',
      documentoTercero: null,
      ...over,
    });
    /** Lo que hace el agente: responde la petición (vía MirrorLookupService). */
    const responde = (citas: unknown[], status = 'RESUELTA') => {
      const r = db.requests.at(-1);
      Object.assign(r, {
        status,
        result:
          status === 'RESUELTA'
            ? {
                kind: 'BY_DOCUMENT',
                desdeIso: r.params.fromIso,
                hastaIso: r.params.toIso,
                citas,
                truncado: false,
              }
            : null,
      });
    };
    const barrido = () => service.atenderSeguimientosHis();
    const resultados = () =>
      interactionLog.logSuccess.mock.calls
        .map((c: any[]) => c[0])
        .filter((e: any) => e?.metadata?.step === 'HIS_LOOKUP_RESULT');

    beforeEach(() => {
      seedPaciente();
      // La cita de AgenIA de mañana es la MISMA que el HIS tiene (médico homologado).
      db.slots.push({
        ...slotRow('slot-apt-1', MANANA_CON_SEGUNDOS, 'Dr apt-1', SVC_MEDICINA),
      });
      db.appointments.push({
        id: 'apt-1',
        patientId: 'pat-1',
        scheduleSlotId: 'slot-apt-1',
        status: 'SCHEDULED',
        organizationId: ORG_ID,
      });
      db.maps.push(
        {
          organizationId: ORG_ID,
          entityType: 'DOCTOR',
          agenIAId: MED_AGENIA,
          externalKey: 'MED-HIS-1',
          externalLabel: 'MEDICO UNO',
        },
        {
          organizationId: ORG_ID,
          entityType: 'DOCTOR',
          agenIAId: 'doc-ana',
          externalKey: 'MED-HIS-2',
          externalLabel: 'ANA GOMEZ (HIS)',
        },
        {
          organizationId: ORG_ID,
          entityType: 'SERVICE',
          agenIAId: SVC_ODONTO.id,
          externalKey: 'SRV-HIS-2',
          externalLabel: null,
        },
      );
      db.doctors.push({
        id: 'doc-ana',
        fullName: 'Ana Gómez',
        isFunctionalAgenda: false,
      });
    });

    it('ON + conexión viva: responde ya con AgenIA, encola la consulta y promete escribir solo si hay algo más', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');

      const r = lastSent();
      expect(r).toContain('Citas de *Juan Pérez*');
      expect(r).toContain('Estoy confirmando con el hospital');
      expect(r).not.toContain('directamente en el hospital');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);

      expect(db.requests).toHaveLength(1);
      const req = db.requests[0];
      expect(req).toMatchObject({
        origin: 'BOT',
        requestedByUserId: 'chatbot',
        kind: 'BY_DOCUMENT',
        patientId: 'pat-1',
      });
      expect(req.params.patientDocuments).toEqual([CEDULA]);
      // Hoy a medianoche (Bogotá) → 60 días.
      expect(req.params.fromIso).toBe('2026-10-02T05:00:00.000Z');
      // El remitente vive en Redis, no en la base.
      expect(JSON.stringify(req)).not.toContain(SENDER);
      expect(redis.store.get(`bot_his_req:${req.id}`)).toBe(SENDER);
    });

    it('el segundo mensaje trae SOLO lo nuevo del paciente, con nombres; nunca lo de un tercero', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      const antes = sent().length;

      responde([
        filaHis(), // la misma de AgenIA (misma hora al minuto, médico homologado)
        filaHis({
          doctorExternalKey: 'MED-HIS-2',
          serviceExternalKey: 'SRV-HIS-2',
          startIso: EN_5_DIAS,
        }),
        filaHis({
          titular: 'OTRO',
          documentoTercero: '•••9999',
          startIso: '2026-10-08T15:00:00.000Z',
        }),
      ]);
      await barrido();

      expect(sent()).toHaveLength(antes + 1);
      const r = lastSent();
      expect(r).toContain('El hospital tiene estas citas a su nombre');
      expect(r).toContain('Odontología · Dr(a). Ana Gómez');
      expect(r).not.toContain('MED-HIS');
      expect(r).not.toContain('9999');
      expect(r.match(/^• /gm)).toHaveLength(1);
      expect(resultados()[0].metadata).toMatchObject({
        modoBotHis: 'ON',
        status: 'RESUELTA',
        citasHis: 2,
        nuevas: 1,
        enviado: true,
      });
    });

    it('D6: si el hospital no trae nada nuevo, silencio (pero se registra)', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      const antes = sent().length;
      responde([filaHis()]);
      await barrido();
      expect(sent()).toHaveLength(antes);
      expect(resultados()[0].metadata).toMatchObject({
        nuevas: 0,
        enviado: false,
      });
    });

    it('si el hospital no contesta a tiempo, se le dice (se le había prometido escribir)', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      responde([], 'EXPIRADA');
      await barrido();
      expect(lastSent()).toContain('No pude confirmar con el hospital');
      expect(lastSent()).toContain(SOPORTE);
    });

    it('si el paciente ya cambió de tema, no se le interrumpe', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      await say('C'); // agendar una nueva → menú de servicios
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);
      const antes = sent().length;
      responde([filaHis({ startIso: EN_5_DIAS })]);
      await barrido();
      expect(sent()).toHaveLength(antes);
      expect(resultados()[0].metadata.enviado).toBe(false);
    });

    it('dos réplicas barriendo a la vez: un solo mensaje', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      responde([filaHis({ startIso: EN_5_DIAS })]);
      const antes = sent().length;
      await Promise.all([barrido(), barrido()]);
      await barrido();
      expect(sent()).toHaveLength(antes + 1);
    });

    it('SHADOW: el paciente ve exactamente la Fase A; la consulta solo mide (D8)', async () => {
      db.mirror = viva('SHADOW');
      await say('que citas tengo');
      expect(lastSent()).toContain('directamente en el hospital');
      expect(lastSent()).not.toContain('Estoy confirmando');
      expect(db.requests).toHaveLength(1);

      const antes = sent().length;
      responde([filaHis({ startIso: EN_5_DIAS })]);
      await barrido();
      expect(sent()).toHaveLength(antes);
      expect(resultados()[0].metadata).toMatchObject({
        modoBotHis: 'SHADOW',
        nuevas: 1,
        enviado: false,
      });
    });

    it('preguntar otra vez enseguida reutiliza el resultado: no vuelve a cargar el hospital', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      responde([
        filaHis({ startIso: EN_5_DIAS, doctorExternalKey: 'MED-HIS-2' }),
      ]);
      await barrido();

      await say('D');
      await say('que citas tengo');
      expect(db.requests).toHaveLength(1);
      expect(lastSent()).toContain('El hospital tiene estas citas a su nombre');
      expect(lastSent()).toContain('Ana Gómez');
      expect(lastSent()).not.toContain('Estoy confirmando');
    });

    it('con una consulta del paciente aún en curso no se encola otra; se advierte como en la Fase A', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      await say('D');
      await say('que citas tengo');
      expect(db.requests).toHaveLength(1);
      expect(lastSent()).toContain('directamente en el hospital');
    });

    it('tope del bot por clínica: con 3 en curso no encola la cuarta', async () => {
      db.mirror = viva('ON');
      for (let i = 0; i < 3; i++) {
        db.requests.push({
          id: `otra-${i}`,
          organizationId: ORG_ID,
          origin: 'BOT',
          status: 'PENDIENTE',
          patientId: `otro-${i}`,
          createdAt: new Date(),
          botFollowupAt: null,
        });
      }
      await say('que citas tengo');
      expect(db.requests).toHaveLength(3);
      expect(lastSent()).toContain('directamente en el hospital');
    });

    it('las del personal no cuentan para el tope del bot', async () => {
      db.mirror = viva('ON');
      for (let i = 0; i < 5; i++) {
        db.requests.push({
          id: `staff-${i}`,
          organizationId: ORG_ID,
          origin: 'STAFF',
          status: 'PENDIENTE',
          createdAt: new Date(),
        });
      }
      await say('que citas tengo');
      expect(db.requests.filter((r) => r.origin === 'BOT')).toHaveLength(1);
    });

    it('conexión caída (agente sin latido reciente): no consulta y advierte', async () => {
      db.mirror = {
        ...viva('ON'),
        lastHeartbeatAt: new Date(AHORA.getTime() - 10 * 60_000),
      };
      await say('que citas tengo');
      expect(db.requests).toHaveLength(0);
      expect(lastSent()).toContain('directamente en el hospital');
      expect(pasos()[0].metadata).toMatchObject({
        conexionHis: 'CAIDA',
        accionHis: 'SIN_CONSULTA',
      });
    });

    it('🔒 a quien no es el paciente no se le consulta el hospital', async () => {
      db.mirror = viva('ON');
      db.patients[0].whatsappId = OTRO_NUMERO;
      await say('mis citas');
      await say(CEDULA);
      expect(lastSent()).toContain('hay citas próximas registradas');
      expect(db.requests).toHaveLength(0);
    });

    it('si apagan el bot mientras la consulta estaba en curso, no se le escribe', async () => {
      db.mirror = viva('ON');
      await say('que citas tengo');
      db.mirror.botLookupMode = 'OFF';
      const antes = sent().length;
      responde([filaHis({ startIso: EN_5_DIAS })]);
      await barrido();
      expect(sent()).toHaveLength(antes);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 🔒 Interruptor de operaciones apagado: solo consultas
  // ──────────────────────────────────────────────────────────────────
  describe('🔒 operaciones apagadas (solo consultas)', () => {
    const AVISO = 'no está activa para agendar, cancelar ni cambiar citas';
    const HOSPITAL = `el hospital al *${SOPORTE}*`;

    beforeEach(() => {
      bookingEnabled = false;
    });

    it('«Hola» se presenta con el aviso y no abre el menú de servicios', async () => {
      await say('Hola');
      const r = lastSent();
      expect(r).toContain('Le saluda *Vicente*');
      expect(r).toContain(AVISO);
      expect(r).toContain(HOSPITAL);
      expect(r).toContain('*"consultar"*');
      expect(r).not.toContain('¿En qué servicio');
      expect(state()).toBe(ChatState.IDLE);
    });

    it('el segundo aviso de la conversación ya no se presenta (y va la versión corta)', async () => {
      await say('Hola');
      await say('Hola');
      expect(lastSent()).toContain('Como le comenté');
      expect(lastSent()).toContain('consultar');
      expect(lastSent()).not.toContain('Le saluda');
    });

    it('pedir una cita recibe el aviso, sin ACK ni menú', async () => {
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'agendar_cita', especialidad: 'Odontología' }),
      );
      await say('Quiero una cita de odontología');
      expect(sent()).toHaveLength(1);
      expect(lastSent()).toContain(AVISO);
      expect(state()).toBe(ChatState.IDLE);
    });

    it('«cancelar cita» recibe el aviso y no pide la cédula', async () => {
      seedPaciente();
      // Dos citas y ningún recordatorio: no hay UNA cita a la que atar el aviso
      // para el personal (eso lo prueba «💬 respuestas al bot»).
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);
      await say('cancelar cita');
      expect(lastSent()).toContain(AVISO);
      expect(state()).toBe(ChatState.IDLE);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('cambiar la fecha (por el LLM) recibe el aviso', async () => {
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'modificar_cita', isModification: true }),
      );
      await say('necesito mover mi cita para otro día');
      expect(lastSent()).toContain(AVISO);
      expect(state()).toBe(ChatState.IDLE);
    });

    it('«consultar» muestra sus citas sin las opciones A-D y remite al hospital', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('consultar');
      const r = lastSent();
      expect(r).toContain('Citas de *Juan Pérez*');
      expect(r).toContain('Medicina General');
      expect(r).not.toContain('*A)* Cancelar una cita');
      expect(r).toContain(`comuníquese con ${HOSPITAL}`);
      expect(r).toContain('solo permite consultarlas');
      expect(state()).toBe(ChatState.IDLE);
    });

    it('sin citas no invita a agendar escribiendo «Hola»', async () => {
      seedPaciente();
      await say('que citas tengo');
      const r = lastSent();
      expect(r).toContain('no tiene citas próximas');
      expect(r).not.toContain('"Hola"');
      expect(r).toContain(HOSPITAL);
    });

    it('apagarlo a mitad de un agendamiento descarta el flujo: la letra recibe el aviso', async () => {
      bookingEnabled = true;
      await say('Hola');
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);

      bookingEnabled = false;
      await say('A');
      expect(lastSent()).toContain(AVISO);
      expect(state()).toBe(ChatState.IDLE);
    });

    it('apagarlo a mitad de un agendamiento no impide consultar', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      bookingEnabled = true;
      await say('Hola');

      bookingEnabled = false;
      await say('mis citas');
      expect(lastSent()).toContain('Citas de *Juan Pérez*');
      expect(lastSent()).not.toContain('*A)* Cancelar una cita');
    });

    it('las opciones A-D mostradas antes de apagarlo ya no cancelan', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      bookingEnabled = true;
      await say('mis citas');
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);

      bookingEnabled = false;
      await say('A');
      expect(lastSent()).toContain(AVISO);
      expect(state()).toBe(ChatState.IDLE);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('la baja de recordatorios sigue funcionando (no es una operación sobre la cita)', async () => {
      seedPaciente();
      await say('no quiero mas recordatorios');
      expect(lastSent()).toContain('recordatorios');
      expect(lastSent()).toContain('activar recordatorios');
      expect(lastSent()).not.toContain(AVISO);
    });

    it('queda en la bitácora por qué se respondió el aviso', async () => {
      await say('cancelar cita');
      const pasoAviso = interactionLog.logSuccess.mock.calls
        .map((c: any[]) => c[0])
        .find((e: any) => e?.metadata?.step === 'SOLO_CONSULTAS');
      expect(pasoAviso?.metadata).toMatchObject({ motivo: 'CANCELAR' });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 🔒 Un interruptor por operación: agendar, cancelar, cambiar la fecha
  // ──────────────────────────────────────────────────────────────────
  describe('🔒 interruptores por operación', () => {
    const SOLO_CONSULTAS =
      'no está activa para agendar, cancelar ni cambiar citas';
    const HOSPITAL = `el hospital al *${SOPORTE}*`;

    it('cancelar apagado: «cancelar cita» recibe su aviso y dice qué sí se puede', async () => {
      cancelEnabled = false;
      seedPaciente();
      // Dos citas sin recordatorio: no se adivina de cuál avisa (ver abajo con una).
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);
      await say('cancelar cita');
      const r = lastSent();
      expect(r).toContain('no es posible *cancelar citas*');
      expect(r).toContain(
        `Para cancelar una cita, por favor comuníquese con ${HOSPITAL}`,
      );
      expect(r).toContain(
        'Cambiar la fecha de una cita: escríbame *"cambiar cita"*',
      );
      expect(r).toContain('Agendar una cita: escríbame *"Hola"*');
      expect(r).toContain('Consultar sus citas: escríbame *"consultar"*');
      expect(r).not.toContain('Cancelar una cita:');
      expect(r).not.toContain(SOLO_CONSULTAS);
      expect(state()).toBe(ChatState.IDLE);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('cambiar apagado: «cambiar cita» recibe su aviso, cancelar se sigue ofreciendo', async () => {
      rescheduleEnabled = false;
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);
      await say('cambiar cita');
      const r = lastSent();
      expect(r).toContain('no es posible *cambiar la fecha de una cita*');
      expect(r).toContain('Cancelar una cita: escríbame *"cancelar cita"*');
      expect(r).not.toContain('Cambiar la fecha de una cita:');
      expect(state()).toBe(ChatState.IDLE);
    });

    it('📝 cancelar apagado con UNA cita: «cancelar cita» deja el aviso al personal y ofrece lo que sí se puede', async () => {
      cancelEnabled = false;
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('cancelar cita');
      const r = lastSent();
      expect(r).toContain('Dejé registrado su aviso de que no podrá asistir');
      expect(r).toContain('Por aquí también puedo ayudarle a:');
      expect(r).toContain(
        'Cambiar la fecha de una cita: escríbame *"cambiar cita"*',
      );
      expect(r).not.toContain('Cancelar una cita:');
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'AVISO_INASISTENCIA',
        appointmentId: 'apt-1',
        meta: { pide: 'CANCELAR' },
      });
      expect(state()).not.toBe(ChatState.AWAITING_LOOKUP_CEDULA);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('agendar apagado: «Hola» no abre el menú y dice que cancelar y cambiar sí se pueden', async () => {
      bookingEnabled = false;
      cancelEnabled = true;
      rescheduleEnabled = true;
      await say('Hola');
      const r = lastSent();
      expect(r).toContain('Le saluda *Vicente*');
      expect(r).toContain('no es posible *agendar citas*');
      expect(r).toContain('Cancelar una cita: escríbame *"cancelar cita"*');
      expect(r).not.toContain('¿En qué servicio');
      expect(r).not.toContain(SOLO_CONSULTAS);
      expect(state()).toBe(ChatState.IDLE);
    });

    it('agendar apagado no impide cancelar: «cancelar cita» abre la cancelación', async () => {
      bookingEnabled = false;
      cancelEnabled = true;
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('cancelar cita');
      expect(lastSent()).not.toContain('no es posible');
      expect(state()).toMatch(/^AWAITING_CANCEL_/);
    });

    it('la consulta ofrece solo lo que se puede, con letras seguidas, y dice dónde hacer lo demás', async () => {
      cancelEnabled = false;
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('consultar');
      const r = lastSent();
      expect(r).toContain(
        '*A)* Cambiar la fecha de una cita\n*B)* Agendar una cita nueva\n*C)* Nada más, gracias',
      );
      expect(r).not.toContain('Cancelar una cita');
      expect(r).toContain(
        `Para cancelar una cita, comuníquese con ${HOSPITAL}.`,
      );
      expect(state()).toBe(ChatState.AWAITING_LOOKUP_CHOICE);
    });

    it('la letra se lee contra las opciones mostradas: «A» es cambiar la fecha, no cancelar', async () => {
      cancelEnabled = false;
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('consultar');
      await say('A');
      // Sin cupos para mover y sin poder cancelar por el bot: la cita se queda.
      const r = lastSent();
      expect(r).toContain('así que la conservo tal como está');
      expect(r).toContain(
        `Si necesita cancelarla, por favor comuníquese con ${HOSPITAL}`,
      );
      expect(r).not.toContain('¿Desea que *cancele la cita actual*?');
      expect(state()).toBe(ChatState.IDLE);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('«C» con tres opciones es «nada más»; una letra fuera de rango pide solo las mostradas', async () => {
      cancelEnabled = false;
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('consultar');
      await say('D');
      expect(lastSent()).toContain(
        'Por favor responda con la letra *A*, *B* o *C*.',
      );
      await say('C');
      expect(state()).toBe(ChatState.IDLE);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('apagar cancelar con las opciones ya mostradas: la «A» de antes recibe el aviso', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('consultar');
      expect(lastSent()).toContain('*A)* Cancelar una cita');

      cancelEnabled = false;
      await say('A');
      expect(lastSent()).toContain('no es posible *cancelar citas*');
      expect(state()).toBe(ChatState.IDLE);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('apagar cancelar a mitad de una cancelación descarta el flujo: la cita no se toca', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('cancelar cita');
      expect(state()).toMatch(/^AWAITING_CANCEL_/);

      cancelEnabled = false;
      await say('SÍ');
      expect(state()).not.toMatch(/^AWAITING_CANCEL_/);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('sin citas y sin agendar por el bot: remite al hospital para agendar, sin decir «solo consultas»', async () => {
      bookingEnabled = false;
      cancelEnabled = true;
      seedPaciente();
      await say('que citas tengo');
      const r = lastSent();
      expect(r).toContain('no tiene citas próximas');
      expect(r).toContain(`Para agendar una cita, comuníquese con ${HOSPITAL}`);
      expect(r).not.toContain('solo permite consultarlas');
      expect(r).not.toContain('"Hola"');
    });

    it('con las tres prendidas, las opciones son las A-D de siempre', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('consultar');
      expect(lastSent()).toContain(
        '*A)* Cancelar una cita\n*B)* Cambiar la fecha de una cita\n*C)* Agendar una cita nueva\n*D)* Nada más, gracias',
      );
      expect(lastSent()).not.toContain('comuníquese con');
    });

    it('queda en la bitácora qué operación se pidió y qué se ofreció en su lugar', async () => {
      cancelEnabled = false;
      await say('cancelar cita');
      const paso = interactionLog.logSuccess.mock.calls
        .map((c: any[]) => c[0])
        .find((e: any) => e?.metadata?.step === 'OPERACION_NO_DISPONIBLE');
      expect(paso?.metadata).toMatchObject({
        motivo: 'CANCELAR',
        disponibles: ['AGENDAR', 'MODIFICAR'],
      });
    });
  });
  // ──────────────────────────────────────────────────────────────────
  // 💬 Respuestas a un recordatorio y «¿de dónde me hablan?» (2026-10-13)
  // ──────────────────────────────────────────────────────────────────
  describe('💬 respuestas al bot tras un recordatorio', () => {
    const HACE_2H = new Date(AHORA.getTime() - 2 * 3_600_000);
    const conRecordatorio = () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      db.appointments[0].reminderSentAt = HACE_2H;
    };
    const paso = (step: string) =>
      interactionLog.logSuccess.mock.calls
        .map((c: any[]) => c[0])
        .find((e: any) => e?.metadata?.step === step);

    beforeEach(() => {
      // Como en producción la noche del primer lote: operaciones apagadas.
      bookingEnabled = false;
    });

    it.each([
      'Si dios quiere mañana boy ala cita',
      'Ok muchas gracias',
      'Bueno',
    ])(
      '«%s» tras el recordatorio → «¡Gracias por confirmar!» con su fecha, no el aviso de solo consultas',
      async (texto) => {
        conRecordatorio();
        await say(texto);
        const r = lastSent();
        expect(r).toContain('¡Gracias por confirmar!');
        expect(r).toContain('Le esperamos el *');
        expect(r).toContain('Medicina General');
        expect(r).not.toContain('no está activa');
        // No abre ningún flujo: la sesión sigue en reposo (sin estado = IDLE).
        expect([null, ChatState.IDLE]).toContain(state());
        expect(paso('RECORDATORIO_CONFIRMADO')?.metadata).toMatchObject({
          appointmentId: 'apt-1',
        });
        expect(db.appointments[0].status).toBe('SCHEDULED');
      },
    );

    it('🎙️ la confirmación por NOTA DE VOZ también se entiende (no «no es posible agendar»)', async () => {
      // Caso real 2026-10-15 18:10: «Confirmo mi asistencia a la cita de mañana»
      // dicho en un audio recibía el aviso de que agendar está apagado.
      conRecordatorio();
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 't', phoneNumberId: PHONE_ID });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('ogg'));
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({
          transcript:
            'Buenos días, muchas gracias por el recordatorio. Confirmo mi asistencia a la cita de mañana. Allí estaré, muchas gracias',
          intent: 'agendar_cita',
        }),
      );
      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'media-1' },
        metadata: { phone_number_id: PHONE_ID },
      });
      const r = lastSent();
      expect(r).toContain('¡Gracias por confirmar!');
      expect(r).not.toContain('no es posible');
      expect(paso('RECORDATORIO_CONFIRMADO')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
    });

    it('«muchas gracias» SIN recordatorio reciente sigue siendo una despedida', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA); // sin reminderSentAt
      await say('Muchas gracias');
      expect(lastSent()).not.toContain('Gracias por confirmar');
    });

    it('un recordatorio de hace más de 48 h ya no da contexto', async () => {
      conRecordatorio();
      db.appointments[0].reminderSentAt = new Date(
        AHORA.getTime() - 50 * 3_600_000,
      );
      await say('Ok muchas gracias');
      expect(lastSent()).not.toContain('Gracias por confirmar');
    });

    it('🛡️ el recordatorio de OTRO paciente no le da contexto a quien escribe', async () => {
      conRecordatorio();
      await say('Ok muchas gracias', '573009998877');
      expect(lastSent()).not.toContain('Gracias por confirmar');
    });

    it('🛡️ «no voy a poder ir» tras el recordatorio nunca se toma por confirmación', async () => {
      conRecordatorio();
      await say('Esque no voy a poder ir ala cita mañana');
      expect(lastSent()).not.toContain('Gracias por confirmar');
    });

    it('«De donde me ablan» tras el recordatorio → quién escribe y por cuál cita', async () => {
      conRecordatorio();
      await say('De donde me ablan');
      const r = lastSent();
      expect(r).toContain(
        'Le escribe *Vicente*, asistente virtual de *Hospital San Vicente*',
      );
      expect(r).toContain('por su cita de *Medicina General* del *');
      expect(r).not.toContain('no está activa');
      expect(paso('QUIEN_ESCRIBE')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
    });

    it('«¿De dónde me hablan?» sin recordatorio → quién escribe y cómo ver sus citas', async () => {
      await say('¿De dónde me hablan?');
      const r = lastSent();
      expect(r).toContain(
        'Le escribe *Vicente*, asistente virtual de *Hospital San Vicente*',
      );
      expect(r).toContain('*"consultar"*');
      expect(r).not.toContain('por su cita');
    });

    // ── 2026-10-15: lo que escribieron los pacientes los dos primeros días ──

    it.each([
      '👍',
      'Dios lebendiga',
      'Claro que sí, si Dios quiere, sí, claro, cuente con la asistencia de mi mamá a la cita del jueves, muchas gracias por avisarnos',
    ])(
      '«%s» tras el recordatorio también es una confirmación',
      async (texto) => {
        conRecordatorio();
        await say(texto);
        expect(lastSent()).toContain('¡Gracias por confirmar!');
      },
    );

    it('«esa cita es en q lugar» (sin «?») → cuándo y dónde es su cita, no «gracias por confirmar»', async () => {
      conRecordatorio();
      await say('Buenas tardes,esa cita es en q lugar Muchas gracias');
      const r = lastSent();
      expect(r).not.toContain('Gracias por confirmar');
      expect(r).toContain('Su cita de *Medicina General* es el *');
      expect(r).toContain('en *Hospital San Vicente*');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
      expect(paso('PREGUNTA_SOBRE_CITA')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
    });

    it('📝 «no puedo asistir» con cancelar apagado → el aviso queda en la bandeja del personal y la cita NO se toca', async () => {
      conRecordatorio();
      await say('Buen día ,no puedo asistir');
      const r = lastSent();
      expect(r).toContain('Dejé registrado su aviso de que no podrá asistir');
      expect(r).toContain('*Medicina General*');
      expect(r).toContain('por ahora sigue registrada');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
      expect(r).not.toContain('Gracias por confirmar');

      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      const [org, entrada] = avisos.registrar.mock.calls[0] as any[];
      expect(org).toBe(ORG_ID);
      expect(entrada).toMatchObject({
        kind: 'AVISO_INASISTENCIA',
        dedupeKey: 'inasistencia:apt-1',
        appointmentId: 'apt-1',
        patientId: 'pat-1',
        doctorId: 'doc-Dr apt-1',
        appointmentStartAt: MANANA,
        meta: { pide: 'CANCELAR', mensaje: 'Buen día ,no puedo asistir' },
      });
      // El título va sin datos personales.
      expect(entrada.title).not.toContain('Juan');
      // AgenIA no cancela nada: la cita sigue igual.
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(paso('AVISO_INASISTENCIA_REGISTRADO')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
    });

    it('📝 con DOS citas recordadas, «cancelar las citas» deja un aviso por CADA cita y se las nombra', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date(MANANA.getTime() + 60 * 60_000), SVC_ODONTO);
      for (const a of db.appointments) a.reminderSentAt = HACE_2H;

      await say(
        'Muy buena tarde, me veo en la necesidad de cancelar las citas por problemas de salud',
      );

      expect(avisos.registrar).toHaveBeenCalledTimes(2);
      const ids = avisos.registrar.mock.calls.map(
        (c: any[]) => c[1].appointmentId,
      );
      expect(ids).toEqual(['apt-1', 'apt-2']);
      expect(avisos.registrar.mock.calls[1][1]).toMatchObject({
        dedupeKey: 'inasistencia:apt-2',
        meta: { pide: 'CANCELAR', citasDelAviso: 2 },
      });
      const r = lastSent();
      expect(r).toContain('no podrá asistir a estas citas');
      expect(r).toContain('• *Medicina General* —');
      expect(r).toContain('• *Odontología* —');
      expect(paso('AVISO_INASISTENCIA_REGISTRADO')?.metadata).toMatchObject({
        appointmentIds: ['apt-1', 'apt-2'],
      });
    });

    it('con DOS citas recordadas, «gracias» confirma las dos', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date(MANANA.getTime() + 60 * 60_000), SVC_ODONTO);
      for (const a of db.appointments) a.reminderSentAt = HACE_2H;
      await say('Ok muchas gracias');
      const r = lastSent();
      expect(r).toContain('Le esperamos en sus citas');
      expect(r).toContain('Medicina General');
      expect(r).toContain('Odontología');
    });

    it('«este mensaje que me mandaron es para una cita, para quién o qué» → quién escribe y por cuál cita', async () => {
      conRecordatorio();
      await say(
        'Buenas tardes, este mensaje que me mandaron es para una cita, para quién o qué, o cómo, cómo es',
      );
      const r = lastSent();
      expect(r).toContain('Le escribe *Vicente*');
      expect(r).toContain('por su cita de *Medicina General* del *');
      expect(r).not.toContain('no está activa');
    });

    it('🤖 la contestadora de un negocio no recibe respuesta y abre el caso del teléfono (con espejo)', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say(
        'Gracias por comunicarte al restaurante Donde jacky. ¿Cómo podemos ayudarte?🥰',
      );
      expect(sent()).toHaveLength(0);
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'TELEFONO_EQUIVOCADO',
        patientId: 'pat-1',
        appointmentId: 'apt-1',
        meta: { motivo: 'RESPUESTA_AUTOMATICA' },
      });
      expect(paso('RESPUESTA_AUTOMATICA')).toBeDefined();
    });

    it('🤖 «Soy Theo Tattoo… te daré respuesta tan pronto como sea posible»: sin respuesta y caso del teléfono', async () => {
      // Caso real 2026-10-17: el bot le contestó «solo puedo ayudarle con sus citas».
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say(
        'Hola! Soy Theo Tattoo, gracias por tu mensaje. Te daré respuesta tan pronto como sea posible. Gracias por tu paciencia.',
      );
      expect(sent()).toHaveLength(0);
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'TELEFONO_EQUIVOCADO',
        meta: { motivo: 'RESPUESTA_AUTOMATICA' },
      });
    });

    it('🤖 una contestadora de un número sin paciente tampoco recibe respuesta, y no toca a nadie', async () => {
      conRecordatorio();
      await say(
        'Gracias por escribirnos, te responderemos lo más pronto posible.',
        '573009998877',
      );
      expect(sent()).toHaveLength(0);
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(db.patients[0].remindersOptOut).toBeUndefined();
    });

    it('📝 «necesito reagendar» sin recordatorio, con UNA cita próxima → solicitud de cambio en la bandeja', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA); // sin reminderSentAt
      await say('necesito reagendar una cita');
      expect(lastSent()).toContain('Dejé registrada su solicitud de cambiar');
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'AVISO_INASISTENCIA',
        appointmentId: 'apt-1',
        meta: { pide: 'MODIFICAR' },
      });
    });

    it('🛡️ con dos citas próximas y sin recordatorio no adivina cuál: no registra nada', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);
      await say('Buen día ,no puedo asistir');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(lastSent()).not.toContain('Dejé registrado');
    });

    it('🛡️ con cancelar ENCENDIDO el bot no deja el aviso: le ofrece cancelar él', async () => {
      cancelEnabled = true;
      conRecordatorio();
      await say('Buen día ,no puedo asistir');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(lastSent()).not.toContain('Dejé registrado');
      expect(lastSent()).toContain('¿Desea que la *cancele*?');
    });

    it('☎️ «está equivocado de número» con espejo → caso en la bandeja (que frena los recordatorios), sin marcar al paciente', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say('Vicentico está equivocado de número');
      const r = lastSent();
      expect(r).toContain('Disculpe la molestia');
      expect(r).toContain('no le enviaremos más recordatorios a este número');
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      const entrada = avisos.registrar.mock.calls[0][1];
      expect(entrada).toMatchObject({
        kind: 'TELEFONO_EQUIVOCADO',
        dedupeKey: 'telefono:pat-1',
        patientId: 'pat-1',
        appointmentId: 'apt-1',
        doctorId: 'doc-Dr apt-1',
        meta: { mensaje: 'Vicentico está equivocado de número' },
      });
      // Sin hora de cita: el número sigue mal aunque la cita pase.
      expect(entrada.appointmentStartAt).toBeUndefined();
      // El caso abierto es lo que frena el recordatorio: el paciente no queda
      // marcado (cerrar el caso los devuelve) y AgenIA no le borra el número.
      expect(db.patients[0].remindersOptOut).toBeUndefined();
      expect(db.patients[0].whatsappId).toBe(SENDER);
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(paso('NUMERO_EQUIVOCADO')?.metadata).toMatchObject({
        perfilesAfectados: 1,
        casosEnBandeja: 1,
        bajasDeRecordatorios: 0,
      });
    });

    it('☎️ «hola yo no soy juan» tras el recordatorio a Juan → número equivocado (caso en la bandeja)', async () => {
      // Caso real 2026-10-17 16:06: «hola yo no soy dario» recibió «por aquí solo
      // puedo ayudarle con sus citas».
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say('hola yo no soy juan');
      expect(lastSent()).toContain('Disculpe la molestia');
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'TELEFONO_EQUIVOCADO',
        patientId: 'pat-1',
        meta: { mensaje: 'hola yo no soy juan' },
      });
      expect(paso('NUMERO_EQUIVOCADO')).toBeDefined();
    });

    it('☎️ «no soy Pedro» cuando el recordatorio fue a Juan → no se toca nada (el nombre no es el del paciente)', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say('no soy Pedro');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(lastSent()).not.toContain('Disculpe la molestia');
    });

    it('☎️ «no soy Juan, soy la hija» → es la familia: no es número equivocado', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say('no soy Juan, soy la hija');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(lastSent()).not.toContain('Disculpe la molestia');
    });

    it('🕐 «en ventanilla me dijeron que a las 5:50» tras el recordatorio → la hora registrada, no «no es posible agendar»', async () => {
      // Caso real 2026-10-20 07:19: la IA lo tomó por querer agendar.
      conRecordatorio();
      await say('Hola, es que en ventanilla me dijeron que a las 5:50 pl');
      const r = lastSent();
      expect(r).toContain('En el sistema del hospital, su cita de');
      expect(r).toContain('está registrada para el');
      expect(r).toContain('confírmela con');
      expect(r).not.toContain('no es posible');
      expect(paso('OTRA_HORA')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
      // No abre ninguna conversación: queda en reposo.
      expect(state()).toBeNull();
    });

    it('🕐 sin recordatorio, con una cita próxima → la de esa cita', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA); // sin reminderSentAt
      await say('Me dieron la cita para las 3 de la tarde');
      expect(lastSent()).toContain('está registrada para el');
      expect(paso('OTRA_HORA')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
    });

    it('🕐 sin citas → que la confirme con el hospital (no se inventa nada)', async () => {
      seedPaciente();
      await say('Me dieron la cita para las 3 de la tarde');
      expect(lastSent()).toContain(
        'Por este medio no puedo confirmarle esa hora',
      );
      expect(paso('OTRA_HORA')?.metadata).toMatchObject({
        appointmentId: null,
      });
    });

    it.each(['Que pena esta equivocada', 'Este mensaje no era para mi'])(
      '📭 «%s» tras el recordatorio → número equivocado (caso en la bandeja)',
      async (texto) => {
        // Caso real 2026-10-19: el recordatorio de una paciente le llegó a otra
        // persona, que contestó estas dos frases y recibió las respuestas de siempre.
        db.mirror = { enabled: true, pushEnabled: true };
        conRecordatorio();
        await say(texto);
        expect(lastSent()).toContain('Disculpe la molestia');
        expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
          kind: 'TELEFONO_EQUIVOCADO',
          patientId: 'pat-1',
          appointmentId: 'apt-1',
          meta: { mensaje: texto },
        });
        expect(paso('NUMERO_EQUIVOCADO')).toBeDefined();
      },
    );

    it('📭 la conversación real de …2705, tal cual: «Hola buenos dias», «Que pena esta equivocada», «Este mensaje no era para mi»', async () => {
      // 2026-10-18 10:44, 22 h después del recordatorio, con agendar apagado y
      // cancelar y cambiar encendidos (como hoy en producción). Ese día el saludo
      // recibió «no es posible agendar» y las otras dos «comencemos de nuevo».
      db.mirror = { enabled: true, pushEnabled: false };
      cancelEnabled = true;
      rescheduleEnabled = true;
      seedPaciente();
      seedCita('apt-1', MANANA);
      db.appointments[0].reminderSentAt = new Date(
        AHORA.getTime() - 22 * 3_600_000,
      );

      await say('Hola buenos dias');
      // De qué cita le escribimos y de quién, y que avise si no es suyo.
      const saludo = lastSent();
      expect(saludo).toContain(
        'Le escribimos para recordarle la cita de *Juan*',
      );
      expect(saludo).toContain('Si este número no es de *Juan*');
      expect(saludo).toContain('cambiar cita');
      expect(saludo).not.toContain('no es posible');
      expect(paso('SALUDO_TRAS_RECORDATORIO')?.metadata).toMatchObject({
        appointmentId: 'apt-1',
      });
      await say('Que pena esta equivocada');
      expect(lastSent()).toContain('Disculpe la molestia');
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'TELEFONO_EQUIVOCADO',
        patientId: 'pat-1',
        appointmentId: 'apt-1',
      });

      await say('Este mensaje no era para mi');
      expect(lastSent()).toContain('Disculpe la molestia');
      expect(sent().join('\n')).not.toContain('comencemos de nuevo');
    });

    it('👋 un saludo SIN recordatorio reciente sigue el camino de siempre', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA); // sin reminderSentAt
      await say('Hola buenos dias');
      expect(paso('SALUDO_TRAS_RECORDATORIO')).toBeUndefined();
      expect(lastSent()).not.toContain('Le escribimos para recordarle');
    });

    // ──────────────────────────────────────────────────────────────────
    // 👋 Con agendar ENCENDIDO (2026-10-22, primer día): el saludo tras el
    // recordatorio abría el menú de servicios y lo que seguía —«No es para mí»
    // (…4433), «la cita ya la tengo para mañana» (…7954)— recibía «esa opción no
    // se logró identificar».
    // ──────────────────────────────────────────────────────────────────
    describe('con agendar ENCENDIDO', () => {
      const pasos = (step: string) =>
        interactionLog.logSuccess.mock.calls
          .map((c: any[]) => c[0])
          .filter((e: any) => e?.metadata?.step === step);
      const enElMenu = (estado: ChatState) =>
        redis.store.set(`chat_state:${ORG_ID}:${SENDER}`, estado);

      beforeEach(() => {
        bookingEnabled = true;
      });

      it('👋 el primer saludo dice de qué cita le escribimos y ofrece agendar con «agendar»; el segundo abre lo de siempre', async () => {
        conRecordatorio();
        await say('Hola buenos dias');
        const saludo = lastSent();
        expect(saludo).toContain(
          'Le escribimos para recordarle la cita de *Juan*',
        );
        expect(saludo).toContain('Agendar una cita: escríbame *"agendar"*');
        expect(saludo).toContain('Si este número no es de *Juan*');
        expect(pasos('SALUDO_TRAS_RECORDATORIO')).toHaveLength(1);

        await say('Hola');
        // Ya sabe de su cita: no se le repite.
        expect(pasos('SALUDO_TRAS_RECORDATORIO')).toHaveLength(1);
      });

      it('👋 sin recordatorio reciente, el saludo sigue el camino de siempre', async () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        await say('Hola buenos dias');
        expect(pasos('SALUDO_TRAS_RECORDATORIO')).toHaveLength(0);
      });

      it.each([
        ChatState.AWAITING_SPECIALTY,
        ChatState.AWAITING_EPS,
        ChatState.AWAITING_DATE,
      ])(
        '📭 «No es para mi» en %s tras el recordatorio → número equivocado y el menú se cierra (…4433)',
        async (estado) => {
          // Con espejo, como en el hospital: el caso queda en la Bandeja.
          db.mirror = { enabled: true, pushEnabled: true };
          conRecordatorio();
          enElMenu(estado);
          await say('No es para mi');
          expect(lastSent()).toContain('Disculpe la molestia');
          expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
            kind: 'TELEFONO_EQUIVOCADO',
            patientId: 'pat-1',
            appointmentId: 'apt-1',
          });
          expect([null, ChatState.IDLE]).toContain(state());
        },
      );

      it.each([
        'la sita ya latengo para mañana',
        'una sita pero ya meladoeron',
        'grasias',
      ])(
        '🙏 «%s» en el menú de servicios tras el recordatorio → «¡Gracias por confirmar!» y el menú se cierra (…7954)',
        async (texto) => {
          conRecordatorio();
          enElMenu(ChatState.AWAITING_SPECIALTY);
          await say(texto);
          expect(lastSent()).toContain('¡Gracias por confirmar!');
          expect(lastSent()).toContain('Le esperamos el *');
          expect([null, ChatState.IDLE]).toContain(state());
          expect(
            redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`),
          ).toBeUndefined();
        },
      );

      it('🙏 «grasias» en reposo tras el recordatorio → «¡Gracias por confirmar!» (no el menú)', async () => {
        conRecordatorio();
        await say('grasias');
        expect(lastSent()).toContain('¡Gracias por confirmar!');
        expect(pasos('RECORDATORIO_CONFIRMADO')).toHaveLength(1);
      });

      it('en EPS u horario, solo «no es para mí» se toma del recordatorio: lo demás es su respuesta al paso', async () => {
        conRecordatorio();
        enElMenu(ChatState.AWAITING_EPS);
        await say('la sita ya latengo para mañana');
        expect(lastSent()).not.toContain('¡Gracias por confirmar!');
        expect(pasos('RECORDATORIO_CONFIRMADO')).toHaveLength(0);
      });

      it('sin recordatorio reciente, «No es para mi» en el menú no apaga los recordatorios de nadie', async () => {
        db.mirror = { enabled: true, pushEnabled: true };
        seedPaciente();
        seedCita('apt-1', MANANA); // sin reminderSentAt
        enElMenu(ChatState.AWAITING_SPECIALTY);
        await say('No es para mi');
        expect(avisos.registrar).not.toHaveBeenCalled();
        expect(sent().join('\n')).not.toContain('Disculpe la molestia');
      });
    });

    it('🙏 «con la ayuda de Dios… estoy atenta» tras el recordatorio → «¡Gracias por confirmar!», no «no es posible agendar»', async () => {
      // Caso real 2026-10-20 09:36.
      conRecordatorio();
      await say(
        'con la ayuda de Dios, muchísimas gracias por avisarme, yo estoy atenta, estoy atenta a eso, con la ayuda de Dios.',
      );
      expect(lastSent()).toContain('¡Gracias por confirmar!');
      expect(lastSent()).not.toContain('no es posible');
    });

    // ──────────────────────────────────────────────────────────────────
    // ☎️ Número marcado como de otra persona (2026-10-21, …0792): tras «Yo no soy
    // Deysi está equivocada» (la paciente es DEICY), su «Ok» recibió «¡Gracias por
    // confirmar!» con la cita de ella, y nada le impedía cancelársela.
    // ──────────────────────────────────────────────────────────────────
    describe('☎️ número marcado como de otra persona', () => {
      const casoAbierto = (patientId = 'pat-1') =>
        db.casos.push({
          kind: 'TELEFONO_EQUIVOCADO',
          status: 'ABIERTA',
          patientId,
        });

      beforeEach(() => {
        db.mirror = { enabled: true, pushEnabled: false };
        cancelEnabled = true;
        rescheduleEnabled = true;
      });

      it('la conversación real: «Yo no soy Deysi está equivocada», «Ok», «Cancelar cita»', async () => {
        conRecordatorio();
        db.patients[0].fullName = 'DEICY JHOANA TORO GUEVARA';

        await say('Yo no soy Deysi está equivocada');
        expect(lastSent()).toContain('Disculpe la molestia');
        expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
          kind: 'TELEFONO_EQUIVOCADO',
          patientId: 'pat-1',
        });

        await say('Ok');
        expect(lastSent()).toContain(
          'Ya quedó registrado que este número no es del paciente',
        );
        expect(sent().join('\n')).not.toContain('¡Gracias por confirmar!');

        await say('Cancelar cita');
        expect(lastSent()).toContain(
          'Ya quedó registrado que este número no es del paciente',
        );
        expect(paso('CANCELAR_OFRECIDO')).toBeUndefined();
        expect(db.appointments[0].status).toBe('SCHEDULED');
      });

      it('«hola yo no soy Deysi» con la paciente DEICY → número equivocado (el nombre suena igual)', async () => {
        conRecordatorio();
        db.patients[0].fullName = 'DEICY JHOANA TORO GUEVARA';
        await say('hola yo no soy Deysi');
        expect(lastSent()).toContain('Disculpe la molestia');
        expect(paso('NUMERO_EQUIVOCADO')).toBeDefined();
      });

      it('con el caso abierto, un saludo no recibe los datos de la cita', async () => {
        conRecordatorio();
        casoAbierto();
        await say('Buenas tardes');
        expect(lastSent()).toContain('Ya quedó registrado');
        expect(lastSent()).not.toContain('Le escribimos para recordarle');
        expect(paso('NUMERO_YA_MARCADO')).toBeDefined();
      });

      it('con el caso abierto, la cédula para cancelar no sirve desde ese número', async () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        casoAbierto();
        redis.store.set(
          `chat_state:${ORG_ID}:${SENDER}`,
          ChatState.AWAITING_CANCEL_CEDULA,
        );
        await say(CEDULA);
        expect(lastSent()).toContain('Ya quedó registrado');
        expect(state()).not.toBe(ChatState.AWAITING_CANCEL_CONFIRM);
        expect(db.appointments[0].status).toBe('SCHEDULED');
      });

      it('con el caso abierto, la cédula para cambiar la fecha tampoco sirve', async () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        casoAbierto();
        redis.store.set(
          `chat_state:${ORG_ID}:${SENDER}`,
          ChatState.AWAITING_MODIFY_CEDULA,
        );
        await say(CEDULA);
        expect(lastSent()).toContain('Ya quedó registrado');
        expect(db.appointments[0].scheduleSlotId).toBe('slot-apt-1');
      });

      it('si el caso se abre entre la oferta y el «Sí», no se cancela', async () => {
        conRecordatorio();
        await say('Buen día ,no puedo asistir');
        expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
        casoAbierto();
        await say('Sí');
        expect(lastSent()).toContain('Ya quedó registrado');
        expect(db.appointments[0].status).toBe('SCHEDULED');
      });

      it('la consulta de citas no le muestra el detalle', async () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        casoAbierto();
        await say('consultar');
        await say(CEDULA);
        expect(pasos().pop()?.metadata?.step).toBe('LOOKUP_MINIMAL');
        expect(lastSent()).not.toContain('Medicina General');
      });

      it('si el número es de la familia y solo una ficha quedó marcada, la otra se atiende como siempre (y solo la suya)', async () => {
        conRecordatorio(); // Juan, apt-1, recordada
        seedPaciente({
          id: 'pat-2',
          cedula: '22222222',
          fullName: 'Ana Pérez',
        });
        seedCita('apt-2', MANANA, SVC_MEDICINA, 'pat-2');
        db.appointments[1].reminderSentAt = new Date(
          AHORA.getTime() - 2 * 3_600_000,
        );
        casoAbierto('pat-1');
        await say('Ok');
        expect(lastSent()).toContain('¡Gracias por confirmar!');
        const confirmado = paso('RECORDATORIO_CONFIRMADO')?.metadata;
        expect(confirmado).toMatchObject({ appointmentId: 'apt-2' });
        // La cita de Juan (número marcado) no se confirma ni se nombra.
        expect(confirmado?.appointmentIds).toBeUndefined();
      });

      it('si el caso se abre antes del «Sí» del cambio de fecha, no se mueve', async () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        db.slots.push({
          ...slotRow('slot-nuevo', MANANA, 'Dr nuevo', SVC_MEDICINA),
          isAvailable: true,
        });
        const k = (n: string) => `${n}:${ORG_ID}:${SENDER}`;
        redis.store.set(k('temp_selected_modify_apt'), 'apt-1');
        redis.store.set(k('temp_selected_modify_slot'), 'slot-apt-1');
        redis.store.set(k('temp_selected_modify_newslot'), 'slot-nuevo');
        redis.store.set(k('temp_selected_modify_newslot_fecha'), '2026-10-03');
        redis.store.set(k('chat_state'), ChatState.AWAITING_MODIFY_CONFIRM);
        casoAbierto();
        await say('Sí');
        expect(lastSent()).toContain('Ya quedó registrado');
        expect(paso('NUMERO_YA_MARCADO')?.metadata).toMatchObject({
          flow: 'MODIFICAR',
          appointmentId: 'apt-1',
        });
        expect(db.appointments[0].scheduleSlotId).toBe('slot-apt-1');
      });
    });

    it('📭 sin recordatorio reciente, «Que pena esta equivocada» no toca nada (puede ser de otra conversación)', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      seedPaciente();
      seedCita('apt-1', MANANA); // sin reminderSentAt
      await say('Que pena esta equivocada');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(lastSent()).not.toContain('Disculpe la molestia');
      expect(db.patients[0].remindersOptOut).toBeUndefined();
    });

    it('📭 «Este mensaje no es para mí, es para mi mamá» → es la familia: no es número equivocado', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      conRecordatorio();
      await say('Este mensaje no es para mí, es para mi mamá');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(lastSent()).not.toContain('Disculpe la molestia');
    });

    it('☎️ sin espejo (no hay bandeja) → se apagan sus recordatorios como en la baja', async () => {
      conRecordatorio();
      await say('Vicentico está equivocado de número');
      expect(lastSent()).toContain(
        'no le enviaremos más recordatorios a este número',
      );
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(db.patients[0].remindersOptOut).toBe(true);
    });

    it('☎️ si el caso ya lo había cerrado una persona (IGNORADA), cae a la baja: la promesa se cumple igual', async () => {
      db.mirror = { enabled: true, pushEnabled: true };
      avisos.registrar.mockResolvedValueOnce('IGNORADA');
      conRecordatorio();
      await say('Número equivocado');
      expect(db.patients[0].remindersOptOut).toBe(true);
    });

    it('🛡️ «número equivocado» desde un número que ningún paciente tiene no toca a nadie', async () => {
      conRecordatorio();
      await say('Número equivocado', '573009998877');
      expect(avisos.registrar).not.toHaveBeenCalled();
      expect(db.patients[0].remindersOptOut).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ❌ Cancelar desde «no puedo asistir», con cancelar ENCENDIDO (2026-10-15)
  // ──────────────────────────────────────────────────────────────────
  describe('❌ «no puedo asistir» con cancelar encendido', () => {
    const HACE_2H = new Date(AHORA.getTime() - 2 * 3_600_000);
    const conRecordatorio = () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      db.appointments[0].reminderSentAt = HACE_2H;
    };
    const cupo = () => db.slots.find((x) => x.id === 'slot-apt-1');

    beforeEach(() => {
      // Como en producción: agendar y cambiar apagados, solo cancelar.
      bookingEnabled = false;
      cancelEnabled = true;
      rescheduleEnabled = false;
    });

    it('le muestra la cita del recordatorio y le pregunta si la cancela; nada se toca todavía', async () => {
      conRecordatorio();
      await say('Buen día ,no puedo asistir');
      const r = lastSent();
      expect(r).toContain('Entiendo que no podrá asistir a esta cita');
      expect(r).toContain('*Medicina General*');
      expect(r).toContain(
        'Responda *SÍ* para cancelarla o *NO* para mantenerla',
      );
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it.each(['Sí', 'si, cancelar', 'Cancélela por favor', 'claro'])(
      '«%s» → la cancela (sin espejo, en el acto) y libera el cupo',
      async (respuesta) => {
        conRecordatorio();
        await say('Ya no la necesito');
        await say(respuesta);
        expect(db.appointments[0].status).toBe('CANCELLED');
        expect(cupo()?.isAvailable).toBe(true);
        expect(sent().join('\n')).toMatch(/cancel/i);
      },
    );

    it('🙏 tras cancelar, «Muchas gracias por su ayuda buen día 🙏» recibe una despedida, no el aviso de agendar', async () => {
      // Caso real 2026-10-17 12:09: el «buen día» lo hacía pasar por un saludo.
      conRecordatorio();
      await say('Ya no la necesito');
      await say('Sí');
      expect(db.appointments[0].status).toBe('CANCELLED');
      await say('Muchas gracias por su ayuda buen día 🙏');
      const r = lastSent();
      expect(r).not.toContain('no es posible');
      expect(r).toMatch(/gusto|hasta luego|Con gusto/i);
      expect([null, ChatState.IDLE]).toContain(state());
    });

    it.each(['No', 'no, mejor la mantengo', 'no la cancele'])(
      '«%s» → la cita sigue intacta',
      async (respuesta) => {
        conRecordatorio();
        await say('No voy a poder ir');
        await say(respuesta);
        expect(db.appointments[0].status).toBe('SCHEDULED');
        expect(lastSent()).toMatch(/sigue/);
      },
    );

    it('🕐 su cita ya empezó: no se le ofrece cancelarla (se le dice que la hora ya pasó)', async () => {
      // Caso real 2026-10-16: «no podré asistir a las 7 30» escrito a las 7:25.
      seedPaciente();
      seedCita('apt-1', new Date(AHORA.getTime() - 5 * 60_000));
      db.appointments[0].reminderSentAt = HACE_2H;
      await say('Creo que no podré asistir a las 7 30');
      const r = lastSent();
      expect(r).toContain('ya pasó');
      expect(r).not.toContain('¿Desea que la *cancele*?');
      expect(state()).not.toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('🕐 se le ofreció a tiempo pero el SÍ llegó cuando la hora ya pasó: NO la cancela', async () => {
      seedPaciente();
      seedCita('apt-1', new Date(AHORA.getTime() + 5 * 60_000));
      db.appointments[0].reminderSentAt = HACE_2H;
      await say('Creo que no podré asistir');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      // Pasa el tiempo: la hora de la cita llega antes del SÍ.
      cupo()!.startTime = new Date(AHORA.getTime() - 60_000);
      await say('Sí');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(lastSent()).toContain('ya pasó');
    });

    it('🪪 dio su cédula en un mensaje y luego «cancelar cita»: no se la vuelve a pedir', async () => {
      // Caso real 2026-10-16: «cancelar cita pero me dan otra, mi cc 1058…» y,
      // un minuto después, «cancelar sita» → «¿me indica el número de cédula?».
      seedPaciente();
      seedCita('apt-1', MANANA);
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ cedula: CEDULA }),
      );
      await say(`buenos días, mi número de cc ${CEDULA}`);
      provider.extractSchedulingIntent.mockReturnValue(extraction());
      await say('cancelar cita');
      const r = lastSent();
      expect(r).toContain('Medicina General');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('🪪 sin una cédula reciente, «cancelar cita» la pide como siempre', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('cancelar cita');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CEDULA);
    });

    it('sin recordatorio, con una sola cita próxima: se la ofrece igual', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('Mi hija no puede ir a la cita');
      expect(lastSent()).toContain('¿Desea que la *cancele*?');
    });

    it('sin recordatorio y con varias citas: le deja ELEGIR cuál (y cancela solo esa)', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      seedCita('apt-2', new Date('2026-10-10T14:00:00.000Z'), SVC_ODONTO);
      await say('Buen día ,no puedo asistir');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_SELECTION);
      const r = lastSent();
      expect(r).toContain('¿Cuál desea *cancelar*?');
      expect(r).toContain('*A)* Medicina General');
      expect(r).toContain('*B)* Odontología');

      await say('B');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(lastSent()).toContain('Odontología');
      await say('Sí');
      expect(db.appointments.find((a) => a.id === 'apt-2')?.status).toBe(
        'CANCELLED',
      );
      expect(db.appointments.find((a) => a.id === 'apt-1')?.status).toBe(
        'SCHEDULED',
      );
    });

    // 2026-10-15: un paciente con DOS citas al día siguiente escribió «cancelar las citas».
    describe('con dos citas recordadas', () => {
      const MANANA_11 = new Date(MANANA.getTime() + 60 * 60_000);
      const conDosRecordadas = () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        seedCita('apt-2', MANANA_11, SVC_ODONTO);
        for (const a of db.appointments) a.reminderSentAt = HACE_2H;
      };

      it('«cancelar las citas» → le deja elegir entre las dos; tras cancelar una, le recuerda la otra', async () => {
        conDosRecordadas();
        await say(
          'Muy buena tarde, me veo en la necesidad de cancelar las citas por problemas de salud',
        );
        expect(state()).toBe(ChatState.AWAITING_CANCEL_SELECTION);
        expect(lastSent()).toContain('*A)* Medicina General');
        expect(lastSent()).toContain('*B)* Odontología');

        await say('A');
        await say('Sí');
        expect(db.appointments[0].status).toBe('CANCELLED');
        expect(db.appointments[1].status).toBe('SCHEDULED');
        expect(sent().join('\n')).toContain(
          'Si también desea cancelar otra de sus citas',
        );
      });

      it('«cancelar cita» tras los recordatorios también deja elegir', async () => {
        conDosRecordadas();
        await say('cancelar cita');
        expect(state()).toBe(ChatState.AWAITING_CANCEL_SELECTION);
      });
    });

    it('«cancelar cita» tal cual, sin recordatorio: el flujo de siempre (pide la cédula)', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('cancelar cita');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CEDULA);
    });

    it('«cancelar cita» tras el recordatorio: le ofrece ESA cita', async () => {
      conRecordatorio();
      await say('cancelar cita');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(lastSent()).toContain('*Medicina General*');
    });

    // 🏥 Con espejo: no dice «cancelada» hasta que el hospital la borra.
    describe('con espejo (H10 de la cancelación)', () => {
      let his: Record<string, jest.Mock>;
      beforeEach(() => {
        his = {
          requiereConfirmacion: jest.fn(async () => true),
          compuertas: jest.fn(async () => ({
            agendar: false,
            cancelar: true,
            modificar: false,
            otros: false,
          })),
          eventoDelCambio: jest.fn(async () => '88'),
          esperarCancelacion: jest.fn(async () => 'CONFIRMADA'),
          liberarCupoAnterior: jest.fn(async (_o: string, id: string) => {
            const c = db.slots.find((x) => x.id === id);
            if (c) c.isAvailable = true;
            return true;
          }),
          registrarPendiente: jest.fn(async () => undefined),
          pendientes: jest.fn(async () => []),
        };
        (service as any).confirmacionHis = his;
      });

      it('CONFIRMADA: pide unos segundos, NO libera el cupo antes, y solo después confirma y lo libera', async () => {
        conRecordatorio();
        let cupoAlEsperar: boolean | undefined;
        his.esperarCancelacion.mockImplementation(async () => {
          cupoAlEsperar = cupo()?.isAvailable;
          return 'CONFIRMADA';
        });
        await say('Buen día ,no puedo asistir');
        await say('Sí');
        expect(db.appointments[0].status).toBe('CANCELLED');
        expect(cupoAlEsperar).toBe(false);
        expect(his.esperarCancelacion).toHaveBeenCalledWith(
          ORG_ID,
          'apt-1',
          '88',
        );
        expect(his.liberarCupoAnterior).toHaveBeenCalledWith(
          ORG_ID,
          'slot-apt-1',
        );
        const textos = sent();
        const iEspera = textos.findIndex((t) =>
          /cancelando su cita|registrando la cancelación/.test(t),
        );
        // Las tres redacciones de `cancelarExitosa`.
        const iExito = textos.findIndex((t) =>
          /cancelada con éxito|Cancelé su cita|Ya cancelé la cita/.test(t),
        );
        expect(iEspera).toBeGreaterThan(-1);
        expect(iExito).toBeGreaterThan(iEspera);
      });

      it('PENDIENTE: no la da por cancelada, avisa que le escribe y la deja pendiente con su cupo', async () => {
        conRecordatorio();
        his.esperarCancelacion.mockResolvedValue('PENDIENTE');
        await say('Buen día ,no puedo asistir');
        await say('Sí');
        expect(lastSent()).toContain(
          'aún no termina de registrar la cancelación',
        );
        expect(his.liberarCupoAnterior).not.toHaveBeenCalled();
        expect(cupo()?.isAvailable).toBe(false);
        expect(his.registrarPendiente).toHaveBeenCalledWith(
          expect.objectContaining({
            tipo: 'CANCELACION',
            appointmentId: 'apt-1',
            seq: '88',
            cupoAnteriorId: 'slot-apt-1',
          }),
        );
      });

      it('NO_APLICADA: le dice que allá esa hora es de otra persona y no libera el cupo', async () => {
        conRecordatorio();
        his.esperarCancelacion.mockResolvedValue('NO_APLICADA');
        await say('Buen día ,no puedo asistir');
        await say('Sí');
        expect(lastSent()).toContain('aparece a nombre de otra persona');
        expect(lastSent()).toContain(`el hospital al *${SOPORTE}*`);
        expect(his.liberarCupoAnterior).not.toHaveBeenCalled();
        expect(cupo()?.isAvailable).toBe(false);
      });

      it.each([
        ['CONFIRMADA', 'ya registró la cancelación', true],
        ['NO_APLICADA', 'aparece a nombre de otra persona', false],
      ])(
        'después (cron): %s → se le escribe y el cupo se libera solo si se confirmó',
        async (estado, texto, libera) => {
          seedPaciente();
          seedCita('apt-1', MANANA, SVC_MEDICINA, 'pat-1', 'CANCELLED');
          his.pendientes.mockResolvedValue([
            {
              organizationId: ORG_ID,
              senderId: SENDER,
              appointmentId: 'apt-1',
              fechaTexto: 'sábado, 3 de octubre a las 09:00 a m',
              desde: new Date().toISOString(),
              tipo: 'CANCELACION',
              seq: '88',
              cupoAnteriorId: 'slot-apt-1',
            },
          ]);
          his.estadoCancelacion = jest.fn(async () => estado);
          his.reclamar = jest.fn(async () => true);

          await service.atenderConfirmacionesHisPendientes();

          expect(lastSent()).toContain(texto);
          expect(his.liberarCupoAnterior).toHaveBeenCalledTimes(libera ? 1 : 0);
        },
      );

      it('después (cron): aún PENDIENTE y sin vencer → no le escribe ni la reclama', async () => {
        his.pendientes.mockResolvedValue([
          {
            organizationId: ORG_ID,
            senderId: SENDER,
            appointmentId: 'apt-1',
            fechaTexto: 'x',
            desde: new Date().toISOString(),
            tipo: 'CANCELACION',
            seq: '88',
            cupoAnteriorId: 'slot-apt-1',
          },
        ]);
        his.estadoCancelacion = jest.fn(async () => 'PENDIENTE');
        his.reclamar = jest.fn(async () => true);
        await service.atenderConfirmacionesHisPendientes();
        expect(his.reclamar).not.toHaveBeenCalled();
        expect(sent()).toHaveLength(0);
      });

      it('con «Cancelar» cerrado hacia el hospital, no ofrece cancelar: deja el aviso al personal', async () => {
        his.compuertas.mockResolvedValue({
          agendar: false,
          cancelar: false,
          modificar: false,
          otros: false,
        });
        conRecordatorio();
        await say('Buen día ,no puedo asistir');
        expect(lastSent()).toContain('Dejé registrado su aviso');
        expect(avisos.registrar).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 🩺 AgenIA solo trabaja con las citas de médicos con «WhatsApp ON» (2026-10-15:
  // el bot confirmaba citas de odontología que trae el hospital).
  // ──────────────────────────────────────────────────────────────────
  describe('🩺 citas de médicos sin «WhatsApp ON» (fuera del alcance)', () => {
    const HACE_2H = new Date(AHORA.getTime() - 2 * 3_600_000);
    const fueraDelBot = (id: string) => {
      const slot = db.slots.find((x) => x.id === `slot-${id}`)!;
      slot.doctor = { ...slot.doctor, whatsappBookingEnabled: false };
    };

    beforeEach(() => {
      bookingEnabled = false;
      cancelEnabled = true;
      rescheduleEnabled = false;
    });

    it('«gracias» a un recordatorio de odontología no se toma por confirmación de esa cita', async () => {
      seedPaciente();
      seedCita('apt-od', MANANA, SVC_ODONTO);
      fueraDelBot('apt-od');
      db.appointments[0].reminderSentAt = HACE_2H;
      await say('Ok muchas gracias');
      expect(lastSent()).not.toContain('Gracias por confirmar');
    });

    it('con una cita del bot y otra de odontología recordadas, solo nombra la del bot', async () => {
      seedPaciente();
      seedCita('apt-mg', MANANA);
      seedCita('apt-od', new Date(MANANA.getTime() + 60 * 60_000), SVC_ODONTO);
      fueraDelBot('apt-od');
      for (const a of db.appointments) a.reminderSentAt = HACE_2H;
      await say('Ok muchas gracias');
      const r = lastSent();
      expect(r).toContain('¡Gracias por confirmar!');
      expect(r).toContain('Medicina General');
      expect(r).not.toContain('Odontología');
    });

    it('📋 «no puedo asistir» con solo una cita de odontología: no la cancela, pero el aviso le llega al personal', async () => {
      // 2026-10-16: antes se le decía «se maneja con el hospital» y nadie se
      // enteraba (casos reales de odontología e hipertensos el mismo día).
      seedPaciente();
      seedCita('apt-od', MANANA, SVC_ODONTO);
      fueraDelBot('apt-od');
      db.appointments[0].reminderSentAt = HACE_2H;
      await say('Buen día ,no puedo asistir');
      const r = lastSent();
      expect(r).not.toContain('¿Desea que la *cancele*?');
      expect(r).toContain('Dejé su aviso para el personal del hospital');
      expect(r).toContain('*Odontología*');
      expect(r).toContain('todavía no está cancelada');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      expect(avisos.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'AVISO_INASISTENCIA',
        appointmentId: 'apt-od',
        meta: { pide: 'CANCELAR', fueraDelAlcance: true },
      });
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('📋 «cancelar cita» con solo citas de odontología: no pide la cédula; deja el aviso y no toca nada', async () => {
      seedPaciente();
      seedCita('apt-od', MANANA, SVC_ODONTO);
      fueraDelBot('apt-od');
      await say('cancelar cita');
      const r = lastSent();
      expect(r).toContain('Dejé su aviso para el personal del hospital');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
      expect(avisos.registrar.mock.calls[0][1].meta).toMatchObject({
        pide: 'CANCELAR',
        fueraDelAlcance: true,
      });
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect([null, ChatState.IDLE]).toContain(state());
    });

    it('📋 por la IA (sin el atajo) y con cédula: el mismo aviso al llegar a la cita de odontología', async () => {
      seedPaciente();
      seedCita('apt-od', MANANA, SVC_ODONTO);
      fueraDelBot('apt-od');
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ isCancellation: true }),
      );
      await say('necesito ayuda con lo del viernes');
      expect(state()).toBe(ChatState.AWAITING_CANCEL_CEDULA);
      provider.extractSchedulingIntent.mockReturnValue(extraction());
      await say(CEDULA);
      expect(lastSent()).toContain(
        'Dejé su aviso para el personal del hospital',
      );
      expect(avisos.registrar).toHaveBeenCalledTimes(1);
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('📋 pide cambiar la fecha (por la IA, con cambiar apagado) de su cita de odontología: aviso de cambio', async () => {
      // Caso real 2026-10-16 08:50: «me encuentro enferma… ¿me la pueden poner
      // para más tarde?».
      seedPaciente();
      seedCita('apt-od', MANANA, SVC_ODONTO);
      fueraDelBot('apt-od');
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ isModification: true }),
      );
      await say(
        'lo q pasa es q me encuentro enferma y está lloviendo, aver si me la pueden poner para más tarde',
      );
      const r = lastSent();
      expect(r).toContain('desea cambiar la fecha de su cita de *Odontología*');
      expect(r).toContain('sigue igual por ahora');
      expect(avisos.registrar.mock.calls[0][1].meta).toMatchObject({
        pide: 'MODIFICAR',
        fueraDelAlcance: true,
      });
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('con una cita del bot Y otra de odontología, «no puedo asistir» sigue el camino del bot (sin aviso de la otra)', async () => {
      seedPaciente();
      seedCita('apt-mg', MANANA);
      seedCita('apt-od', new Date(MANANA.getTime() + 60 * 60_000), SVC_ODONTO);
      fueraDelBot('apt-od');
      await say('Buen día ,no puedo asistir');
      expect(lastSent()).toContain('¿Desea que la *cancele*?');
      expect(lastSent()).toContain('Medicina General');
      expect(avisos.registrar).not.toHaveBeenCalled();
    });

    it('🛡️ aunque la sesión guarde una cita de odontología, el SÍ no la cancela', async () => {
      seedPaciente();
      seedCita('apt-od', MANANA, SVC_ODONTO);
      fueraDelBot('apt-od');
      redis.store.set(`temp_selected_cancel_apt:${ORG_ID}:${SENDER}`, 'apt-od');
      redis.store.set(
        `temp_selected_cancel_slot:${ORG_ID}:${SENDER}`,
        'slot-apt-od',
      );
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_CANCEL_CONFIRM,
      );
      await say('Sí');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(lastSent()).toContain('no se pueden gestionar por este medio');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 🩺 …y solo con las de servicios ACTIVOS: el mismo médico de medicina general
  // (WhatsApp ON) atiende hipertensos y lectura de exámenes, que no son del bot.
  // ──────────────────────────────────────────────────────────────────
  describe('🩺 citas de un servicio inactivo con un médico con «WhatsApp ON»', () => {
    const HACE_2H = new Date(AHORA.getTime() - 2 * 3_600_000);
    const SVC_HTA = {
      id: 'svc-hta',
      name: 'Consulta ambularoria control hipertensos',
      isActive: false,
    };

    beforeEach(() => {
      bookingEnabled = false;
      cancelEnabled = true;
      rescheduleEnabled = false;
    });

    it('«gracias» a un recordatorio de hipertensos no se toma por confirmación', async () => {
      seedPaciente();
      seedCita('apt-hta', MANANA, SVC_HTA);
      db.appointments[0].reminderSentAt = HACE_2H;
      await say('Ok muchas gracias');
      expect(lastSent()).not.toContain('Gracias por confirmar');
    });

    it('📋 «cancelar cita» con solo una cita de hipertensos: aviso para el personal, la cita no se toca', async () => {
      seedPaciente();
      seedCita('apt-hta', MANANA, SVC_HTA);
      await say('cancelar cita');
      expect(lastSent()).toContain(
        'Dejé su aviso para el personal del hospital',
      );
      expect(lastSent()).toContain('hipertensos');
      expect(avisos.registrar.mock.calls[0][1].meta).toMatchObject({
        fueraDelAlcance: true,
      });
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('con una de medicina general y otra de hipertensos, solo ofrece la de medicina general', async () => {
      seedPaciente();
      seedCita('apt-mg', MANANA);
      seedCita('apt-hta', new Date(MANANA.getTime() + 60 * 60_000), SVC_HTA);
      for (const a of db.appointments) a.reminderSentAt = HACE_2H;
      await say('Ok muchas gracias');
      const r = lastSent();
      expect(r).toContain('¡Gracias por confirmar!');
      expect(r).toContain('Medicina General');
      expect(r).not.toContain('hipertensos');
    });

    it('🛡️ aunque la sesión guarde la cita de hipertensos, el SÍ no la cancela', async () => {
      seedPaciente();
      seedCita('apt-hta', MANANA, SVC_HTA);
      redis.store.set(
        `temp_selected_cancel_apt:${ORG_ID}:${SENDER}`,
        'apt-hta',
      );
      redis.store.set(
        `temp_selected_cancel_slot:${ORG_ID}:${SENDER}`,
        'slot-apt-hta',
      );
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_CANCEL_CONFIRM,
      );
      await say('Sí');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(lastSent()).toContain('no se pueden gestionar por este medio');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 🎫 Ya en el hospital: «¿qué número me toca?» (2026-10-16)
  // ──────────────────────────────────────────────────────────────────
  describe('🔎 duda sobre la cita que el asistente le acaba de agendar (2026-10-23)', () => {
    const HACE_1H = new Date(AHORA.getTime() - 3_600_000);
    const citaDelAsistente = (over: Record<string, unknown> = {}) => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      Object.assign(db.appointments[0], {
        origin: 'WHATSAPP',
        createdAt: HACE_1H,
        ...over,
      });
    };
    const casos = () =>
      avisos.registrar.mock.calls.filter(
        (c: any[]) => c[1]?.kind === 'REVISAR_CITA_ASISTENTE',
      );

    it('«Me indicas por favor si si es para las ecografías» → caso para el personal, con la cita y lo que escribió', async () => {
      citaDelAsistente();
      await say('Me indicas por favor si si es para las ecografías');
      expect(casos()).toHaveLength(1);
      const [org, entrada] = casos()[0] as any[];
      expect(org).toBe(ORG_ID);
      expect(entrada).toMatchObject({
        kind: 'REVISAR_CITA_ASISTENTE',
        dedupeKey: 'revisar-cita:apt-1',
        appointmentId: 'apt-1',
        patientId: 'pat-1',
        meta: {
          motivo: 'OTRO_SERVICIO',
          servicioPedido: 'ecografías',
          mensaje: 'Me indicas por favor si si es para las ecografías',
          canal: 'WHATSAPP',
        },
      });
    });

    it('«no era la cita que necesitaba» → también', async () => {
      citaDelAsistente();
      await say('no era la cita que necesitaba');
      expect(casos()[0]?.[1]?.meta).toMatchObject({ motivo: 'NO_LA_PIDIO' });
    });

    it.each([
      ['la cita la agendó el hospital, no el asistente', { origin: 'MIRROR' }],
      ['la agendó hace dos días', { createdAt: new Date(AHORA.getTime() - 2 * 86_400_000) }],
      ['ya está cancelada', { status: 'CANCELLED' }],
    ])('no hay caso si %s', async (_caso, over) => {
      citaDelAsistente(over);
      await say('Me indicas por favor si si es para las ecografías');
      expect(casos()).toHaveLength(0);
    });

    it('un mensaje cualquiera no consulta nada ni deja caso', async () => {
      citaDelAsistente();
      const findFirst = (service as any).prisma.appointment.findFirst as jest.Mock;
      findFirst.mockClear();
      await say('¿A qué hora abre el laboratorio?');
      expect(casos()).toHaveLength(0);
      expect(
        findFirst.mock.calls.some((c: any[]) => c[0]?.where?.createdAt),
      ).toBe(false);
    });

    it('si la Bandeja falla, la conversación sigue igual', async () => {
      citaDelAsistente();
      avisos.registrar.mockRejectedValueOnce(new Error('caída'));
      await say('Me indicas por favor si si es para las ecografías');
      expect(lastSent()).not.toBe('');
    });
  });

  describe('🎫 pregunta por su turno o consultorio', () => {
    const PREGUNTA =
      'Hola, buenas tardes. Eh, señorita, era preguntar qué número me toca con el doctor, qué número es para yo esperar acá, porque yo no veo a quién preguntar.';

    beforeEach(() => {
      bookingEnabled = false;
    });

    it('con su cita recordada: le recuerda la cita y que el turno se lo dan en la recepción', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      db.appointments[0].reminderSentAt = new Date(
        AHORA.getTime() - 5 * 3_600_000,
      );
      await say(PREGUNTA);
      const r = lastSent();
      expect(r).toContain('Medicina General');
      expect(r).toContain('Dr apt-1');
      expect(r).toContain('recepción del hospital');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
      expect(r).not.toContain('Le escribe');
      expect([null, ChatState.IDLE]).toContain(state());
      expect(db.appointments[0].status).toBe('SCHEDULED');
    });

    it('sin recordatorio, con una cita próxima: la nombra igual', async () => {
      seedPaciente();
      seedCita('apt-1', MANANA);
      await say('en qué consultorio me toca');
      expect(lastSent()).toContain('Medicina General');
      expect(lastSent()).toContain('recepción del hospital');
    });

    it('sin ninguna cita: igual le dice dónde preguntar', async () => {
      await say(PREGUNTA);
      const r = lastSent();
      expect(r).toContain('recepción del hospital');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
    });

    // 📍 «Acá estamos esperando» (caso real 2026-10-17 10:06, tras confirmar su
    // cita de las 11:35): antes recibía «por aquí solo puedo ayudarle con sus citas».
    describe('📍 avisa que ya llegó', () => {
      // AHORA = 2026-10-02 10:00 en Bogotá; la cita de hoy, a las 11:35.
      const HOY_1135 = new Date('2026-10-02T16:35:00.000Z');

      it('con su cita de hoy: gracias, su cita y que el turno se lo dan en la recepción', async () => {
        seedPaciente();
        seedCita('apt-1', HOY_1135);
        db.appointments[0].reminderSentAt = new Date(
          AHORA.getTime() - 3_600_000,
        );
        await say('Acá estamos esperando');
        const r = lastSent();
        expect(r).toContain('¡Gracias por avisar!');
        expect(r).toContain('Medicina General');
        expect(r).toMatch(/11:35/);
        expect(r).toContain('recepción del hospital');
        expect(r).not.toContain('solo puedo ayudarle');
        expect(db.appointments[0].status).toBe('SCHEDULED');
      });

      it('si su cita es otro día, se lo dice: puede haber venido el día que no era', async () => {
        seedPaciente();
        seedCita('apt-1', MANANA);
        await say('Ya llegué');
        const r = lastSent();
        expect(r).toContain('no para hoy');
        expect(r).toContain('Medicina General');
        expect(r).toContain(`el hospital al *${SOPORTE}*`);
      });

      it('sin ninguna cita: gracias y dónde preguntar', async () => {
        await say('ya estoy aquí');
        const r = lastSent();
        expect(r).toContain('¡Gracias por avisar!');
        expect(r).toContain('recepción del hospital');
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 🔁 Lo que no se puede por aquí, preguntado otra vez (2026-10-17)
  // ──────────────────────────────────────────────────────────────────
  describe('🔁 aviso repetido de lo que no se puede por aquí', () => {
    beforeEach(() => {
      // Como en producción: agendar y cambiar apagados, cancelar encendido.
      bookingEnabled = false;
      cancelEnabled = true;
      rescheduleEnabled = false;
    });

    it('la segunda y la tercera vez: la versión corta, sin repetir la lista', async () => {
      await say('Uno puede pedir una cita por aquí para el día martes');
      const primero = lastSent();
      expect(primero).toContain('agendar citas');
      expect(primero).toMatch(/consultar/i);

      await say('El lunes se puede? Para el día martes?');
      const segundo = lastSent();
      expect(segundo).toContain('Como le comenté');
      expect(segundo).toContain('agendar una cita');
      expect(segundo).toContain(`el hospital al *${SOPORTE}*`);
      expect(segundo).not.toMatch(/consultar/i);
      expect(segundo.length).toBeLessThan(primero.length);

      await say('Uno puede ir hoy a apartarla o el lunes');
      expect(lastSent()).toContain('Como le comenté');
    });

    it('otra operación no disponible tiene su propio aviso completo la primera vez', async () => {
      await say('Uno puede pedir una cita por aquí para el día martes');
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ isModification: true }),
      );
      await say('quiero mover la cita para otro día');
      const r = lastSent();
      expect(r).not.toContain('Como le comenté');
      expect(r).toContain('cambiar la fecha');
    });

    it('con las tres apagadas («solo consultas») también se acorta al repetir', async () => {
      cancelEnabled = false;
      await say('Uno puede pedir una cita por aquí para el día martes');
      expect(lastSent()).toContain('solo está activa');
      await say('El lunes se puede? Para el día martes?');
      expect(lastSent()).toContain('Como le comenté');
      expect(lastSent()).toContain('consultar');
    });
  });

  describe('🔒 fuera de tema con agendar apagado', () => {
    it('no invita a agendar: dice qué sí se puede y da el teléfono del hospital', async () => {
      bookingEnabled = false;
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ outOfContext: true }),
      );
      await say('Esque de celular no da para yamar números que sea telefono');
      const r = lastSent();
      expect(r).toContain('solo puedo ayudarle con sus citas');
      expect(r).toContain('Consultar sus citas: escríbame *"consultar"*');
      expect(r).toContain(`el hospital al *${SOPORTE}*`);
      expect(r).not.toContain('¿Qué servicio');
      expect(r).not.toContain('especialidad necesita');
    });

    it('con agendar encendido conserva el mensaje de siempre (invita a agendar)', async () => {
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ outOfContext: true }),
      );
      await say('¿Cuál es la capital de Francia?');
      expect(lastSent()).not.toContain('solo puedo ayudarle con sus citas');
    });
  });
});
