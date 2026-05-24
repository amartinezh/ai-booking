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
import { SurveyService } from '../survey/survey.service';
import { AudioConfigService } from '../audio-config/audio-config.service';
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
    // El TTL no se modela en memoria; basta con que exista para la marca de
    // actividad (refresco de TTL del estado) que hace el servicio en cada mensaje.
    expire: jest.fn(async (k: string, _seconds: number) => (store.has(k) ? 1 : 0)),
    ttl: jest.fn(async (k: string) => (store.has(k) ? -1 : -2)),
  };
}

// SchedulingExtraction completa con overrides; default = intención "otro" sin entidades.
function extraction(over: Partial<SchedulingExtraction> = {}): SchedulingExtraction {
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
      mapEntityToCatalog: jest.fn(async () => ({ id: null })),
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
      doctorProfile: { findMany: jest.fn(async () => []) },
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
        { provide: SurveyService, useValue: { generateSurveyToken: jest.fn(async () => null) } },
        { provide: AudioConfigService, useValue: { getEffective: jest.fn(async () => null) } },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);

    // Capturamos los envíos sin tocar la capa HTTP de WhatsApp.
    sendSpy = jest
      .spyOn(service as any, 'sendWhatsAppMessage')
      .mockResolvedValue(undefined);

    // El enlace CSAT (encuesta de cierre) es plumbing aparte de la conversación:
    // lo silenciamos para que `sentMessages()` capture solo las respuestas del flujo.
    jest
      .spyOn(service as any, 'sendSurveyLink')
      .mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
        where: { organizationId: ORG_ID, serviceId: SERVICE_ID, isActive: true },
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
      expect((service as any).greetingRegex.test('necesito una cita')).toBe(false);
      expect((service as any).greetingRegex.test('buenas necesito una cita')).toBe(false);
    });
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
    expect(replies[0]).toContain('respetuosa');
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

      await service.processIncomingMessage(makeTextEvent('¿hay citas para mañana?'));

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

      await service.processIncomingMessage(makeTextEvent('¿abren los festivos?'));

      const replies = sentMessages();
      expect(replies[0]).toContain('festivos');
    });
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
    // El ACK saluda por nombre.
    expect(replies[0]).toContain('Andres');
    // El segundo pregunta por el servicio...
    expect(replies[1]).toContain('servicio');
    // ...pero NO vuelve a presentar al bot (sin segundo saludo "Soy *Geni*").
    expect(replies.filter((m) => m.includes('Geni'))).toHaveLength(0);
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

  // ════════════════════════════════════════════════════════════
  // Mapeo Semántico de Servicios (LLM contra catálogo real)
  // ════════════════════════════════════════════════════════════
  describe('mapeo semántico de servicio en AWAITING_SPECIALTY', () => {
    beforeEach(() => {
      redis.store.set(`chat_state:${ORG_ID}:${SENDER}`, ChatState.AWAITING_SPECIALTY);
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

      await service.processIncomingMessage(
        makeTextEvent(SEM_PHRASE),
      );

      expect(provider.mapEntityToCatalog).toHaveBeenCalledTimes(1);
      // Servicio resuelto y persistido.
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe('s1');
      expect(redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`)).toBe('Consulta externa');
      // Avanzó al paso de EPS (no se quedó en el menú de servicio ni dio error).
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.AWAITING_EPS);
      expect(sentMessages().join('\n')).not.toContain('no logré entender');
    });

    it('anti-alucinación: id devuelto que no existe en el catálogo se descarta', async () => {
      provider.mapEntityToCatalog.mockResolvedValueOnce({ id: 'id-inexistente' });

      await service.processIncomingMessage(
        makeTextEvent(SEM_PHRASE),
      );

      // No se resolvió ningún servicio (id inválido descartado).
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBeUndefined();
      // No avanzó a EPS; sigue en selección de servicio.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.AWAITING_SPECIALTY);
    });

    it('Caso B: si el LLM falla, cae al flujo determinista sin romper', async () => {
      provider.mapEntityToCatalog.mockRejectedValueOnce(new Error('boom'));

      await service.processIncomingMessage(
        makeTextEvent(SEM_PHRASE),
      );

      // Degradación segura: no resolvió servicio, no lanzó excepción.
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBeUndefined();
      expect(sentMessages().length).toBeGreaterThan(0);
    });

    it('no llama al mapeo semántico para una letra de menú (atajo barato)', async () => {
      // "a" resuelve por letra; no debe gastar una llamada al LLM.
      redis.store.set(`temp_service_A_id:${ORG_ID}:${SENDER}`, 's1');
      redis.store.set(`temp_service_A_name:${ORG_ID}:${SENDER}`, 'Consulta externa');

      await service.processIncomingMessage(makeTextEvent('a'));

      expect(provider.mapEntityToCatalog).not.toHaveBeenCalled();
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe('s1');
    });

    // Regresión: la frase del usuario CONTIENE el nombre de un servicio del
    // catálogo ("quiero una consulta externa"). El match determinista por nombre
    // debe resolverlo SIN llamar al LLM (clave cuando no hay proveedor configurado).
    it('resuelve por nombre cuando la frase contiene el servicio, sin usar el LLM', async () => {
      await service.processIncomingMessage(
        makeTextEvent('quiero una consulta externa, la opción A'),
      );

      expect(provider.mapEntityToCatalog).not.toHaveBeenCalled();
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe('s1');
      expect(redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`)).toBe('Consulta externa');
      // Avanzó al paso de EPS y no cayó en el loop de "no entendí"/reprompt.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.AWAITING_EPS);
      expect(sentMessages().join('\n')).not.toContain('servicios necesitas');
    });

    // Aunque el proveedor LLM esté APAGADO (forOrgOrNull → null), el match por
    // nombre sigue funcionando. Esta era la causa raíz del loop reportado.
    it('resuelve por nombre aun sin proveedor LLM configurado', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(null);

      await service.processIncomingMessage(makeTextEvent('quiero una consulta externa'));

      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe('s1');
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.AWAITING_EPS);
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
      jest.spyOn(service as any, 'resolveCredentialsForOrg').mockResolvedValue({ accessToken: 'tok' });
      jest.spyOn(service as any, 'downloadWhatsAppAudio').mockResolvedValue(Buffer.from('fake-ogg'));
      // El LLM transcribe la voz pero deja `especialidad` en null.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'consulta externa', especialidad: null, intent: 'agendar_cita' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // El servicio se resolvió por el transcript y avanzó a EPS (igual que el texto).
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe('s1');
      expect(redis.store.get(`temp_especialidad:${ORG_ID}:${SENDER}`)).toBe('Consulta externa');
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.AWAITING_EPS);
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
      redis.store.set(`temp_especialidad:${ORG_ID}:${SENDER}`, 'Consulta externa');
      // Catálogo de EPS de la clínica (incluye la que el paciente dirá por voz).
      prisma.eps.findMany.mockResolvedValue([{ id: 'e1', name: 'Nueva EPS' }]);

      jest.spyOn(service as any, 'resolveCredentialsForOrg').mockResolvedValue({ accessToken: 'tok' });
      jest.spyOn(service as any, 'downloadWhatsAppAudio').mockResolvedValue(Buffer.from('fake-ogg'));
    });

    it('AUDIO "Nueva EPS" con intent=consulta_faq → resuelve la EPS, NO llama answerFAQ', async () => {
      // El LLM transcribe la EPS pero la clasifica como consulta_faq (el bug).
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: 'Nueva EPS', eps: null, intent: 'consulta_faq' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // El turno NO se desvió al RAG: nunca se llamó answerFAQ.
      expect(provider.answerFAQ).not.toHaveBeenCalled();
      // La EPS se capturó por el transcript (igual que el texto).
      expect(redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`)).toBe('e1');
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe('Nueva EPS');
      // Avanzó más allá del paso de EPS (sin slots → opt-in a lista de espera).
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(
        ChatState.AWAITING_WAITLIST_OPTIN,
      );
    });

    it('AUDIO con pregunta abierta (no mapea a EPS) SÍ responde FAQ sin perder el estado', async () => {
      // El paciente realmente pregunta algo: el transcript no mapea a ninguna EPS.
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ transcript: '¿qué documentos necesito?', eps: null, intent: 'consulta_faq' }),
      );

      await service.processIncomingMessage(makeAudioEvent());

      // La FAQ legítima sí se atiende (vía el resolver del menú, classifyIntentLocal)…
      expect(provider.answerFAQ).toHaveBeenCalledTimes(1);
      // …y NO se pierde el progreso: sigue esperando la EPS.
      expect(redis.store.get(`chat_state:${ORG_ID}:${SENDER}`)).toBe(ChatState.AWAITING_EPS);
      expect(redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`)).toBeUndefined();
    });
  });
});
