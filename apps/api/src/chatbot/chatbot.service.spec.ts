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
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { SchedulingExtraction } from '../llm/interfaces/llm-provider.interface';

// ───────────────────────────────────────────────────────────────
// Helpers de prueba
// ───────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const PHONE_ID = 'phone-number-id-123';
const SENDER = '573001112233';

// Redis falso en memoria: soporta get/set/del/keys (con globs tipo `temp_*`).
function createFakeRedis() {
  const store = new Map<string, string>();
  const globToRegex = (pattern: string) => {
    const escaped = pattern
      .replace(/[.+?^${}()|\\]/g, '\\$&') // escapa specials (deja * [ ] - intactos)
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  };
  return {
    store,
    get: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, String(v));
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    keys: jest.fn(async (pattern: string) => {
      const re = globToRegex(pattern);
      return [...store.keys()].filter((k) => re.test(k));
    }),
  };
}

// SchedulingExtraction completa con overrides; default = intención "otro" sin entidades.
function extraction(over: Partial<SchedulingExtraction> = {}): SchedulingExtraction {
  return {
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
    isRateLimited: false,
    ...over,
  };
}

const makeTextEvent = (body: string) => ({
  from: SENDER,
  type: 'text',
  text: { body },
  metadata: { phone_number_id: PHONE_ID },
});

