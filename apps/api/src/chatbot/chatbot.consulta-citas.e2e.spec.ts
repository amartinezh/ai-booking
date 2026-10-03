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
};

function createPrisma(db: Db) {
  const slotDe = (a: any) => db.slots.find((s) => s.id === a.scheduleSlotId);
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
    medicalService: {
      findMany: jest.fn(() => [SVC_MEDICINA, SVC_ODONTO]),
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
      // La consulta por canal del remitente (OR de teléfono / BSUID / chat).
      findMany: jest.fn(({ where }: any) =>
        db.patients.filter((p) =>
          (where.OR ?? []).some(
            (c: any) =>
              (c.whatsappId?.in && c.whatsappId.in.includes(p.whatsappId)) ||
              (c.bsuid && c.bsuid === p.bsuid) ||
              (c.telegramChatId && c.telegramChatId === p.telegramChatId),
          ),
        ),
      ),
    },
    doctorProfile: { findMany: jest.fn(() => []) },
    appointment: {
      findMany: jest.fn(({ where }: any) => {
        const desde: Date | undefined = where.scheduleSlot?.startTime?.gte;
        return db.appointments
          .filter(
            (a) => a.patientId === where.patientId && a.status === where.status,
          )
          .map((a) => ({ ...a, scheduleSlot: slotDe(a) }))
          .filter((a) => !desde || a.scheduleSlot.startTime >= desde)
          .sort(
            (x, y) =>
              x.scheduleSlot.startTime.getTime() -
              y.scheduleSlot.startTime.getTime(),
          );
      }),
      findUnique: jest.fn(({ where }: any) => {
        const a = db.appointments.find((x) => x.id === where.id);
        return a ? { ...a, scheduleSlot: slotDe(a) } : null;
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
    db = { patients: [], appointments: [], slots: [], mirror: null };
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

    it('con hospital (aunque la conexión esté viva) advierte que una cita del hospital podría faltar: la Fase A no le pregunta al HIS', async () => {
      db.mirror = {
        enabled: true,
        lookupEnabled: true,
        lastLookupCapable: true,
        lastHeartbeatAt: new Date(AHORA.getTime() - 60_000),
        lastHisReachable: true,
      };
      await say('que citas tengo');
      expect(lastSent()).toContain('directamente en el hospital');
      expect(lastSent()).toContain(SOPORTE);
      expect(pasos()[0].metadata.conexionHis).toBe('VIVA');
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
});
