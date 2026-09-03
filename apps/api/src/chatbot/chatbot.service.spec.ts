import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { ChatbotService } from './chatbot.service';
import { ChatState, MSGS } from './chatbot.constants';
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
import { SurveyService } from '../survey/survey.service';
import { AudioConfigService } from '../audio-config/audio-config.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
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
    get: jest.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    // La firma real es `set(key, value, 'EX', ttl)`: el fake acepta los args de
    // expiración para que los tests puedan afirmar sobre el TTL.
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
    // El TTL no se modela en memoria; basta con que exista para la marca de
    // actividad (refresco de TTL del estado) que hace el servicio en cada mensaje.
    expire: jest.fn((k: string) => (store.has(k) ? 1 : 0)),
    ttl: jest.fn((k: string) => (store.has(k) ? -1 : -2)),
  };
}

// SchedulingExtraction completa con overrides; default = intención "otro" sin entidades.
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
  let provider: {
    name: string;
    extractSchedulingIntent: jest.Mock;
    answerFAQ: jest.Mock;
    mapEntityToCatalog: jest.Mock;
  };
  let llmFactory: { forOrgOrNull: jest.Mock };
  let knowledgeBase: { hasContent: jest.Mock; getContent: jest.Mock };
  let interactionLog: {
    logSuccess: jest.Mock;
    logFailure: jest.Mock;
    log: jest.Mock;
    logWaitlistJoined: jest.Mock;
    logBookingConfirmed: jest.Mock;
  };
  let sendSpy: jest.SpyInstance;

  // Devuelve los textos enviados al paciente (todo pasa por sendWhatsAppMessage).
  const sentMessages = (): string[] =>
    sendSpy.mock.calls.map((c: any[]) => c[1] as string);

  beforeEach(async () => {
    redis = createFakeRedis();

    provider = {
      name: 'GEMINI',
      extractSchedulingIntent: jest.fn(() => extraction()),
      answerFAQ: jest.fn(() => 'respuesta FAQ'),
      mapEntityToCatalog: jest.fn(() => ({ id: null })),
    };
    llmFactory = { forOrgOrNull: jest.fn(() => provider) };

    knowledgeBase = {
      hasContent: jest.fn(() => true),
      getContent: jest.fn(
        () => 'Servicios: Consulta externa, Laboratorio, Cardiología.',
      ),
    };

    prisma = {
      whatsappAccountConfig: {
        findUnique: jest.fn(() => ({
          organization: {
            id: ORG_ID,
            name: 'Hospital San Vicente',
            isActive: true,
            supportPhone: '606 853 8838',
          },
        })),
      },
      patientProfile: {
        findUnique: jest.fn(() => null),
        findFirst: jest.fn(() => null),
        create: jest.fn(({ data }: any) => ({ id: 'pat-1', ...data })),
        update: jest.fn(({ data }: any) => ({ id: 'pat-1', ...data })),
      },
      medicalService: {
        findMany: jest.fn(() => []),
        findFirst: jest.fn(() => null),
      },
      eps: {
        findMany: jest.fn(() => []),
        findFirst: jest.fn(() => null),
        findUnique: jest.fn(() => null),
        create: jest.fn(() => ({ id: 'eps-part', name: 'Particular' })),
        update: jest.fn(() => ({})),
      },
      organization: {
        findMany: jest.fn(() => []),
        findUnique: jest.fn(() => null),
      },
      doctorProfile: { findMany: jest.fn(() => []) },
      // Padrón EPS (pacientes dados de alta). Default null = "no está de
      // alta"; el gate solo se activa cuando eps.findFirst resuelve una EPS
      // real (no Particular), así que el resto de tests no se ven afectados.
      epsEnrolledPatient: { findFirst: jest.fn(() => null) },
      user: { create: jest.fn(() => ({ id: 'user-tmp-1' })) },
      scheduleSlot: { findUnique: jest.fn(() => null) },
    };

    const organizationSettings = {
      getBotName: jest.fn(() => 'Geni'),
      getMaxRetries: jest.fn(() => 3),
      getCommunicationStyle: jest.fn(() => 'FORMAL'),
    };

    interactionLog = {
      logSuccess: jest.fn(async () => {}),
      logFailure: jest.fn(async () => {}),
      log: jest.fn(async () => {}),
      logWaitlistJoined: jest.fn(async () => {}),
      logBookingConfirmed: jest.fn(async () => {}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: HttpService, useValue: { post: jest.fn() } },
        { provide: RedisService, useValue: redis },
        {
          provide: AppointmentsService,
          useValue: {
            getAvailableSlots: jest.fn(() => []),
            bookAppointment: jest.fn(() => ({
              success: true,
              appointmentId: 'apt-1',
            })),
          },
        },
        {
          provide: WaitlistService,
          useValue: { joinWaitlist: jest.fn(), notifyWaitlist: jest.fn() },
        },
        { provide: InteractionLogService, useValue: interactionLog },
        { provide: KnowledgeBaseService, useValue: knowledgeBase },
        {
          provide: OrganizationSettingsService,
          useValue: organizationSettings,
        },
        { provide: LlmFactoryService, useValue: llmFactory },
        {
          provide: WhatsappCredentialsService,
          useValue: { resolveForOrg: jest.fn() },
        },
        {
          provide: SurveyService,
          useValue: { generateSurveyToken: jest.fn(() => null) },
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

    // Capturamos los envíos sin tocar la capa HTTP de WhatsApp.
    sendSpy = jest
      .spyOn(service as any, 'sendWhatsAppMessage')
      .mockResolvedValue(undefined);

    // El enlace CSAT (encuesta de cierre) es plumbing aparte de la conversación:
    // lo silenciamos para que `sentMessages()` capture solo las respuestas del flujo.
    jest.spyOn(service as any, 'sendSurveyLink').mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Helpers de auditoría (auditFailure / auditSuccess) ──────────
  // Contrato crítico: deben reenviar a interactionLog EXACTAMENTE el mismo
  // payload que las llamadas directas, inyectando whatsappId/organizationId y
  // preservando campo a campo el resto (reason, userMessage, botReply,
  // metadata, …). Esta red cierra el hueco de que el resto del spec no
  // asercia los argumentos de auditoría, y vuelve segura la migración masiva.
  describe('auditFailure / auditSuccess', () => {
    it('auditFailure reenvía whatsappId/organizationId + spread de params a logFailure', async () => {
      await (service as any).auditFailure(SENDER, ORG_ID, {
        reason: 'PATIENT_NOT_FOUND',
        userMessage: '1010',
        botReply: 'No te encontramos',
        metadata: { searchedCedula: '1010' },
      });

      expect(interactionLog.logFailure).toHaveBeenCalledTimes(1);
      expect(interactionLog.logFailure).toHaveBeenCalledWith({
        whatsappId: SENDER,
        organizationId: ORG_ID,
        reason: 'PATIENT_NOT_FOUND',
        userMessage: '1010',
        botReply: 'No te encontramos',
        metadata: { searchedCedula: '1010' },
      });
    });

    it('auditSuccess reenvía whatsappId/organizationId + spread de params a logSuccess', async () => {
      await (service as any).auditSuccess(SENDER, ORG_ID, {
        userMessage: '1010',
        botReply: '¿Confirmas?',
        metadata: { step: 'CANCEL_SHOWING_SINGLE' },
      });

      expect(interactionLog.logSuccess).toHaveBeenCalledTimes(1);
      expect(interactionLog.logSuccess).toHaveBeenCalledWith({
        whatsappId: SENDER,
        organizationId: ORG_ID,
        userMessage: '1010',
        botReply: '¿Confirmas?',
        metadata: { step: 'CANCEL_SHOWING_SINGLE' },
      });
    });

    it('auditSuccess sin params envía solo whatsappId/organizationId', async () => {
      await (service as any).auditSuccess(SENDER, ORG_ID);

      expect(interactionLog.logSuccess).toHaveBeenCalledWith({
        whatsappId: SENDER,
        organizationId: ORG_ID,
      });
    });

    it('el caller puede sobreescribir whatsappId/organizationId vía params', async () => {
      await (service as any).auditFailure(SENDER, ORG_ID, {
        reason: 'ORG_INACTIVE',
        organizationId: 'otra-org',
      });

      expect(interactionLog.logFailure).toHaveBeenCalledWith({
        whatsappId: SENDER,
        organizationId: 'otra-org',
        reason: 'ORG_INACTIVE',
      });
    });
  });

  // ── Resolución de médico preferido (nombre libre → DoctorProfile.id) ──
  describe('resolvePreferredDoctorId', () => {
    const SERVICE_ID = 'svc-1';
    const resolve = (name: string | null | undefined) =>
      (service as any).resolvePreferredDoctorId(ORG_ID, SERVICE_ID, name);

    it('match único: una sola coincidencia en el servicio devuelve su id', async () => {
      prisma.doctorProfile.findMany.mockResolvedValueOnce([
        { id: 'd1', fullName: 'Carlos Pérez' },
        { id: 'd2', fullName: 'Ana Gómez' },
      ]);

      await expect(resolve('Dr. Pérez')).resolves.toBe('d1');
      // Bastó la consulta acotada al servicio; no se hace fallback org-wide.
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          serviceId: SERVICE_ID,
          isActive: true,
          whatsappBookingEnabled: true,
        },
        select: { id: true, fullName: true },
      });
    });

    // ── El filtro que faltaba ────────────────────────────────────────────
    // `isActive` y `whatsappBookingEnabled` no son lo mismo. En un espejo de
    // hospital la segunda arranca en `false` para TODOS —`homologar.ts` importa
    // los 27 médicos del HIS apagados y el piloto los enciende uno a uno—, así
    // que sin este filtro el resolvedor devolvía tan tranquilo un médico al que
    // AgenIA no puede agendar, y el paciente quedaba en lista de espera de un
    // cupo que nunca se le iba a ofrecer.
    it('🚦 no resuelve a un médico apagado para WhatsApp, ni siquiera org-wide', async () => {
      // Prisma filtra en la consulta: apagado = no aparece en NINGUNO de los
      // dos intentos, así que ambos vuelven vacíos.
      prisma.doctorProfile.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await expect(resolve('Dr. Pérez')).resolves.toBeNull();

      for (const llamada of prisma.doctorProfile.findMany.mock.calls) {
        expect(llamada[0].where).toMatchObject({
          isActive: true,
          whatsappBookingEnabled: true,
        });
      }
    });

    it('🚦 el fallback org-wide también exige el médico encendido', async () => {
      prisma.doctorProfile.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'd5', fullName: 'Jorge Salazar' }]);

      await expect(resolve('salazar')).resolves.toBe('d5');
      expect(prisma.doctorProfile.findMany).toHaveBeenLastCalledWith({
        where: {
          organizationId: ORG_ID,
          isActive: true,
          whatsappBookingEnabled: true,
        },
        select: { id: true, fullName: true },
      });
    });

    it('ambigüedad: varias coincidencias devuelven null (nunca asigna al azar)', async () => {
      // Dos "Pérez" en el servicio → ambiguo; el fallback org-wide repite la ambigüedad.
      prisma.doctorProfile.findMany
        .mockResolvedValueOnce([
          { id: 'd1', fullName: 'Ana Pérez' },
          { id: 'd2', fullName: 'Luis Pérez' },
        ])
        .mockResolvedValueOnce([
          { id: 'd1', fullName: 'Ana Pérez' },
          { id: 'd2', fullName: 'Luis Pérez' },
        ]);

      await expect(resolve('perez')).resolves.toBeNull();
      // Intentó servicio y luego org-wide.
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledTimes(2);
    });

    it('sin acentos: "nunez" coincide con "Núñez" (normalización NFD)', async () => {
      prisma.doctorProfile.findMany.mockResolvedValueOnce([
        { id: 'd9', fullName: 'María Núñez' },
      ]);

      await expect(resolve('doctora nunez')).resolves.toBe('d9');
    });

    it('fallback org-wide: si no hay match en el servicio, busca en toda la organización', async () => {
      prisma.doctorProfile.findMany
        .mockResolvedValueOnce([]) // servicio: vacío
        .mockResolvedValueOnce([{ id: 'd5', fullName: 'Jorge Salazar' }]); // org-wide

      await expect(resolve('salazar')).resolves.toBe('d5');
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledTimes(2);
    });

    it('sin nombre: retorna null sin tocar la base de datos', async () => {
      await expect(resolve(null)).resolves.toBeNull();
      await expect(resolve('')).resolves.toBeNull();
      await expect(resolve('Dr')).resolves.toBeNull(); // needle < 3 chars tras limpiar
      expect(prisma.doctorProfile.findMany).not.toHaveBeenCalled();
    });
  });

  // ── Sinónimos de saludo (chatbot-patterns.txt) ──
  describe('patrones de saludo', () => {
    beforeEach(() => {
      // Carga los patrones reales del archivo (onModuleInit no corre en tests).
      (service as any).loadPatterns();
    });

    it.each([
      'hola',
      'buenas',
      'buenos días',
      'buenas tardes',
      'buenas noches',
      'qué más',
      'quiubo',
      'qué tal',
      'hey',
      'saludos',
    ])('reconoce "%s" como saludo', (saludo) => {
      expect((service as any).greetingRegex.test(saludo)).toBe(true);
      // Debe estar también en escape (resetea sesión / evita LLM).
      expect((service as any).escapeRegex.test(saludo)).toBe(true);
    });

    it('no confunde una solicitud real con un saludo', () => {
      expect((service as any).greetingRegex.test('necesito una cita')).toBe(
        false,
      );
      expect(
        (service as any).greetingRegex.test('buenas necesito una cita'),
      ).toBe(false);
    });
  });

  // ── Sinónimos de cierre/despedida [goodbye] (chatbot-patterns.txt) ──
  describe('patrones de cierre (goodbye)', () => {
    beforeEach(() => {
      (service as any).loadPatterns();
    });

    const matches = (t: string) =>
      (service as any).matchesGoodbye(t) as boolean;

    it.each([
      'chao',
      'adios',
      'adiós',
      'hasta luego',
      'nos vemos',
      'bye',
      'salir',
      'no quiero agendar',
      'no agendar',
      'ya no quiero',
      'no gracias',
      'eso es todo',
      'nada más',
      'déjalo así',
      'terminar',
      'finalizar',
    ])('reconoce "%s" como cierre', (frase) => {
      expect(matches(frase)).toBe(true);
    });

    it('normaliza signos de puntuación, emojis y mayúsculas (paridad voz)', () => {
      expect(matches('Chao.')).toBe(true);
      expect(matches('¡Hasta luego!')).toBe(true);
      expect(matches('  no quiero seguir  ')).toBe(true);
      expect(matches('Adiós 👋')).toBe(true);
    });

    it('NO colisiona con respuestas SÍ/NO ni letras de selección', () => {
      // "no" a secas es una respuesta válida en pasos SÍ/NO → no debe cerrar.
      expect(matches('no')).toBe(false);
      expect(matches('si')).toBe(false);
      expect(matches('sí')).toBe(false);
      expect(matches('a')).toBe(false);
      expect(matches('b')).toBe(false);
    });

    it('NO confunde una solicitud real con un cierre', () => {
      expect(matches('quiero agendar una cita')).toBe(false);
      expect(matches('necesito salir temprano del trabajo')).toBe(false);
    });

    it('cierre ≠ escape: "salir" cierra, no reinicia', () => {
      // "salir" salió de [escape] y vive en [goodbye] (cierre cordial).
      expect((service as any).escapeRegex.test('salir')).toBe(false);
      expect((service as any).goodbyeRegex.test('salir')).toBe(true);
    });

    it('escape sigue siendo reinicio (no cierre)', () => {
      expect((service as any).escapeRegex.test('reiniciar')).toBe(true);
      expect((service as any).escapeRegex.test('menu')).toBe(true);
      expect(matches('reiniciar')).toBe(false);
    });
  });

  // ── Números de documento por voz (agrupación para TTS) ──
  describe('groupDigitsForSpeech: lee la cédula por bloques', () => {
    const group = (d: string) =>
      (service as any).groupDigitsForSpeech(d) as string;

    it('agrupa de a 3 desde la derecha', () => {
      expect(group('123456789')).toBe('123 456 789');
      expect(group('1234567')).toBe('1 234 567');
      expect(group('12345678')).toBe('12 345 678');
    });

    it('un bloque exacto no añade espacios', () => {
      expect(group('123')).toBe('123');
      expect(group('123456')).toBe('123 456');
    });
  });

  // ── PRIMER TURNO: siempre clasifica con el LLM (entrada abierta) ──
  it('en IDLE invoca al LLM para clasificar el primer mensaje libre', async () => {
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'otro' }),
    );

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
    expect(replies[0]).toContain('respetuosa');
    // No se intenta responder FAQ ni continuar agendamiento.
    expect(provider.answerFAQ).not.toHaveBeenCalled();
    // Sesión cerrada → estado vuelve a IDLE.
    expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
      ChatState.IDLE,
    );
  });

  // ── 🚑 GUARDRAIL EMERGENCIA: banderas rojas clínicas → derivación ──
  // Caso de referencia: "necesito una cita urgente porque llevo tres días
  // con dolor en el pecho" NO debe entrar al funnel de agendamiento — se
  // deriva a 123/urgencias/equipo humano SIN gastar llamada al LLM y SIN
  // encuesta CSAT. El chequeo es regex pre-LLM y corre en TODOS los estados,
  // incluidos los pasos estrictos donde el LLM ni se invoca.
  describe('guardrail EMERGENCIA (regex pre-LLM)', () => {
    it('bandera roja en IDLE → deriva a 123 sin llamar al LLM ni encuestar', async () => {
      await service.processIncomingMessage(
        makeTextEvent(
          'Necesito una cita urgente porque llevo tres días con dolor en el pecho',
        ),
      );

      // No se gastó llamada al LLM ni se intentó FAQ/agendamiento.
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      expect(provider.answerFAQ).not.toHaveBeenCalled();

      // [0] = derivación al paciente, [1] = alerta proactiva al staff.
      const replies = sentMessages();
      expect(replies).toHaveLength(2);
      expect(replies[0]).toContain('123');
      expect(replies[0]).toContain('Urgencias');
      // Incluye el teléfono del equipo humano de la org.
      expect(replies[0]).toContain('606 853 8838');
      // Sin diagnóstico: lenguaje condicional, nunca afirmativo.
      expect(replies[0]).toContain('podría');

      // 📟 Alerta al staff: supportPhone normalizado a dígitos, con el
      // teléfono del paciente y su mensaje para el seguimiento humano.
      expect(sendSpy).toHaveBeenCalledWith(
        '6068538838',
        expect.stringContaining('ALERTA: POSIBLE EMERGENCIA'),
      );
      expect(sendSpy).toHaveBeenCalledWith(
        '6068538838',
        expect.stringContaining(SENDER),
      );

      // Sesión cerrada → IDLE, con status de auditoría dedicado. El envío
      // de la alerta queda registrado (false aquí: el mock de Meta no
      // confirma la entrega).
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.IDLE,
      );
      expect(interactionLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EMERGENCY_ESCALATED',
          metadata: expect.objectContaining({
            guardrail: 'EMERGENCY_REGEX',
            staffAlerted: false,
          }),
        }),
      );
      // Sin encuesta CSAT para un paciente en posible emergencia.
      expect((service as any).sendSurveyLink).not.toHaveBeenCalled();
    });

    it('registra staffAlerted=true cuando Meta confirma la entrega de la alerta', async () => {
      sendSpy.mockResolvedValue({ messages: [{ id: 'wamid-1' }] });

      await service.processIncomingMessage(
        makeTextEvent('tengo dolor en el pecho'),
      );

      expect(interactionLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EMERGENCY_ESCALATED',
          metadata: expect.objectContaining({ staffAlerted: true }),
        }),
      );
    });

    it('sin supportPhone: deriva igual al paciente y no intenta alertar (fail-soft)', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organization: {
          id: ORG_ID,
          name: 'Hospital San Vicente',
          isActive: true,
          supportPhone: null,
        },
      });

      await service.processIncomingMessage(makeTextEvent('me quiero matar'));

      // Solo la derivación al paciente: no hay número al cual alertar.
      const replies = sentMessages();
      expect(replies).toHaveLength(1);
      expect(replies[0]).toContain('123');
      expect(interactionLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EMERGENCY_ESCALATED',
          metadata: expect.objectContaining({ staffAlerted: false }),
        }),
      );
    });

    it('también dispara en paso de MENÚ (AWAITING_SPECIALTY), antes del resolver y su atajo a FAQ', async () => {
      // En los pasos de menú el texto NO llama al LLM y el resolver puede
      // desviar a answerFAQ vía classifyIntentLocal ("urgencia" es keyword
      // de FAQ). La bandera roja debe ganar ANTES de llegar ahí.
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_SPECIALTY,
      );

      await service.processIncomingMessage(
        makeTextEvent('es una emergencia, llevo horas con dolor en el pecho'),
      );

      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      expect(provider.answerFAQ).not.toHaveBeenCalled();
      const replies = sentMessages();
      expect(replies).toHaveLength(2); // paciente + alerta al staff
      expect(replies[0]).toContain('123');
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.IDLE,
      );
    });

    it('también dispara en paso estricto (AWAITING_CONFIRMATION), donde el LLM ni se llama', async () => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_CONFIRMATION,
      );

      await service.processIncomingMessage(
        makeTextEvent('me duele mucho el pecho, no aguanto'),
      );

      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      const replies = sentMessages();
      expect(replies).toHaveLength(2); // paciente + alerta al staff
      expect(replies[0]).toContain('123');
      // El flujo de agendamiento se corta: la sesión vuelve a IDLE.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.IDLE,
      );
    });

    it('tiene prioridad sobre el guardrail de insultos', async () => {
      await service.processIncomingMessage(
        makeTextEvent('hijueputa me duele el pecho'),
      );

      const replies = sentMessages();
      expect(replies).toHaveLength(2); // paciente + alerta al staff
      expect(replies[0]).toContain('123');
      expect(replies[0]).not.toContain('respetuosa');
    });

    it('"cita urgente" sin síntomas NO dispara la derivación', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ intent: 'agendar_cita' }),
      );

      await service.processIncomingMessage(
        makeTextEvent('quiero una cita urgente con cardiología'),
      );

      // Siguió el flujo normal: el LLM clasificó el mensaje.
      expect(provider.extractSchedulingIntent).toHaveBeenCalledTimes(1);
      expect(sentMessages().join('\n')).not.toContain('🚨');
    });

    it('mención clínica sin bandera roja ("chequeo del corazón") NO dispara', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ intent: 'agendar_cita' }),
      );

      await service.processIncomingMessage(
        makeTextEvent('quiero un chequeo del corazón con el cardiólogo'),
      );

      expect(provider.extractSchedulingIntent).toHaveBeenCalledTimes(1);
      expect(sentMessages().join('\n')).not.toContain('🚨');
    });

    // El TestingModule no ejecuta onModuleInit: los tests de arriba corren
    // sobre el regex default hardcodeado. Este ejercita la carga real de la
    // sección [emergency] del .txt (reloadPatterns) y su normalización.
    it('carga [emergency] desde chatbot-patterns.txt y normaliza tildes/puntuación', () => {
      service.reloadPatterns();
      const isEmergency = (t: string) =>
        (service as any).isEmergencyText(t) as boolean;

      // Frase que SOLO está en el archivo (no en el default hardcodeado),
      // escrita con tilde para probar la normalización de entrada.
      expect(isEmergency('Se tomó las pastillas, ayuda')).toBe(true);
      // Tilde + signos de puntuación colapsados a espacios.
      expect(isEmergency('¡Convulsión!')).toBe(true);
      // Exclusiones documentadas en el .txt: prontitud no es síntoma y
      // "mover la cita" es reprogramación, no parálisis.
      expect(isEmergency('necesito una cita urgente')).toBe(false);
      expect(isEmergency('no puedo mover la cita')).toBe(false);
    });
  });

  // ── 🚑 GUARDRAIL EMERGENCIA post-LLM (Tarea D + transcript de audio) ──
  // Defensa en profundidad sobre el regex pre-LLM (que solo ve TEXTO):
  // (a) el flag isEmergency del LLM captura paráfrasis que el diccionario
  // [emergency] no enumera; (b) el regex sobre la transcripción adoptada
  // cubre la nota de VOZ aunque el LLM no marque el flag.
  describe('guardrail EMERGENCIA (post-LLM: Tarea D + transcript)', () => {
    it('paráfrasis por TEXTO que el regex no cubre pero el LLM marca isEmergency → deriva', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ intent: 'agendar_cita', isEmergency: true }),
      );

      await service.processIncomingMessage(
        makeTextEvent(
          'siento una presión horrible aquí en el corazón desde ayer',
        ),
      );

      const replies = sentMessages();
      expect(replies).toHaveLength(2); // paciente + alerta al staff
      expect(replies[0]).toContain('123');
      // La emergencia gana aunque el intent fuera agendar_cita: no avanza el flujo.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.IDLE,
      );
      expect(interactionLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EMERGENCY_ESCALATED',
          metadata: expect.objectContaining({ guardrail: 'EMERGENCY_LLM' }),
        }),
      );
      expect((service as any).sendSurveyLink).not.toHaveBeenCalled();
    });

    it('isEmergency gana sobre intent=consulta_faq: no responde FAQ', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ intent: 'consulta_faq', isEmergency: true }),
      );

      await service.processIncomingMessage(
        makeTextEvent('¿qué hago? mi esposo se puso morado y no responde'),
      );

      expect(provider.answerFAQ).not.toHaveBeenCalled();
      const replies = sentMessages();
      expect(replies).toHaveLength(2); // paciente + alerta al staff
      expect(replies[0]).toContain('123');
    });

    it('AUDIO: bandera roja en la transcripción deriva aunque el LLM no marque el flag', async () => {
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      // El LLM transcribe la bandera roja pero deja isEmergency en false
      // (fail-open): el regex sobre el transcript debe atraparla.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'me duele mucho el pecho y no aguanto',
          intent: 'agendar_cita',
          isEmergency: false,
        }),
      );

      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'audio-emergencia-1' },
        metadata: { phone_number_id: PHONE_ID },
      });

      // [0] = ACK "🎧 lo estoy escuchando", [1] = derivación de emergencia,
      // [2] = alerta proactiva al staff.
      const replies = sentMessages();
      expect(replies).toHaveLength(3);
      expect(replies[1]).toContain('123');
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.IDLE,
      );
      expect(interactionLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EMERGENCY_ESCALATED',
          metadata: expect.objectContaining({
            guardrail: 'EMERGENCY_TRANSCRIPT_REGEX',
          }),
        }),
      );
      expect((service as any).sendSurveyLink).not.toHaveBeenCalled();
    });

    it('AUDIO sin bandera roja ni flag → sigue el flujo normal', async () => {
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'quiero una cita de consulta externa',
          intent: 'agendar_cita',
        }),
      );

      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'audio-normal-1' },
        metadata: { phone_number_id: PHONE_ID },
      });

      expect(sentMessages().join('\n')).not.toContain('🚨');
      expect(interactionLog.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'EMERGENCY_ESCALATED' }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 🚑 FASE 5 — DATASET DE EVALUACIÓN DEL DETECTOR DETERMINISTA
  // ──────────────────────────────────────────────────────────────
  // Golden dataset de `isEmergencyText` contra el diccionario REAL cargado
  // de chatbot-patterns.txt (por eso reloadPatterns() en cada caso: el
  // TestingModule no corre onModuleInit). Su función es fijar a la vez la
  // SENSIBILIDAD (una bandera roja por cada categoría clínica del .txt) y
  // la ESPECIFICIDAD (exclusiones deliberadas), de modo que editar el .txt
  // NO reintroduzca un falso negativo —potencialmente una vida— ni una
  // regresión de falsos positivos que erosione la confianza en el canal.
  // NO cubre la capa LLM (Tarea D), que se prueba arriba con el flag
  // mockeado: aquí se evalúa la red de seguridad que NO depende del LLM.
  // Ver docs/GUARDRAIL_EMERGENCIAS.md para el runbook de afinamiento.
  // ══════════════════════════════════════════════════════════════
  describe('FASE 5 — dataset de evaluación (isEmergencyText, diccionario real)', () => {
    beforeEach(() => service.reloadPatterns());
    const isEmergency = (t: string) =>
      (service as any).isEmergencyText(t) as boolean;

    // DEBEN derivar — una frase natural por categoría del diccionario.
    const POSITIVOS: Array<[string, string]> = [
      [
        'dolor torácico (frase de la lámina)',
        'Necesito una cita urgente porque llevo tres días con dolor en el pecho',
      ],
      ['dolor torácico agudo', 'me duele mucho el pecho y no aguanto'],
      ['opresión torácica', 'siento una opresión en el pecho horrible'],
      ['dificultad respiratoria', 'no puedo respirar bien'],
      ['falta de aire', 'me falta el aire desde hace rato'],
      ['infarto declarado', 'creo que le está dando un infarto'],
      ['desmayo', 'mi papá se desmayó en la casa'],
      ['convulsión', 'el niño está convulsionando'],
      ['pérdida de conciencia', 'perdió el conocimiento y no despierta'],
      ['sangrado', 'no para de sangrar la herida'],
      ['vómito con sangre', 'está vomitando sangre'],
      ['ideación suicida', 'me quiero matar'],
      ['ideación suicida (variante)', 'quiero quitarme la vida'],
      ['sobredosis', 'creo que fue una sobredosis'],
      ['intoxicación por fármacos', 'se tomó las pastillas de la abuela'],
      ['accidente grave', 'tuvimos un accidente grave en la moto'],
      ['atropello', 'lo atropellaron hace un momento'],
      ['obstétrico', 'mi bebé no se mueve desde ayer'],
      ['reacción alérgica', 'se me hinchó la cara de repente'],
      ['emergencia declarada', 'es una emergencia por favor'],
      ['normalización mayúsculas/tildes/signos', '¡CONVULSIÓN!'],
      ['normalización puntuación', 'Me desmayé, ayúdenme'],
    ];

    // NO deben derivar — el costo de un falso positivo es fricción, pero
    // estas exclusiones son deliberadas y están documentadas en el .txt.
    const NEGATIVOS: Array<[string, string]> = [
      ['prontitud, no síntoma', 'necesito una cita urgente con cardiología'],
      ['chequeo de rutina', 'quiero un chequeo del corazón'],
      ['control rutinario', 'cita de control con cardiología'],
      [
        'reprogramación (colisión "no puedo mover")',
        'no puedo mover la cita para el viernes',
      ],
      ['cefalea leve', 'me duele la cabeza a veces'],
      ['pregunta informativa de urgencias', 'cuál es el horario de urgencias'],
      [
        'info del servicio de urgencias',
        'quiero información sobre el servicio de urgencias',
      ],
      ['trámite administrativo', 'necesito un certificado médico'],
      ['cita normal', 'tengo una cita a las tres de la tarde'],
      ['síntoma leve no listado', 'tengo dolor de garganta leve'],
    ];

    it.each(POSITIVOS)('POSITIVO — %s → deriva', (_label, frase) => {
      expect(isEmergency(frase)).toBe(true);
    });

    it.each(NEGATIVOS)('NEGATIVO — %s → NO deriva', (_label, frase) => {
      expect(isEmergency(frase)).toBe(false);
    });

    // Métrica agregada: deja el conteo visible en el reporte y sirve de
    // guardarraíl si un edit del .txt tumba una categoría entera.
    it('cubre todas las banderas rojas del dataset (sensibilidad 100%)', () => {
      const fallos = POSITIVOS.filter(([, f]) => !isEmergency(f)).map(
        ([l]) => l,
      );
      expect(fallos).toEqual([]);
    });

    it('respeta todas las exclusiones del dataset (0 falsos positivos)', () => {
      const fallos = NEGATIVOS.filter(([, f]) => isEmergency(f)).map(
        ([l]) => l,
      );
      expect(fallos).toEqual([]);
    });
  });

  // ── INTENT ROUTER · Tarea C: consulta_faq ──
  it('intent=consulta_faq con KB → responde vía RAG sin cambiar el estado', async () => {
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'consulta_faq' }),
    );
    provider.answerFAQ.mockResolvedValueOnce(
      'Tenemos consulta externa y laboratorio. ¿Desea agendar una cita ahora? 😊',
    );

    await service.processIncomingMessage(
      makeTextEvent('¿qué servicios tienen?'),
    );

    expect(provider.answerFAQ).toHaveBeenCalledTimes(1);
    const replies = sentMessages();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('consulta externa');
    expect(replies[0]).toContain('agendar una cita ahora');
    // El FAQ no debe alterar el estado (sigue IDLE; no entra a AWAITING_SPECIALTY).
    // El valor guardado en Redis es un string suelto, no el enum: se compara
    // contra su representación textual para no cruzar tipos.
    const state = redis.store.get(`chat_state:${ORG_ID}:${SENDER}`);
    expect(state === undefined || state === String(ChatState.IDLE)).toBe(true);
  });

  // ── Fase 3 · endurecimiento del RAG: regla 0 de emergencias ──
  // Defensa en profundidad para paráfrasis que ni el regex ni la Tarea D
  // atraparon y llegan al RAG como consulta_faq: el system prompt instruye
  // derivar a 123/urgencias en vez de responder como FAQ, sin diagnosticar
  // ni minimizar.
  it('el system prompt del RAG incluye la regla 0 de emergencias', async () => {
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'consulta_faq' }),
    );

    await service.processIncomingMessage(
      makeTextEvent('¿qué servicios tienen?'),
    );

    expect(provider.answerFAQ).toHaveBeenCalledTimes(1);
    const systemPrompt = provider.answerFAQ.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('🚨 EMERGENCIAS');
    expect(systemPrompt).toContain('*123*');
    expect(systemPrompt).toContain('no parece grave');
    // El teléfono del equipo humano queda inyectado en la regla.
    expect(systemPrompt).toContain('606 853 8838');
  });

  it('intent=consulta_faq sin KB → no llama answerFAQ (cae al flujo normal)', async () => {
    knowledgeBase.hasContent.mockResolvedValue(false);
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'consulta_faq' }),
    );

    await service.processIncomingMessage(makeTextEvent('¿tienen laboratorio?'));

    expect(provider.answerFAQ).not.toHaveBeenCalled();
  });

  // ── Defecto #2 · guardrail anti-alucinación de cupos en answerFAQ ──
  // El RAG no conoce la agenda: si afirma disponibilidad/cupos/"horario
  // especial" no respaldado por la KB, se intercepta y se redirige al flujo.
  describe('guardrail FAQ: bloquea afirmaciones de disponibilidad de cita', () => {
    beforeEach(() => {
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ intent: 'consulta_faq' }),
      );
    });

    it('intercepta el "horario especial" fabricado (bug reportado) y redirige al agendamiento', async () => {
      provider.answerFAQ.mockResolvedValueOnce(
        'Para los usuarios de Nueva EPS tenemos un horario especial de atención ' +
          'presencial de 2:00 p.m. a 3:00 p.m. ¿Desea agendar una cita ahora? 😊',
      );

      await service.processIncomingMessage(
        makeTextEvent('¿qué horario manejan para Nueva EPS?'),
      );

      const replies = sentMessages();
      expect(replies).toHaveLength(1);
      // La afirmación fabricada NO llegó al paciente.
      expect(replies[0]).not.toContain('horario especial');
      expect(replies[0]).not.toContain('2:00');
      // Se le redirige al flujo real de agendamiento.
      expect(replies[0]).toContain('Hola');
    });

    it('intercepta una oferta directa de cupo disponible', async () => {
      provider.answerFAQ.mockResolvedValueOnce(
        'Sí, tenemos un cupo disponible para mañana a las 9:00 a.m.',
      );

      await service.processIncomingMessage(
        makeTextEvent('¿hay citas para mañana?'),
      );

      const replies = sentMessages();
      expect(replies[0]).not.toContain('9:00');
      expect(replies[0]).toContain('Hola');
    });

    it('NO intercepta un horario de operación legítimo de la clínica', async () => {
      provider.answerFAQ.mockResolvedValueOnce(
        'El horario de la farmacia es de lunes a viernes de 7:00 a.m. a 8:00 p.m. ' +
          '¿Desea agendar una cita ahora? 😊',
      );

      await service.processIncomingMessage(
        makeTextEvent('¿a qué hora abre la farmacia?'),
      );

      const replies = sentMessages();
      expect(replies[0]).toContain('farmacia');
      expect(replies[0]).toContain('7:00');
    });

    it('NO intercepta "horario especial" si está documentado textualmente en la KB', async () => {
      knowledgeBase.getContent.mockResolvedValue(
        'Horario especial de festivos: los domingos permanecemos cerrados.',
      );
      provider.answerFAQ.mockResolvedValueOnce(
        'Sí, manejamos un horario especial de festivos: los domingos permanecemos ' +
          'cerrados. ¿Desea agendar una cita ahora? 😊',
      );

      await service.processIncomingMessage(
        makeTextEvent('¿abren los festivos?'),
      );

      const replies = sentMessages();
      expect(replies[0]).toContain('festivos');
    });
  });

  // ── ACK · Fase 2 + validación de cédula (Fase 3) ──
  it('agendar_cita con cédula registrada → ACK saluda por nombre y confirma datos', async () => {
    prisma.patientProfile.findFirst.mockResolvedValueOnce({
      fullName: 'Andrés Pérez',
    });
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

    // Validó la cédula contra PostgreSQL antes de confirmarla,
    // siempre dentro del tenant de la conversación.
    expect(prisma.patientProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cedula: '1088123456', organizationId: ORG_ID },
      }),
    );

    const ack = sentMessages().find((m) => m.includes('Andrés Pérez'));
    expect(ack).toBeDefined();
    expect(ack).toContain('1088123456');
    expect(ack).toContain('Cardiología');

    // Sembró el nombre para no volver a pedirlo.
    expect(redis.store.get(`temp_nombre:${ORG_ID}:${SENDER}`)).toBe(
      'Andrés Pérez',
    );
  });

  it('agendar_cita con cédula de cualquier tamaño → la acepta sin validar longitud', async () => {
    // Ya NO se valida el tamaño de la cédula: un número corto como "12" se acepta.
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'agendar_cita', cedula: '12' }),
    );

    await service.processIncomingMessage(
      makeTextEvent('agendar con cédula 12'),
    );

    // Se valida contra BD (existencia del paciente), independiente de la longitud.
    expect(prisma.patientProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cedula: '12', organizationId: ORG_ID },
      }),
    );
    // Se arrastra la cédula en sesión.
    expect(redis.store.get(`temp_cedula:${ORG_ID}:${SENDER}`)).toBe('12');
    // El ACK la presenta como confirmada.
    const ack = sentMessages()[0] || '';
    expect(ack).toContain('🪪');
  });

  // ════════════════════════════════════════════════════════════
  // Fix Problema 2 — El paso de nombre (AWAITING_NAME) NO pasa por
  // el LLM. Antes, un nombre como "Negro Test" llegaba al extractor
  // y el clasificador de seguridad podía marcarlo como insulto_abuso,
  // disparando el guardrail y borrando toda la sesión.
  // ════════════════════════════════════════════════════════════
  it('en AWAITING_NAME captura el nombre sin invocar al LLM ni disparar el guardrail', async () => {
    redis.store.set(`chat_state:${ORG_ID}:${SENDER}`, ChatState.AWAITING_NAME);
    // Aunque el LLM clasificaría este texto como insulto, NO debe ser invocado.
    provider.extractSchedulingIntent.mockResolvedValue(
      extraction({ intent: 'insulto_abuso' }),
    );

    await service.processIncomingMessage(makeTextEvent('Negro Test'));

    // Núcleo del fix: el nombre no se manda a Gemini en este paso.
    expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
    // No se disparó el guardrail de insulto ni el reinicio de sesión.
    const all = sentMessages().join('\n');
    expect(all).not.toContain('arrancamos de cero');
    expect(all).not.toContain('respetuoso');
  });

  // ════════════════════════════════════════════════════════════
  // Fix Problema 3 — El ACK del primer turno no produce doble saludo.
  // Tras el ACK, el menú de servicios usa el reprompt (sin volver a
  // presentar al bot) en vez de la bienvenida completa.
  // ════════════════════════════════════════════════════════════
  it('tras el ACK del primer turno, el menú de servicios no vuelve a saludar', async () => {
    prisma.medicalService.findMany.mockResolvedValue([
      { id: 's1', name: 'Consulta externa' },
      { id: 's2', name: 'Laboratorio clínico' },
    ]);
    // Primer turno en IDLE: el LLM extrae el nombre pero ningún servicio.
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({ intent: 'agendar_cita', nombre: 'Andres' }),
    );

    await service.processIncomingMessage(
      makeTextEvent('soy Andres y necesito una cita'),
    );

    const replies = sentMessages();
    // Dos mensajes: el ACK + el menú de servicios.
    expect(replies).toHaveLength(2);
    // El ACK saluda por nombre Y se identifica como asistente de IA.
    expect(replies[0]).toContain('Andres');
    expect(replies[0]).toContain('Geni');
    expect(replies[0]).toContain('inteligencia artificial');
    // El segundo pregunta por el servicio...
    expect(replies[1]).toContain('servicio');
    // ...pero NO vuelve a presentar al bot (el bot se presenta UNA sola vez,
    // en el ACK; el menú posterior no repite el saludo).
    expect(replies.filter((m) => m.includes('Geni'))).toHaveLength(1);
  });

  // ════════════════════════════════════════════════════════════
  // Paridad voz↔texto: si el PRIMER mensaje por VOZ trae datos del
  // paciente (cédula/EPS), el bot saluda y se identifica como
  // asistente de IA igual que por texto.
  // ════════════════════════════════════════════════════════════
  it('AUDIO: primer turno con datos → saluda y se presenta como asistente de IA', async () => {
    const makeAudioEvent = () => ({
      from: SENDER,
      type: 'audio',
      audio: { id: 'audio-ack-1' },
      metadata: { phone_number_id: PHONE_ID },
    });
    // Aislamos la descarga del audio de WhatsApp (capa HTTP/credenciales).
    jest
      .spyOn(service as any, 'resolveCredentialsForOrg')
      .mockResolvedValue({ accessToken: 'tok' });
    jest
      .spyOn(service as any, 'downloadWhatsAppAudio')
      .mockResolvedValue(Buffer.from('fake-ogg'));
    // El LLM transcribe la voz y extrae la cédula y la EPS del paciente.
    provider.extractSchedulingIntent.mockResolvedValueOnce(
      extraction({
        transcript: 'mi cédula es 1088123456 y soy de Sura',
        intent: 'agendar_cita',
        cedula: '1088123456',
        eps: 'Sura',
      }),
    );

    await service.processIncomingMessage(makeAudioEvent());

    // El ACK saluda y se presenta como asistente de IA (tras el audio se
    // envía primero un "lo estoy escuchando..."; ubicamos el ACK por contenido).
    const ack = sentMessages().find((m) =>
      m.includes('inteligencia artificial'),
    );
    expect(ack).toBeDefined();
    expect(ack).toContain('Geni');
    expect(ack).toContain('1088123456');
  });

  // ════════════════════════════════════════════════════════════
  // Fix #2 — Intención de agendar dentro del paso de menú
  // (AWAITING_SPECIALTY): "Si quiero agendar una cita" ya no cae
  // en el mensaje de "no entendí".
  // ════════════════════════════════════════════════════════════
  describe('en AWAITING_SPECIALTY', () => {
    beforeEach(() => {
      // Sesión colgada en el paso de selección de servicio.
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_SPECIALTY,
      );
      prisma.medicalService.findMany.mockResolvedValue([
        { id: 's1', name: 'Consulta externa' },
        { id: 's2', name: 'Laboratorio clínico' },
      ]);
    });

    it('afirmación de agendar → re-presenta el menú sin error ni penalizar reintentos', async () => {
      await service.processIncomingMessage(
        makeTextEvent('Si quiero agendar una cita'),
      );

      const reply = sentMessages()[0] || '';
      // Re-presentación cálida, NO el mensaje de "no logré entender".
      expect(reply).not.toContain('no logré entender');
      expect(reply).toContain('servicios');
      expect(reply).toContain('Consulta externa');
      // No se llamó al LLM (en el paso de menú no se usa).
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      // No se penalizó con reintento.
      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    it('una pregunta abierta sigue yendo a FAQ (no a re-presentación)', async () => {
      provider.answerFAQ.mockResolvedValueOnce('Una cita cuesta $50.000.');

      await service.processIncomingMessage(
        makeTextEvent('¿cuánto cuesta una cita?'),
      );

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

  // ════════════════════════════════════════════════════════════
  // Mapeo Semántico de Servicios (LLM contra catálogo real)
  // ════════════════════════════════════════════════════════════
  describe('mapeo semántico de servicio en AWAITING_SPECIALTY', () => {
    beforeEach(() => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_SPECIALTY,
      );
      // El catálogo real de la clínica.
      prisma.medicalService.findMany.mockResolvedValue([
        { id: 's1', name: 'Consulta externa' },
        { id: 's2', name: 'Laboratorio clínico' },
      ]);
      // El substring NO resuelve la frase larga.
      prisma.medicalService.findFirst.mockResolvedValue(null);
      // Hay EPS para que el siguiente paso muestre menú sin romper.
      prisma.eps.findMany.mockResolvedValue([{ id: 'e1', name: 'SURA' }]);
    });

    // Paráfrasis SIN el nombre literal de ningún servicio del catálogo: obliga
    // a usar el mapeo semántico (el match determinista por nombre la deja en null).
    const SEM_PHRASE = 'Necesito una valoración médica pronto';

    it('Caso A: frase larga se mapea al servicio y avanza a EPS', async () => {
      provider.mapEntityToCatalog.mockResolvedValueOnce({ id: 's1' });

      await service.processIncomingMessage(makeTextEvent(SEM_PHRASE));

      expect(provider.mapEntityToCatalog).toHaveBeenCalledTimes(1);
      // Servicio resuelto y persistido.
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe(
        's1',
      );
      expect(redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`)).toBe(
        'Consulta externa',
      );
      // Avanzó al paso de EPS (no se quedó en el menú de servicio ni dio error).
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_EPS,
      );
      expect(sentMessages().join('\n')).not.toContain('no logré entender');
    });

    it('anti-alucinación: id devuelto que no existe en el catálogo se descarta', async () => {
      provider.mapEntityToCatalog.mockResolvedValueOnce({
        id: 'id-inexistente',
      });

      await service.processIncomingMessage(makeTextEvent(SEM_PHRASE));

      // No se resolvió ningún servicio (id inválido descartado).
      expect(
        redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      // No avanzó a EPS; sigue en selección de servicio.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_SPECIALTY,
      );
    });

    it('Caso B: si el LLM falla, cae al flujo determinista sin romper', async () => {
      provider.mapEntityToCatalog.mockRejectedValueOnce(new Error('boom'));

      await service.processIncomingMessage(makeTextEvent(SEM_PHRASE));

      // Degradación segura: no resolvió servicio, no lanzó excepción.
      expect(
        redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(sentMessages().length).toBeGreaterThan(0);
    });

    it('no llama al mapeo semántico para una letra de menú (atajo barato)', async () => {
      // "a" resuelve por letra; no debe gastar una llamada al LLM.
      redis.store.set(`temp_service_A_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(
        `temp_service_A_name:${ORG_ID}:${SENDER}`,
        'Consulta externa',
      );

      await service.processIncomingMessage(makeTextEvent('a'));

      expect(provider.mapEntityToCatalog).not.toHaveBeenCalled();
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe(
        's1',
      );
    });

    // Regresión: la frase del usuario CONTIENE el nombre de un servicio del
    // catálogo ("quiero una consulta externa"). El match determinista por nombre
    // debe resolverlo SIN llamar al LLM (clave cuando no hay proveedor configurado).
    it('resuelve por nombre cuando la frase contiene el servicio, sin usar el LLM', async () => {
      await service.processIncomingMessage(
        makeTextEvent('quiero una consulta externa, la opción A'),
      );

      expect(provider.mapEntityToCatalog).not.toHaveBeenCalled();
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe(
        's1',
      );
      expect(redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`)).toBe(
        'Consulta externa',
      );
      // Avanzó al paso de EPS y no cayó en el loop de "no entendí"/reprompt.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_EPS,
      );
      expect(sentMessages().join('\n')).not.toContain('servicios necesitas');
    });

    // Aunque el proveedor LLM esté APAGADO (forOrgOrNull → null), el match por
    // nombre sigue funcionando. Esta era la causa raíz del loop reportado.
    it('resuelve por nombre aun sin proveedor LLM configurado', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(null);

      await service.processIncomingMessage(
        makeTextEvent('quiero una consulta externa'),
      );

      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe(
        's1',
      );
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_EPS,
      );
    });

    // Regresión (voz↔texto): un AUDIO en el paso de servicio. El LLM transcribe
    // "consulta externa" pero NO lo extrae como `especialidad` (no es una
    // especialidad médica). Antes de adoptar el transcript como `text`, la voz
    // no tenía nada que mapear (text=null) y el servicio nunca se resolvía,
    // mientras que el mismo mensaje por texto sí funcionaba. Ahora el audio
    // recorre el MISMO camino determinista: el transcript matchea el catálogo.
    it('AUDIO: el transcript resuelve el servicio aunque el LLM no extraiga la especialidad', async () => {
      const makeAudioEvent = () => ({
        from: SENDER,
        type: 'audio',
        audio: { id: 'audio-123' },
        metadata: { phone_number_id: PHONE_ID },
      });
      // Aislamos la descarga del audio de WhatsApp (capa HTTP/credenciales).
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      // El LLM transcribe la voz pero deja `especialidad` en null.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'consulta externa',
          especialidad: null,
          intent: 'agendar_cita',
        }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // El servicio se resolvió por el transcript y avanzó a EPS (igual que el texto).
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe(
        's1',
      );
      expect(redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`)).toBe(
        'Consulta externa',
      );
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_EPS,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════
  // REGRESIÓN (voz↔texto) · paso de EPS no debe desviarse a FAQ
  // Bug reportado: al decir la EPS por VOZ, el LLM clasifica el turno como
  // intent='consulta_faq' (mencionar una EPS dispara esa intención según el
  // prompt). El router global de FAQ se adelantaba al resolver del menú,
  // llamaba a answerFAQ (RAG que puede alucinar horarios/cupos) y se comía el
  // turno SIN capturar la EPS → el flujo parecía reiniciarse al paso de EPS.
  // El texto nunca sufría esto porque en los pasos de menú no llama al LLM.
  // ════════════════════════════════════════════════════════════════
  describe('voz en AWAITING_EPS — selección hablada no se desvía a FAQ', () => {
    const makeAudioEvent = () => ({
      from: SENDER,
      type: 'audio',
      audio: { id: 'audio-eps-1' },
      metadata: { phone_number_id: PHONE_ID },
    });

    beforeEach(() => {
      // Servicio YA resuelto: el paciente está en el paso de EPS.
      redis.store.set(`chat_state:${ORG_ID}:${SENDER}`, ChatState.AWAITING_EPS);
      redis.store.set(`temp_especialidad_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(
        `temp_especialidad:${ORG_ID}:${SENDER}`,
        'Consulta externa',
      );
      // Catálogo de EPS de la clínica (incluye la que el paciente dirá por voz).
      prisma.eps.findMany.mockResolvedValue([{ id: 'e1', name: 'Nueva EPS' }]);

      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
    });

    it('AUDIO "Nueva EPS" con intent=consulta_faq → resuelve la EPS, NO llama answerFAQ', async () => {
      // El LLM transcribe la EPS pero la clasifica como consulta_faq (el bug).
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'Nueva EPS',
          eps: null,
          intent: 'consulta_faq',
        }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // El turno NO se desvió al RAG: nunca se llamó answerFAQ.
      expect(provider.answerFAQ).not.toHaveBeenCalled();
      // La EPS se capturó por el transcript (igual que el texto).
      expect(redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`)).toBe('e1');
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Nueva EPS',
      );
      // Avanzó más allá del paso de EPS (sin slots → opt-in a lista de espera).
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_WAITLIST_OPTIN,
      );
    });

    it('AUDIO con pregunta abierta (no mapea a EPS) SÍ responde FAQ sin perder el estado', async () => {
      // El paciente realmente pregunta algo: el transcript no mapea a ninguna EPS.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: '¿qué documentos necesito?',
          eps: null,
          intent: 'consulta_faq',
        }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // La FAQ legítima sí se atiende (vía el resolver del menú, classifyIntentLocal)…
      expect(provider.answerFAQ).toHaveBeenCalledTimes(1);
      // …y NO se pierde el progreso: sigue esperando la EPS.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_EPS,
      );
      expect(
        redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    // ── REGRESIÓN (loop de voz en EPS) ──────────────────────────────
    // El LLM, sin contexto conversacional, marca una EPS hablada suelta como
    // outOfContext/ininteligible. Los guardas globales cortaban el turno ANTES
    // del resolver del menú → el paciente regrababa y volvía a fallar (loop).
    // Ahora la voz en pasos de menú salta esos guardas y llega al resolver.
    it('AUDIO "Nueva EPS" con outOfContext=true → resuelve la EPS, NO reprompta fuera de contexto', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'Nueva EPS',
          eps: null,
          intent: 'otro',
          outOfContext: true,
        }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // No se disparó el reprompt de "fuera de contexto" (no incrementa reintentos).
      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      // La EPS se capturó por el transcript (igual que el texto).
      expect(redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`)).toBe('e1');
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Nueva EPS',
      );
      // Avanzó más allá del paso de EPS (sin slots → opt-in a lista de espera).
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_WAITLIST_OPTIN,
      );
    });

    it('AUDIO "Nueva EPS" con ininteligible=true → resuelve la EPS, NO reprompta "no entendí"', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'Nueva EPS',
          eps: null,
          intent: 'otro',
          ininteligible: true,
        }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`)).toBe('e1');
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Nueva EPS',
      );
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_WAITLIST_OPTIN,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════
  // PREFERENCIA DE FECHA ("quiero una cita para mañana")
  // El paciente expresa una fecha en lenguaje natural; el sistema filtra los
  // cupos a esa ventana. Si no hay ese día pero sí próximos → fallback suave;
  // si no hay ninguno → lista de espera (conducta actual); sin preferencia o
  // frase no reconocida → conducta histórica intacta.
  // ════════════════════════════════════════════════════════════════
  describe('preferencia de fecha en el paso de cupos', () => {
    const slots = () =>
      (service as any).appointmentsService.getAvailableSlots as jest.Mock;

    const sampleSlot = {
      slotId: 'slot-X',
      fecha: new Date('2026-06-05T15:00:00.000Z'),
      doctor: 'Pérez',
      servicio: 'Consulta externa',
    };

    const fechaPrefKey = `temp_fecha_pref:${ORG_ID}:${SENDER}`;
    const stateKey = `chat_state:${ORG_ID}:${SENDER}`;

    beforeEach(() => {
      // Servicio ya resuelto: el paciente está en el paso de EPS. Al decir la
      // EPS, el flujo avanza al paso de cupos en el mismo turno.
      redis.store.set(stateKey, ChatState.AWAITING_EPS);
      redis.store.set(`temp_especialidad_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(
        `temp_especialidad:${ORG_ID}:${SENDER}`,
        'Consulta externa',
      );
      prisma.eps.findMany.mockResolvedValue([{ id: 'e1', name: 'Nueva EPS' }]);
    });

    const sayEps = () =>
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ eps: 'Nueva EPS' }),
      );

    it('con fecha preferida y cupos ese día → filtra por ventana y muestra "para <fecha>"', async () => {
      redis.store.set(fechaPrefKey, 'mañana');
      slots().mockResolvedValueOnce([sampleSlot]);
      sayEps();

      await service.processIncomingMessage(makeTextEvent('Nueva EPS'));

      // Se llamó UNA vez, con la ventana de fecha como 4º argumento.
      expect(slots()).toHaveBeenCalledTimes(1);
      const window = slots().mock.calls[0][3];
      expect(window).toBeTruthy();
      expect(window.desde).toBeInstanceOf(Date);
      expect(window.hasta).toBeInstanceOf(Date);
      // El menú nombra la fecha pedida y deja al paciente en selección de letra.
      expect(sentMessages().join('\n')).toContain('mañana');
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`temp_slot_A:${ORG_ID}:${SENDER}`)).toBe('slot-X');
    });

    it('con fecha preferida SIN cupos ese día pero con próximos → fallback suave (no waitlist)', async () => {
      redis.store.set(fechaPrefKey, 'mañana');
      slots()
        .mockResolvedValueOnce([]) // ventana: vacío
        .mockResolvedValueOnce([sampleSlot]); // próximos: hay
      sayEps();

      await service.processIncomingMessage(makeTextEvent('Nueva EPS'));

      // Dos llamadas: primero con ventana, luego sin ventana (próximos).
      expect(slots()).toHaveBeenCalledTimes(2);
      expect(slots().mock.calls[0][3]).toBeTruthy();
      expect(slots().mock.calls[1][3]).toBeUndefined();
      // No cae a lista de espera: ofrece horarios y espera la letra.
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`temp_slot_A:${ORG_ID}:${SENDER}`)).toBe('slot-X');
    });

    it('con fecha preferida y NINGÚN cupo (ni próximos) → lista de espera (conducta actual)', async () => {
      redis.store.set(fechaPrefKey, 'mañana');
      // El mock por defecto devuelve [] en ambas llamadas.
      sayEps();

      await service.processIncomingMessage(makeTextEvent('Nueva EPS'));

      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_WAITLIST_OPTIN);
    });

    it('SIN fecha preferida → conducta histórica (getAvailableSlots sin ventana)', async () => {
      slots().mockResolvedValueOnce([sampleSlot]);
      sayEps();

      await service.processIncomingMessage(makeTextEvent('Nueva EPS'));

      expect(slots()).toHaveBeenCalledTimes(1);
      expect(slots().mock.calls[0][3]).toBeUndefined();
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_DATE);
    });

    it('persistencia: fechaSolicitada extraída por el LLM se guarda para turnos siguientes', async () => {
      // En el primer turno (IDLE) el LLM SÍ corre y extrae la fecha. En los
      // pasos de menú el texto no llama al LLM, así que la preferencia debe
      // quedar persistida aquí para sobrevivir la cascada servicio→EPS→slots.
      redis.store.set(stateKey, ChatState.IDLE);
      redis.store.delete(`temp_especialidad_id:${ORG_ID}:${SENDER}`);
      redis.store.delete(`temp_especialidad:${ORG_ID}:${SENDER}`);
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ fechaSolicitada: 'mañana', intent: 'agendar_cita' }),
      );

      await service.processIncomingMessage(
        makeTextEvent('quiero una cita para mañana'),
      );

      expect(redis.store.get(fechaPrefKey)).toBe('mañana');
    });

    it('paridad por voz: "para mañana" hablado filtra igual que el texto', async () => {
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));

      redis.store.set(fechaPrefKey, 'mañana');
      slots().mockResolvedValueOnce([sampleSlot]);
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'Nueva EPS', eps: 'Nueva EPS' }),
      );

      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'audio-pref-1' },
        metadata: { phone_number_id: PHONE_ID },
      });

      expect(slots().mock.calls[0][3]).toBeTruthy();
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_DATE);
    });

    it('cleanUpSession borra la preferencia de fecha', async () => {
      redis.store.set(fechaPrefKey, 'mañana');
      await (service as any).cleanUpSession(ORG_ID, SENDER);
      expect(redis.store.get(fechaPrefKey)).toBeUndefined();
    });

    it('voz "mañana a las 10": casa un cupo único por día+hora → salta el menú y pide la cédula', async () => {
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));

      // sampleSlot cae a las 10:00 de Bogotá (2026-06-05T15:00Z).
      redis.store.set(fechaPrefKey, 'mañana a las 10');
      slots().mockResolvedValueOnce([sampleSlot]);
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'Nueva EPS', eps: 'Nueva EPS' }),
      );

      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'audio-match-1' },
        metadata: { phone_number_id: PHONE_ID },
      });

      // Saltó el menú de letras (nunca se persistió temp_slot_A) y dejó el cupo
      // seleccionado, avanzando a pedir la cédula (el resumen confirmará).
      expect(
        redis.store.get(`temp_slot_A:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`)).toBe(
        'slot-X',
      );
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_CEDULA);
    });

    it('voz: el audio LEE las próximas opciones ("opción A ... con el Doctor Pérez")', async () => {
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok', isActive: true });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      const ttsSpy = jest
        .spyOn(service as any, 'generateTTS')
        .mockResolvedValue(null);

      const slotB = {
        slotId: 'slot-Y',
        fecha: new Date('2026-06-06T16:00:00.000Z'),
        doctor: 'Gómez',
        servicio: 'Consulta externa',
      };
      // Sin fecha preferida: dos cupos y el audio debe leerlos (no solo anunciar).
      slots().mockResolvedValueOnce([sampleSlot, slotB]);
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'Nueva EPS', eps: 'Nueva EPS' }),
      );

      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'audio-read-1' },
        metadata: { phone_number_id: PHONE_ID },
      });

      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_DATE);
      const spoken = ttsSpy.mock.calls
        .map((c: any[]) => c[1] as string)
        .join('\n');
      expect(spoken).toContain('opción A');
      expect(spoken).toContain('opción B');
      expect(spoken).toContain('Pérez');
    });
  });

  // ════════════════════════════════════════════════════════════════
  // Selección de HORARIO por VOZ (AWAITING_DATE)
  // Regresión: decir la letra por audio se rechazaba como "paso estricto"
  // ("por favor escríbalo"). Ahora la voz se transcribe y la letra se
  // normaliza (extractOptionLetter), igual que el texto.
  // ════════════════════════════════════════════════════════════════
  describe('voz en AWAITING_DATE — elegir el horario diciendo la letra', () => {
    const makeAudioEvent = (id = 'audio-slot-1') => ({
      from: SENDER,
      type: 'audio',
      audio: { id },
      metadata: { phone_number_id: PHONE_ID },
    });

    beforeEach(() => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_DATE,
      );
      // Menú de horarios ya presentado: dos opciones A y B.
      redis.store.set(`temp_slot_A:${ORG_ID}:${SENDER}`, 'slot-A');
      redis.store.set(
        `temp_slot_A_fecha:${ORG_ID}:${SENDER}`,
        new Date('2026-06-01T15:00:00Z').toISOString(),
      );
      redis.store.set(`temp_slot_B:${ORG_ID}:${SENDER}`, 'slot-B');
      redis.store.set(
        `temp_slot_B_fecha:${ORG_ID}:${SENDER}`,
        new Date('2026-06-02T16:00:00Z').toISOString(),
      );

      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok', isActive: true });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
    });

    it('AUDIO "la a" selecciona el horario A y NO rechaza el audio como paso estricto', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'la a', intent: 'otro' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // No se rechazó el audio (nunca apareció el reprompt de "escríbalo").
      expect(sentMessages().join('\n').toLowerCase()).not.toContain('escríba');
      // El horario A quedó seleccionado y avanzó a pedir la cédula.
      expect(redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`)).toBe(
        'slot-A',
      );
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_CEDULA,
      );
    });

    it('AUDIO "be" (nombre fonético) selecciona el horario B', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'be', intent: 'otro' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      expect(redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`)).toBe(
        'slot-B',
      );
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_CEDULA,
      );
    });

    it('AUDIO que transcribe una EPS alucinada NO contamina el contexto: solo cuenta la letra', async () => {
      // El LLM, sin contexto, devuelve transcript con letra pero marca una EPS.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({
          transcript: 'la a',
          eps: 'Sura',
          especialidad: 'Cardiología',
          intent: 'consulta_faq',
        }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // No se desvió a FAQ ni se persistió la EPS/especialidad alucinada.
      expect(provider.answerFAQ).not.toHaveBeenCalled();
      expect(
        redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(
        redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      // Y sí seleccionó el horario A.
      expect(redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`)).toBe(
        'slot-A',
      );
    });

    it('AUDIO "las diez de la mañana" (sin letra) casa el cupo por hora → horario A', async () => {
      // Slot A = 10:00 Bogotá (2026-06-01T15:00Z); Slot B = 11:00 Bogotá.
      // El paciente no dice la letra: identifica el cupo por su hora.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'las diez de la mañana', intent: 'otro' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      expect(sentMessages().join('\n').toLowerCase()).not.toContain('escríba');
      expect(redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`)).toBe(
        'slot-A',
      );
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_CEDULA,
      );
    });

    it('AUDIO con hora AMBIGUA entre cupos → no adivina: reintenta pidiendo la letra', async () => {
      // Ambos slots caen en la "mañana"; sin hora concreta el match es ambiguo.
      redis.store.set(
        `temp_slot_B_fecha:${ORG_ID}:${SENDER}`,
        new Date('2026-06-01T15:30:00Z').toISOString(), // también 10:xx Bogotá
      );
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'la de las diez', intent: 'otro' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // No seleccionó ningún cupo (ambiguo) y sigue en AWAITING_DATE.
      expect(
        redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_DATE,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════
  // Lista de espera — SÍ/NO por texto y voz + cédula sin validar tamaño
  // ════════════════════════════════════════════════════════════════
  describe('lista de espera: SÍ/NO por texto y voz, cédula de cualquier tamaño', () => {
    const makeAudioEvent = (id = 'audio-wl-1') => ({
      from: SENDER,
      type: 'audio',
      audio: { id },
      metadata: { phone_number_id: PHONE_ID },
    });

    it('interpretYesNo reconoce afirmaciones/negaciones de texto y voz', () => {
      const yn = (t: string) => (service as any).interpretYesNo(t);
      // Afirmaciones (incluye variantes habladas con tildes y muletillas).
      expect(yn('Sí')).toBe('SI');
      expect(yn('si')).toBe('SI');
      expect(yn('Sí, claro')).toBe('SI');
      expect(yn('dale')).toBe('SI');
      expect(yn('Acepto')).toBe('SI');
      // Negaciones.
      expect(yn('No')).toBe('NO');
      expect(yn('No, gracias')).toBe('NO');
      expect(yn('negativo')).toBe('NO');
      // "no" gana cuando aparece junto a una palabra afirmativa.
      expect(yn('no quiero')).toBe('NO');
      // Sin señal clara → null.
      expect(yn('quizás mañana')).toBeNull();
      expect(yn('')).toBeNull();
    });

    it('AWAITING_WAITLIST_OPTIN acepta "No" por VOZ (no rechaza el audio)', async () => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_WAITLIST_OPTIN,
      );
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'No, gracias' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      const all = sentMessages().join('\n');
      // El audio NO fue rechazado como "paso estricto" (mensaje audioPasoEstricto).
      expect(all).not.toContain('por *texto*');
      // Se interpretó como NO → respuesta de declinación (invita a escribir "Hola")
      // y sesión cerrada (estado reseteado a IDLE).
      expect(all).toContain('Hola');
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.IDLE,
      );
    });

    it('opt-in a lista de espera acepta una cédula corta ("12") sin validar tamaño', async () => {
      // Contexto de un opt-in ya aceptado: faltaba la cédula.
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_CEDULA,
      );
      redis.store.set(`temp_waitlist_pending:${ORG_ID}:${SENDER}`, '1');
      redis.store.set(`temp_waitlist_service_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(`temp_especialidad:${ORG_ID}:${SENDER}`, 'Cardiología');
      // Paciente nuevo (no existe en BD) → debe pedir el nombre, NO rechazar la cédula.
      prisma.patientProfile.findFirst.mockResolvedValueOnce(null);

      await service.processIncomingMessage(makeTextEvent('12'));

      const all = sentMessages().join('\n');
      // La cédula corta NO se rechaza por tamaño.
      expect(all).not.toContain('cédula válida');
      expect(all).not.toContain('no logré identificar');
      // Avanza pidiendo el nombre del paciente nuevo (cédula aceptada).
      expect(all).toContain('nombre completo');
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_NAME,
      );
    });

    // ── REGRESIÓN (loop de cédula por voz en waitlist) ──────────────
    // El STT transcribe la cédula con ruido (muletillas, separadores, números
    // en palabras). El LLM no siempre devuelve `cedula` limpia → finalCedula
    // queda null → el short-circuit de waitlist-pending se salta y el flujo
    // recae en la oferta de lista de espera (SÍ/NO) en bucle. Ahora la voz en
    // el paso de cédula se normaliza igual que el texto.
    it('AUDIO cédula con ruido de STT ("mi cédula es 10 88 12 34") → la normaliza y avanza (NO loop SÍ/NO)', async () => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_CEDULA,
      );
      redis.store.set(`temp_waitlist_pending:${ORG_ID}:${SENDER}`, '1');
      redis.store.set(`temp_waitlist_service_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(`temp_especialidad:${ORG_ID}:${SENDER}`, 'Cardiología');
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      // El LLM transcribe pero NO extrae la cédula como entidad limpia.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'mi cédula es 10 88 12 34', cedula: null }),
      );
      // Paciente nuevo → debe pedir el nombre (cédula aceptada), no reabrir SÍ/NO.
      prisma.patientProfile.findFirst.mockResolvedValue(null);

      await service.processIncomingMessage(makeAudioEvent());

      // La cédula se extrajo de la voz → avanza a pedir el nombre.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_NAME,
      );
      // NO recayó en el bucle de la oferta de lista de espera.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).not.toBe(
        ChatState.AWAITING_WAITLIST_OPTIN,
      );
    });

    it('AUDIO en cédula sin dígitos ("no sé bien") → pide por TEXTO con reintento, NO reabre SÍ/NO', async () => {
      redis.store.set(
        `chat_state:${ORG_ID}:${SENDER}`,
        ChatState.AWAITING_CEDULA,
      );
      redis.store.set(`temp_waitlist_pending:${ORG_ID}:${SENDER}`, '1');
      redis.store.set(`temp_waitlist_service_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(`temp_especialidad:${ORG_ID}:${SENDER}`, 'Cardiología');
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ accessToken: 'tok' });
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('fake-ogg'));
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'no sé bien', cedula: null }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // No avanzó ni reabrió la oferta de lista de espera: sigue esperando la cédula.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_CEDULA,
      );
      // Reintento acotado registrado (no loop silencioso).
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('1');
    });

    it('extractCedulaFromSpeech normaliza ruido de STT (separadores y números en palabras)', () => {
      const extract = (t: string) =>
        (service as any).extractCedulaFromSpeech(t);
      expect(extract('mi cédula es 10 88 12 34')).toBe('10881234');
      expect(extract('1.088.123.456')).toBe('1088123456');
      expect(extract('uno cero ocho ocho uno dos')).toBe('108812');
      expect(extract('es uno cero, ocho ocho')).toBe('1088');
      expect(extract('no sé')).toBe('');
      expect(extract('')).toBe('');
    });

    it('extractOptionLetter reconoce la letra elegida por texto y por voz', () => {
      const letra = (t: string) => (service as any).extractOptionLetter(t);
      // Texto directo.
      expect(letra('A')).toBe('A');
      expect(letra('b')).toBe('B');
      expect(letra('A)')).toBe('A');
      // Voz: nombre fonético de la letra (lo que transcribe el STT).
      expect(letra('be')).toBe('B');
      expect(letra('ce')).toBe('C');
      expect(letra('efe')).toBe('F');
      expect(letra('hache')).toBe('H');
      // Voz: muletillas para vocales.
      expect(letra('ah')).toBe('A');
      expect(letra('eh.')).toBe('E');
      // Voz: con prefijo "opción/letra/la".
      expect(letra('la a')).toBe('A');
      expect(letra('opción dos')).toBe('B');
      expect(letra('la primera')).toBe('A');
      // No reconoce ruido ni nombres de servicio/EPS (cae a otros resolvers).
      expect(letra('quiero la de las tres de la tarde con ese doctor')).toBe(
        '',
      );
      expect(letra('sura')).toBe('');
      expect(letra('')).toBe('');
    });
  });

  // ════════════════════════════════════════════════════════════
  // Interceptor de cancelación + interrupción amable + CSAT
  // (Escenarios 1, 2 y 3)
  // ════════════════════════════════════════════════════════════
  describe('interceptor global de cancelación e interrupción del agendamiento', () => {
    const stateKey = `chat_state:${ORG_ID}:${SENDER}`;
    const prevStateKey = `temp_interrupt_prev_state:${ORG_ID}:${SENDER}`;

    it('Escenario 1: "cancelar cita" en IDLE enruta directo a recolección de cédula', async () => {
      // IDLE por defecto (sin estado sembrado).
      await service.processIncomingMessage(makeTextEvent('cancelar cita'));

      // No pide confirmación: arranca el flujo de cancelación pidiendo la cédula.
      const all = sentMessages().join('\n');
      expect(all.toLowerCase()).toContain('cédula');
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_CANCEL_CEDULA);
      // El detector por patrón no necesita gastar una llamada al LLM.
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
    });

    it('Escenario 2: "cancelar cita" agendando NO aborta — pide confirmación y guarda el estado previo', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_SPECIALTY);

      await service.processIncomingMessage(makeTextEvent('cancelar cita'));

      const all = sentMessages().join('\n');
      expect(all).toContain('interrumpir'); // texto FORMAL de interrupcionAgendamiento
      // Transición al estado puente y memoria del estado interrumpido.
      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_INTERRUPT_CONFIRMATION,
      );
      expect(redis.store.get(prevStateKey)).toBe(ChatState.AWAITING_SPECIALTY);
      // No se gastó LLM ni se limpió la sesión de agendamiento.
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
    });

    it('Escenario 2: SÍ confirma la interrupción → pasa al flujo de cancelación', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_INTERRUPT_CONFIRMATION);
      redis.store.set(prevStateKey, ChatState.AWAITING_DATE);

      await service.processIncomingMessage(makeTextEvent('sí'));

      const all = sentMessages().join('\n');
      expect(all.toLowerCase()).toContain('cédula');
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_CANCEL_CEDULA);
      // El rastro del estado previo se descarta al confirmar.
      expect(redis.store.get(prevStateKey)).toBeUndefined();
    });

    it('Escenario 2: NO restaura el estado anterior y retoma el agendamiento', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_INTERRUPT_CONFIRMATION);
      redis.store.set(prevStateKey, ChatState.AWAITING_EPS);

      await service.processIncomingMessage(makeTextEvent('no'));

      // Vuelve EXACTAMENTE al paso donde estaba el paciente.
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_EPS);
      expect(redis.store.get(prevStateKey)).toBeUndefined();
      const all = sentMessages().join('\n');
      expect(all.toLowerCase()).toContain('agendamiento');
    });

    it('Escenario 3: declinar el reagendamiento tras cancelar dispara la encuesta CSAT (CANCELLED)', async () => {
      const surveySpy = jest
        .spyOn(service as any, 'sendSurveyLink')
        .mockResolvedValue(undefined);
      redis.store.set(stateKey, ChatState.AWAITING_POST_CANCEL_CHOICE);

      await service.processIncomingMessage(makeTextEvent('no'));

      expect(surveySpy).toHaveBeenCalledTimes(1);
      // Tercer argumento de sendSurveyLink = ResolutionStatus.CANCELLED.
      expect(surveySpy.mock.calls[0][2]).toBe('CANCELLED');
    });

    // ── Loop de reintento de cédula en cancelación (sin citas) ──
    describe('loop de reintento de cédula (cancelación sin citas)', () => {
      beforeEach(() => {
        prisma.patientProfile.findFirst = jest.fn(() => ({
          id: 'pat-1',
          fullName: 'Ana Gómez',
          cedula: '12345',
          organizationId: ORG_ID,
        }));
        prisma.appointment = { findMany: jest.fn(() => []) };
        prisma.$transaction = jest.fn((arg: any) =>
          typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
        );
      });

      it('cédula sin citas → ofrece consultar con otra cédula (entra al loop)', async () => {
        redis.store.set(stateKey, ChatState.AWAITING_CANCEL_CEDULA);
        prisma.appointment.findMany.mockResolvedValueOnce([]);

        await service.processIncomingMessage(makeTextEvent('12345'));

        expect(sentMessages().join('\n').toLowerCase()).toContain(
          'otra cédula',
        );
        expect(redis.store.get(stateKey)).toBe(
          ChatState.AWAITING_CANCEL_RETRY_CEDULA,
        );
      });

      it('SÍ vuelve a pedir la cédula (AWAITING_CANCEL_CEDULA)', async () => {
        redis.store.set(stateKey, ChatState.AWAITING_CANCEL_RETRY_CEDULA);

        await service.processIncomingMessage(makeTextEvent('sí'));

        expect(redis.store.get(stateKey)).toBe(
          ChatState.AWAITING_CANCEL_CEDULA,
        );
        expect(sentMessages().join('\n').toLowerCase()).toContain('cédula');
      });

      it('NO cierra el chat sin tocar nada', async () => {
        redis.store.set(stateKey, ChatState.AWAITING_CANCEL_RETRY_CEDULA);

        await service.processIncomingMessage(makeTextEvent('no'));

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(redis.store.get(stateKey)).toBe(ChatState.IDLE);
      });

      it('enviar otra cédula directamente la consulta sin exigir SÍ previo', async () => {
        redis.store.set(stateKey, ChatState.AWAITING_CANCEL_RETRY_CEDULA);
        prisma.appointment.findMany.mockResolvedValueOnce([]); // tampoco tiene citas → re-loop

        await service.processIncomingMessage(makeTextEvent('98765'));

        expect(prisma.patientProfile.findFirst).toHaveBeenCalled();
        expect(redis.store.get(stateKey)).toBe(
          ChatState.AWAITING_CANCEL_RETRY_CEDULA,
        );
      });

      it('respuesta ambigua (ni SÍ/NO ni cédula) re-pregunta sin cerrar', async () => {
        redis.store.set(stateKey, ChatState.AWAITING_CANCEL_RETRY_CEDULA);

        await service.processIncomingMessage(makeTextEvent('tal vez'));

        expect(redis.store.get(stateKey)).toBe(
          ChatState.AWAITING_CANCEL_RETRY_CEDULA,
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // Flujo de MODIFICACIÓN / REPROGRAMACIÓN de cita
  // ════════════════════════════════════════════════════════════
  describe('flujo de modificación (reprogramación de fecha)', () => {
    const stateKey = `chat_state:${ORG_ID}:${SENDER}`;

    // $transaction soporta tanto el array de promesas (cancelación) como el
    // callback (reprogramación atómica). En el callback pasamos `prisma` como tx.
    const setupTxAndModels = () => {
      prisma.patientProfile.findFirst = jest.fn(() => ({
        id: 'pat-1',
        fullName: 'Ana Gómez',
        cedula: '12345',
        organizationId: ORG_ID,
      }));
      prisma.appointment = {
        findMany: jest.fn(() => []),
        findUnique: jest.fn(() => null),
        update: jest.fn(() => ({})),
      };
      prisma.scheduleSlot = {
        findUnique: jest.fn(() => null),
        update: jest.fn(() => ({})),
      };
      prisma.$transaction = jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      );
    };

    const slots = () =>
      (service as any).appointmentsService.getAvailableSlots as jest.Mock;

    beforeEach(() => {
      setupTxAndModels();
    });

    it('detección por patrón: "cambiar mi cita" en IDLE pide la cédula sin gastar LLM', async () => {
      await service.processIncomingMessage(makeTextEvent('cambiar mi cita'));

      expect(sentMessages().join('\n').toLowerCase()).toContain('cédula');
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_MODIFY_CEDULA);
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
    });

    it('"reprogramar" también dispara el flujo de modificación', async () => {
      await service.processIncomingMessage(makeTextEvent('reprogramar'));
      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_MODIFY_CEDULA);
    });

    it('cédula sin citas próximas → ofrece consultar con otra cédula (entra al loop)', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_CEDULA);
      prisma.appointment.findMany.mockResolvedValueOnce([]);

      await service.processIncomingMessage(makeTextEvent('12345'));

      expect(sentMessages().join('\n').toLowerCase()).toContain('otra cédula');
      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_MODIFY_RETRY_CEDULA,
      );
    });

    it('loop: SÍ a "otra cédula" vuelve a pedir la cédula (AWAITING_MODIFY_CEDULA)', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_RETRY_CEDULA);

      await service.processIncomingMessage(makeTextEvent('sí'));

      expect(redis.store.get(stateKey)).toBe(ChatState.AWAITING_MODIFY_CEDULA);
      expect(sentMessages().join('\n').toLowerCase()).toContain('cédula');
    });

    it('loop: NO cierra el chat sin tocar nada del paciente', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_RETRY_CEDULA);

      await service.processIncomingMessage(makeTextEvent('no'));

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(redis.store.get(stateKey)).toBe(ChatState.IDLE);
    });

    it('loop: enviar otra cédula directamente la consulta sin exigir SÍ previo', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_RETRY_CEDULA);
      // La nueva cédula tampoco tiene citas → vuelve a ofrecer el loop.
      prisma.appointment.findMany.mockResolvedValueOnce([]);

      await service.processIncomingMessage(makeTextEvent('98765'));

      expect(prisma.patientProfile.findFirst).toHaveBeenCalled();
      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_MODIFY_RETRY_CEDULA,
      );
    });

    it('loop: respuesta ambigua (ni SÍ/NO ni cédula) re-pregunta sin cerrar', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_RETRY_CEDULA);

      await service.processIncomingMessage(makeTextEvent('tal vez'));

      // No cierra ni avanza: sigue esperando SÍ/NO en el mismo estado.
      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_MODIFY_RETRY_CEDULA,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('una cita con cupos disponibles → ofrece nuevos horarios (AWAITING_MODIFY_NEW_SLOT)', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_CEDULA);
      prisma.appointment.findMany.mockResolvedValueOnce([
        {
          id: 'apt-1',
          scheduleSlotId: 'slot-old',
          epsId: null,
          scheduleSlot: {
            startTime: new Date('2026-06-01T09:00:00Z'),
            doctor: { fullName: 'Pérez' },
            service: { name: 'Cardiología' },
          },
        },
      ]);
      prisma.appointment.findUnique.mockResolvedValueOnce({
        id: 'apt-1',
        scheduleSlotId: 'slot-old',
        epsId: null,
        scheduleSlot: {
          startTime: new Date('2026-06-01T09:00:00Z'),
          doctor: { fullName: 'Pérez' },
          service: { name: 'Cardiología' },
        },
      });
      slots().mockResolvedValueOnce([
        {
          slotId: 'slot-new',
          fecha: new Date('2026-06-05T15:00:00Z'),
          doctor: 'Pérez',
          servicio: 'Cardiología',
        },
      ]);

      await service.processIncomingMessage(makeTextEvent('12345'));

      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_MODIFY_NEW_SLOT,
      );
      expect(redis.store.get(`temp_modify_newslot_A:${ORG_ID}:${SENDER}`)).toBe(
        'slot-new',
      );
    });

    it('una cita SIN cupos alternativos → ofrece cancelarla (AWAITING_MODIFY_NO_SLOTS_CANCEL)', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_CEDULA);
      prisma.appointment.findMany.mockResolvedValueOnce([
        {
          id: 'apt-1',
          scheduleSlotId: 'slot-old',
          epsId: null,
          scheduleSlot: {
            startTime: new Date('2026-06-01T09:00:00Z'),
            doctor: { fullName: 'Pérez' },
            service: { name: 'Cardiología' },
          },
        },
      ]);
      prisma.appointment.findUnique.mockResolvedValueOnce({
        id: 'apt-1',
        scheduleSlotId: 'slot-old',
        epsId: null,
        scheduleSlot: {
          startTime: new Date('2026-06-01T09:00:00Z'),
          doctor: { fullName: 'Pérez' },
          service: { name: 'Cardiología' },
        },
      });
      // El único slot devuelto es el que ya tiene → se filtra → sin candidatos.
      slots().mockResolvedValueOnce([
        {
          slotId: 'slot-old',
          fecha: new Date('2026-06-01T09:00:00Z'),
          doctor: 'Pérez',
          servicio: 'Cardiología',
        },
      ]);

      await service.processIncomingMessage(makeTextEvent('12345'));

      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL,
      );
      // Ambas variantes del mensaje ofrecen cancelar la cita.
      expect(sentMessages().join('\n').toLowerCase()).toContain('cancel');
    });

    it('sin cupos + NO → conserva la cita intacta (no toca la BD)', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL);
      redis.store.set(`temp_selected_modify_apt:${ORG_ID}:${SENDER}`, 'apt-1');
      redis.store.set(
        `temp_selected_modify_slot:${ORG_ID}:${SENDER}`,
        'slot-old',
      );

      await service.processIncomingMessage(makeTextEvent('no'));

      // No se canceló nada.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(redis.store.get(stateKey)).toBe(ChatState.IDLE);
      // Ambas variantes confirman que la cita queda sin cambios y ofrecen seguir ayudando.
      expect(sentMessages().join('\n').toLowerCase()).toContain('algo más');
    });

    it('sin cupos + SÍ → cancela la cita y pasa a ofrecer reagendar', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL);
      redis.store.set(`temp_selected_modify_apt:${ORG_ID}:${SENDER}`, 'apt-1');
      redis.store.set(
        `temp_selected_modify_slot:${ORG_ID}:${SENDER}`,
        'slot-old',
      );
      prisma.scheduleSlot.findUnique.mockResolvedValueOnce({
        id: 'slot-old',
        serviceId: 'svc-1',
        allowedEpsId: null,
        startTime: new Date('2026-06-01T09:00:00Z'),
        doctor: { fullName: 'Pérez' },
        service: { name: 'Cardiología' },
      });

      await service.processIncomingMessage(makeTextEvent('sí'));

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-1' },
          data: { status: 'CANCELLED' },
        }),
      );
      expect(redis.store.get(stateKey)).toBe(
        ChatState.AWAITING_POST_CANCEL_CHOICE,
      );
    });

    it('confirmación SÍ → mueve la cita al nuevo cupo (reprogramación atómica)', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_CONFIRM);
      redis.store.set(`temp_selected_modify_apt:${ORG_ID}:${SENDER}`, 'apt-1');
      redis.store.set(
        `temp_selected_modify_slot:${ORG_ID}:${SENDER}`,
        'slot-old',
      );
      redis.store.set(
        `temp_selected_modify_newslot:${ORG_ID}:${SENDER}`,
        'slot-new',
      );
      redis.store.set(
        `temp_selected_modify_newslot_fecha:${ORG_ID}:${SENDER}`,
        '2026-06-05T15:00:00.000Z',
      );
      prisma.scheduleSlot.findUnique
        .mockResolvedValueOnce({
          id: 'slot-new',
          isAvailable: true,
          organizationId: ORG_ID,
          // El reagendamiento revalida el interruptor del médico antes de
          // mover la cita (bloque E), así que la consulta real lo incluye.
          doctor: { whatsappBookingEnabled: true },
        }) // validación en tx
        .mockResolvedValueOnce({
          id: 'slot-old',
          serviceId: 'svc-1',
          allowedEpsId: null,
          startTime: new Date(),
          doctor: { fullName: 'Pérez' },
        }); // cupo liberado

      await service.processIncomingMessage(makeTextEvent('sí'));

      // La cita se reasigna al nuevo slot; el viejo se libera y el nuevo se ocupa.
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-1' },
          data: { scheduleSlotId: 'slot-new' },
        }),
      );
      expect(prisma.scheduleSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-old' },
          data: { isAvailable: true },
        }),
      );
      expect(prisma.scheduleSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-new' },
          data: { isAvailable: false },
        }),
      );
      expect(redis.store.get(stateKey)).toBe(ChatState.IDLE);
    });

    it('confirmación NO → deja la cita en su fecha original, sin escribir en BD', async () => {
      redis.store.set(stateKey, ChatState.AWAITING_MODIFY_CONFIRM);
      redis.store.set(`temp_selected_modify_apt:${ORG_ID}:${SENDER}`, 'apt-1');
      redis.store.set(
        `temp_selected_modify_slot:${ORG_ID}:${SENDER}`,
        'slot-old',
      );
      redis.store.set(
        `temp_selected_modify_newslot:${ORG_ID}:${SENDER}`,
        'slot-new',
      );
      redis.store.set(
        `temp_selected_modify_newslot_fecha:${ORG_ID}:${SENDER}`,
        '2026-06-05T15:00:00.000Z',
      );

      await service.processIncomingMessage(makeTextEvent('no'));

      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(redis.store.get(stateKey)).toBe(ChatState.IDLE);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PADRÓN EPS: agendar POR EPS exige que la cédula esté dada de alta
  // (EpsEnrolledPatient). "Particular" no pasa por el padrón.
  // ─────────────────────────────────────────────────────────────
  describe('padrón EPS: agendamiento por EPS exige estar dado de alta', () => {
    const stateKey = `chat_state:${ORG_ID}:${SENDER}`;

    // Sesión lista para confirmar una cita por la EPS Sura.
    const armarConfirmacionPendiente = () => {
      redis.store.set(stateKey, ChatState.AWAITING_CONFIRMATION);
      redis.store.set(`temp_cedula:${ORG_ID}:${SENDER}`, '1088123456');
      redis.store.set(`temp_nombre:${ORG_ID}:${SENDER}`, 'Ana Pérez');
      redis.store.set(`temp_especialidad:${ORG_ID}:${SENDER}`, 'Odontología');
      redis.store.set(`temp_eps_id:${ORG_ID}:${SENDER}`, 'eps-sura');
      redis.store.set(`temp_selected_slot_id:${ORG_ID}:${SENDER}`, 'slot-1');
      redis.store.set(
        `temp_selected_date_view:${ORG_ID}:${SENDER}`,
        '2026-08-10T14:00:00.000Z',
      );
    };

    it('cédula SIN alta para la EPS → bloquea, envía el enlace de solicitud y cierra la sesión', async () => {
      armarConfirmacionPendiente();
      prisma.eps.findFirst.mockResolvedValue({ id: 'eps-sura', name: 'Sura' });
      prisma.epsEnrolledPatient.findFirst.mockResolvedValue(null);

      await service.processIncomingMessage(makeTextEvent('SI'));

      const all = sentMessages().join('\n');
      // Mensaje amable con el enlace al formulario público de revisión.
      expect(all).toContain('dado de alta');
      expect(all).toContain(`/solicitud-alta/${ORG_ID}`);
      // No se reservó nada y la sesión quedó cerrada.
      expect(
        (service as any).appointmentsService.bookAppointment,
      ).not.toHaveBeenCalled();
      expect(redis.store.get(stateKey)).toBe(ChatState.IDLE);
      // Auditoría con la razón estandarizada.
      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'EPS_NOT_ENROLLED' }),
      );
    });

    it('cédula CON alta para la EPS → el flujo continúa y reserva la cita', async () => {
      armarConfirmacionPendiente();
      prisma.eps.findFirst.mockResolvedValue({ id: 'eps-sura', name: 'Sura' });
      prisma.eps.findUnique.mockResolvedValue({ id: 'eps-sura', name: 'Sura' });
      prisma.epsEnrolledPatient.findFirst.mockResolvedValue({ id: 'padron-1' });

      await service.processIncomingMessage(makeTextEvent('SI'));

      expect(
        (service as any).appointmentsService.bookAppointment,
      ).toHaveBeenCalledWith('pat-1', 'slot-1', 'eps-sura', 'WHATSAPP', ORG_ID);
      const all = sentMessages().join('\n');
      expect(all).not.toContain('/solicitud-alta/');
    });

    it('EPS "Particular" (pago directo) → NO consulta el padrón ni bloquea', async () => {
      armarConfirmacionPendiente();
      redis.store.set(`temp_eps_id:${ORG_ID}:${SENDER}`, 'eps-part');
      prisma.eps.findFirst.mockResolvedValue({
        id: 'eps-part',
        name: 'Particular',
      });

      await service.processIncomingMessage(makeTextEvent('SI'));

      expect(prisma.epsEnrolledPatient.findFirst).not.toHaveBeenCalled();
      expect(
        (service as any).appointmentsService.bookAppointment,
      ).toHaveBeenCalled();
    });

    it('sin EPS en sesión (epsId null) → el gate no aplica', async () => {
      const blocked = await (service as any).rejectIfNotEnrolledInEps({
        organizationId: ORG_ID,
        senderId: SENDER,
        cedula: '1088123456',
        epsId: null,
        MSGS,
        userMessage: 'test',
      });

      expect(blocked).toBe(false);
      expect(prisma.eps.findFirst).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IDENTIDAD DEL REMITENTE (BSUID) — el webhook ya no depende del teléfono
  // ═══════════════════════════════════════════════════════════════════════
  describe('Identidad del remitente entrante', () => {
    const BSUID = 'CO.13491208655302741918';

    it('payload SIN teléfono pero CON user_id (BSUID) → se procesa normalmente', async () => {
      await service.processIncomingMessage({
        user_id: BSUID,
        type: 'text',
        text: { body: 'Hola' },
        metadata: { phone_number_id: PHONE_ID },
      });

      // El turno corrió de verdad: hubo respuesta al paciente...
      expect(sentMessages().length).toBeGreaterThan(0);
      // ...y la sesión quedó namespaced por el BSUID, no por un teléfono.
      expect(redis.store.has(`chat_state:${ORG_ID}:${BSUID}`)).toBe(true);
      expect(sendSpy.mock.calls[0][0]).toBe(BSUID);
    });

    it('con teléfono Y BSUID, la sesión se indexa por el BSUID (estable)', async () => {
      await service.processIncomingMessage({
        from: SENDER,
        user_id: BSUID,
        type: 'text',
        text: { body: 'Hola' },
        metadata: { phone_number_id: PHONE_ID },
      });

      expect(redis.store.has(`chat_state:${ORG_ID}:${BSUID}`)).toBe(true);
      expect(redis.store.has(`chat_state:${ORG_ID}:${SENDER}`)).toBe(false);
    });

    // ── La falla silenciosa que este cambio corrige ─────────────────────
    it('payload SIN ningún identificador → se audita, no se descarta en silencio', async () => {
      await service.processIncomingMessage({
        type: 'text',
        text: { body: 'Hola, necesito una cita' },
        metadata: { phone_number_id: PHONE_ID },
      });

      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'SENDER_UNIDENTIFIED',
          whatsappId: 'unknown',
          userMessage: 'Hola, necesito una cita',
        }),
      );
    });

    it('la auditoría del remitente desconocido se atribuye a la clínica del phone_number_id', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organizationId: ORG_ID,
      });

      await service.processIncomingMessage({
        type: 'text',
        text: { body: 'Hola' },
        metadata: { phone_number_id: PHONE_ID },
      });

      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID }),
      );
    });

    it('el remitente desconocido no dispara ninguna respuesta al paciente', async () => {
      await service.processIncomingMessage({
        type: 'text',
        text: { body: 'Hola' },
        metadata: { phone_number_id: PHONE_ID },
      });

      // No hay a quién responder: intentarlo sería mandar un mensaje a ciegas.
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('la metadata auditada lleva las CLAVES del payload, nunca sus valores', async () => {
      await service.processIncomingMessage({
        type: 'text',
        text: { body: 'dato sensible del paciente' },
        metadata: { phone_number_id: PHONE_ID },
      });

      const call = interactionLog.logFailure.mock.calls[0][0];
      expect(call.metadata.eventKeys).toEqual(
        expect.arrayContaining(['type', 'text', 'metadata']),
      );
      expect(JSON.stringify(call.metadata)).not.toContain('dato sensible');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PERSISTENCIA: cada identificador en SU columna
  // ═══════════════════════════════════════════════════════════════════════
  describe('ensurePatientPersisted — teléfono vs BSUID', () => {
    const BSUID = 'CO.13491208655302741918';
    const persist = (identity: {
      senderId: string;
      phone: string | null;
      bsuid: string | null;
    }) =>
      (service as any).ensurePatientPersisted({
        cedula: '1088123456',
        nombre: 'Paciente Test',
        identity,
        organizationId: ORG_ID,
      });

    it('paciente nuevo con solo teléfono → whatsappId, bsuid en null', async () => {
      await persist({ senderId: SENDER, phone: SENDER, bsuid: null });

      expect(prisma.patientProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ whatsappId: SENDER, bsuid: null }),
        }),
      );
    });

    it('paciente nuevo con solo BSUID → bsuid, whatsappId en null (no se inventa teléfono)', async () => {
      await persist({ senderId: BSUID, phone: null, bsuid: BSUID });

      expect(prisma.patientProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ whatsappId: null, bsuid: BSUID }),
        }),
      );
    });

    it('con ambos → cada identificador va a su columna', async () => {
      await persist({ senderId: BSUID, phone: SENDER, bsuid: BSUID });

      expect(prisma.patientProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ whatsappId: SENDER, bsuid: BSUID }),
        }),
      );
    });

    it('PSID legacy de Messenger → se conserva el comportamiento previo', async () => {
      await persist({ senderId: 'PSID-123', phone: null, bsuid: null });

      expect(prisma.patientProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ whatsappId: 'PSID-123' }),
        }),
      );
    });

    it('paciente existente sin BSUID → se le adopta el que llegó', async () => {
      prisma.patientProfile.findFirst.mockResolvedValue({
        id: 'pat-1',
        whatsappId: SENDER,
        bsuid: null,
      });

      await persist({ senderId: BSUID, phone: SENDER, bsuid: BSUID });

      expect(prisma.patientProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { bsuid: BSUID } }),
      );
    });

    it('BSUID desactualizado → se refresca (si no, el paciente queda inalcanzable)', async () => {
      prisma.patientProfile.findFirst.mockResolvedValue({
        id: 'pat-1',
        whatsappId: SENDER,
        bsuid: 'CO.VIEJO000000000000',
      });

      await persist({ senderId: BSUID, phone: SENDER, bsuid: BSUID });

      expect(prisma.patientProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { bsuid: BSUID } }),
      );
    });

    it('el teléfono ya guardado NO se pisa', async () => {
      prisma.patientProfile.findFirst.mockResolvedValue({
        id: 'pat-1',
        whatsappId: '573009998877',
        bsuid: BSUID,
      });

      await persist({ senderId: BSUID, phone: SENDER, bsuid: BSUID });

      expect(prisma.patientProfile.update).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ENVÍO: el destinatario va en `to` (teléfono) o en `recipient` (BSUID)
  // ═══════════════════════════════════════════════════════════════════════
  describe('sendWhatsAppMessage — campo del destinatario', () => {
    const BSUID = 'CO.13491208655302741918';
    let postMock: jest.Mock;

    beforeEach(() => {
      // Aquí SÍ queremos el método real: lo que se prueba es el payload.
      sendSpy.mockRestore();
      postMock = jest.fn(() => of({ data: { messages: [{ id: 'wamid.1' }] } }));
      (service as any).httpService = { post: postMock };
      (service as any).whatsappCredentials = {
        forOrg: jest.fn(() => ({
          organizationId: ORG_ID,
          phoneNumberId: PHONE_ID,
          accessToken: 'token-de-prueba',
          isActive: true,
        })),
      };
    });

    const enviarA = async (recipientId: string) => {
      // El tenant del destinatario se resuelve por este caché.
      redis.store.set(`origin_org:${recipientId}`, ORG_ID);
      await (service as any).sendWhatsAppMessage(recipientId, 'Hola');
      return postMock.mock.calls[0];
    };

    it('teléfono → `to`, sin `recipient`', async () => {
      const [, body] = await enviarA(SENDER);
      expect(body).toMatchObject({ to: SENDER, messaging_product: 'whatsapp' });
      expect(body).not.toHaveProperty('recipient');
    });

    it('BSUID → `recipient`, sin `to`', async () => {
      const [, body] = await enviarA(BSUID);
      expect(body).toMatchObject({ recipient: BSUID });
      expect(body).not.toHaveProperty('to');
    });

    it('la URL usa la versión centralizada de la Graph API, no v19.0', async () => {
      const [url] = await enviarA(SENDER);
      expect(url).toContain(`/${PHONE_ID}/messages`);
      expect(url).not.toContain('v19.0');
      expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//);
    });

    it('el audio usa el mismo criterio de destinatario', async () => {
      const creds = {
        organizationId: ORG_ID,
        phoneNumberId: PHONE_ID,
        accessToken: 'token-de-prueba',
        isActive: true,
      };
      await (service as any).sendWhatsAppAudioMessage(BSUID, 'media-1', creds);
      const [, body] = postMock.mock.calls[0];
      expect(body).toMatchObject({ recipient: BSUID, type: 'audio' });
      expect(body).not.toHaveProperty('to');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VENTANA DE ATENCIÓN DE 24 H (decide plantilla vs texto libre)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Ventana de atención de 24 h', () => {
    it('un mensaje entrante abre la ventana del paciente en esa clínica', async () => {
      await service.processIncomingMessage(makeTextEvent('Hola'));

      expect(redis.store.has(`wa_window:${ORG_ID}:${SENDER}`)).toBe(true);
      await expect(service.isWithinServiceWindow(ORG_ID, SENDER)).resolves.toBe(
        true,
      );
    });

    it('la ventana se marca con TTL de 24 h', async () => {
      await service.processIncomingMessage(makeTextEvent('Hola'));

      const llamada = (redis.set.mock.calls as unknown as any[][]).find(
        (c) => c[0] === `wa_window:${ORG_ID}:${SENDER}`,
      );
      expect(llamada?.[2]).toBe('EX');
      expect(llamada?.[3]).toBe(24 * 60 * 60);
    });

    it('la ventana es POR CLÍNICA: escribirle a la A no autoriza a la B', async () => {
      await service.processIncomingMessage(makeTextEvent('Hola'));

      await expect(
        service.isWithinServiceWindow('otra-org', SENDER),
      ).resolves.toBe(false);
    });

    it('sin marca previa → fuera de la ventana', async () => {
      await expect(
        service.isWithinServiceWindow(ORG_ID, '573009998877'),
      ).resolves.toBe(false);
    });

    it('si Redis falla se asume FUERA de ventana (se cae a plantilla, que siempre es válida)', async () => {
      (redis.get as jest.Mock).mockRejectedValueOnce(
        new Error('redis caído') as never,
      );

      await expect(service.isWithinServiceWindow(ORG_ID, SENDER)).resolves.toBe(
        false,
      );
    });

    it('responder al paciente NO reabre la ventana (sólo la abre él)', async () => {
      await service.sendOutboundForOrg(ORG_ID, '573009998877', 'Hola');

      expect(redis.store.has(`wa_window:${ORG_ID}:573009998877`)).toBe(false);
    });
  });
});