describe('ChatbotService — Intake del Primer Turno (INTENT ROUTER + ACK)', () => {
  let service: ChatbotService;
  let redis: ReturnType<typeof createFakeRedis>;
  let prisma: any;
  let provider: { name: string; extractSchedulingIntent: jest.Mock; answerFAQ: jest.Mock };
  let llmFactory: { forOrgOrNull: jest.Mock };
  let knowledgeBase: { hasContent: jest.Mock; getContent: jest.Mock };
  let sendSpy: jest.SpyInstance;

  // Devuelve los textos enviados al paciente (todo pasa por sendWhatsAppMessage).
  const sentMessages = (): string[] =>
    sendSpy.mock.calls.map((c: any[]) => c[1] as string);

  beforeEach(async () => {
    redis = createFakeRedis();

    provider = {
      name: 'GEMINI',
      extractSchedulingIntent: jest.fn(async () => extraction()),
      answerFAQ: jest.fn(async () => 'respuesta FAQ'),
    };
    llmFactory = { forOrgOrNull: jest.fn(async () => provider) };

    knowledgeBase = {
      hasContent: jest.fn(async () => true),
      getContent: jest.fn(async () => 'Servicios: Consulta externa, Laboratorio, Cardiología.'),
    };

    prisma = {
      whatsappAccountConfig: {
        findUnique: jest.fn(async () => ({
          organization: {
            id: ORG_ID,
            name: 'Hospital San Vicente',
            isActive: true,
            supportPhone: '606 853 8838',
          },
        })),
      },
      patientProfile: { findUnique: jest.fn(async () => null) },
      medicalService: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
      },
      eps: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'eps-part', name: 'Particular' })),
        update: jest.fn(async () => ({})),
      },
      organization: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    };

    const organizationSettings = {
      getBotName: jest.fn(async () => 'Geni'),
      getMaxRetries: jest.fn(async () => 3),
      getCommunicationStyle: jest.fn(async () => 'FORMAL'),
    };

    const interactionLog = {
      logSuccess: jest.fn(async () => {}),
      logFailure: jest.fn(async () => {}),
      log: jest.fn(async () => {}),
      logWaitlistJoined: jest.fn(async () => {}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: HttpService, useValue: { post: jest.fn() } },
        { provide: RedisService, useValue: redis },
        { provide: AppointmentsService, useValue: { getAvailableSlots: jest.fn(async () => []) } },
        { provide: WaitlistService, useValue: { joinWaitlist: jest.fn(), notifyWaitlist: jest.fn() } },
        { provide: InteractionLogService, useValue: interactionLog },
        { provide: KnowledgeBaseService, useValue: knowledgeBase },
        { provide: OrganizationSettingsService, useValue: organizationSettings },
        { provide: LlmFactoryService, useValue: llmFactory },
        { provide: WhatsappCredentialsService, useValue: { resolveForOrg: jest.fn() } },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);

    // Capturamos los envíos sin tocar la capa HTTP de WhatsApp.
    sendSpy = jest
      .spyOn(service as any, 'sendWhatsAppMessage')
      .mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── PRIMER TURNO: siempre clasifica con el LLM (entrada abierta) ──
  it('en IDLE invoca al LLM para clasificar el primer mensaje libre', async () => {
    provider.extractSchedulingIntent.mockResolvedValueOnce(extraction({ intent: 'otro' }));

    await service.processIncomingMessage(makeTextEvent('necesito información'));

    expect(provider.extractSchedulingIntent).toHaveBeenCalledTimes(1);
  });

  // ── INTENT ROUTER · Tarea A: insulto_abuso ──
  it('intent=insulto_abuso → guardrail firme + cierre de sesión', async () => {
    // Texto que NO matchea el regex de insultos por defecto: fuerza la vía LLM.
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'insulto_abuso' }),
    );

    await service.processIncomingMessage(
      makeTextEvent('ustedes son unos ineptos que no sirven para nada'),
    );

    const replies = sentMessages();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('respetuoso');
    // No se intenta responder FAQ ni continuar agendamiento.
    expect(provider.answerFAQ).not.toHaveBeenCalled();
    // Sesión cerrada → estado vuelve a IDLE.
    expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.IDLE);
  });

  // ── INTENT ROUTER · Tarea C: consulta_faq ──
  it('intent=consulta_faq con KB → responde vía RAG sin cambiar el estado', async () => {
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'consulta_faq' }),
    );
    provider.answerFAQ.mockResolvedValueOnce(
      'Tenemos consulta externa y laboratorio. ¿Desea agendar una cita ahora? 😊',
    );

    await service.processIncomingMessage(makeTextEvent('¿qué servicios tienen?'));

    expect(provider.answerFAQ).toHaveBeenCalledTimes(1);
    const replies = sentMessages();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('consulta externa');
    expect(replies[0]).toContain('agendar una cita ahora');
    // El FAQ no debe alterar el estado (sigue IDLE; no entra a AWAITING_SPECIALTY).
    const state = redis.store.get(`chat_state:${ORG_ID}:${SENDER}`);
    expect(state === undefined || state === ChatState.IDLE).toBe(true);
  });

  it('intent=consulta_faq sin KB → no llama answerFAQ (cae al flujo normal)', async () => {
    knowledgeBase.hasContent.mockResolvedValue(false);
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'consulta_faq' }),
    );

    await service.processIncomingMessage(makeTextEvent('¿tienen laboratorio?'));

    expect(provider.answerFAQ).not.toHaveBeenCalled();
  });

  // ── ACK · Fase 2 + validación de cédula (Fase 3) ──
  it('agendar_cita con cédula registrada → ACK saluda por nombre y confirma datos', async () => {
    prisma.patientProfile.findUnique.mockResolvedValueOnce({ fullName: 'Andrés Pérez' });
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({
        intent: 'agendar_cita',
        cedula: '1088123456',
        especialidad: 'Cardiología',
      }),
    );

    await service.processIncomingMessage(
      makeTextEvent('quiero agendar cardiología, mi cédula es 1088123456'),
    );

    // Validó la cédula contra PostgreSQL antes de confirmarla.
    expect(prisma.patientProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cedula: '1088123456' } }),
    );

    const ack = sentMessages().find((m) => m.includes('Andrés Pérez'));
    expect(ack).toBeDefined();
    expect(ack).toContain('1088123456');
    expect(ack).toContain('Cardiología');

    // Sembró el nombre para no volver a pedirlo.
    expect(redis.store.get(`temp_nombre:${ORG_ID}:${SENDER}`)).toBe('Andrés Pérez');
  });

  it('agendar_cita con cédula de formato inválido → no la confirma ni la persiste', async () => {
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'agendar_cita', cedula: '12' }), // < MIN_CEDULA_LENGTH
    );

    await service.processIncomingMessage(makeTextEvent('agendar con cédula 12'));

    // No se valida contra BD una cédula con formato inválido.
    expect(prisma.patientProfile.findUnique).not.toHaveBeenCalled();
    // No se arrastra la cédula inválida en sesión.
    expect(redis.store.get(`temp_cedula:${ORG_ID}:${SENDER}`)).toBeUndefined();
    // El ACK no la presenta como confirmada.
    const ack = sentMessages()[0] || '';
    expect(ack).not.toContain('🪪');
  });

  // ════════════════════════════════════════════════════════════
  // Fix #2 — Intención de agendar dentro del paso de menú
  // (AWAITING_SPECIALTY): "Si quiero agendar una cita" ya no cae
  // en el mensaje de "no entendí".
  // ════════════════════════════════════════════════════════════
  describe('en AWAITING_SPECIALTY', () => {
    beforeEach(async () => {
      // Sesión colgada en el paso de selección de servicio.
      redis.store.set(`chat_state:${ORG_ID}:${SENDER}`, ChatState.AWAITING_SPECIALTY);
      prisma.medicalService.findMany.mockResolvedValue([
        { id: 's1', name: 'Consulta externa' },
        { id: 's2', name: 'Laboratorio clínico' },
      ]);
    });

    it('afirmación de agendar → re-presenta el menú sin error ni penalizar reintentos', async () => {
      await service.processIncomingMessage(makeTextEvent('Si quiero agendar una cita'));

      const reply = sentMessages()[0] || '';
      // Re-presentación cálida, NO el mensaje de "no logré entender".
      expect(reply).not.toContain('no logré entender');
      expect(reply).toContain('servicios');
      expect(reply).toContain('Consulta externa');
      // No se llamó al LLM (en el paso de menú no se usa).
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      // No se penalizó con reintento.
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBeUndefined();
    });

    it('una pregunta abierta sigue yendo a FAQ (no a re-presentación)', async () => {
      provider.answerFAQ.mockResolvedValueOnce('Una cita cuesta $50.000.');

      await service.processIncomingMessage(makeTextEvent('¿cuánto cuesta una cita?'));

      expect(provider.answerFAQ).toHaveBeenCalledTimes(1);
      expect(sentMessages()[0]).toContain('cuesta');
    });

    it('texto sin sentido (ni servicio, ni FAQ, ni agendar) → sí muestra el error y penaliza', async () => {
      await service.processIncomingMessage(makeTextEvent('xyz qwerty zzz'));

      // Solo la rama de error incrementa el contador (la re-presentación y el
      // FAQ no lo hacen): señal fiable de que cayó en "servicio inválido".
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('1');
      // No es la re-presentación cálida de agendamiento.
      expect(sentMessages()[0]).not.toContain('🗓️');
    });
  });
});
