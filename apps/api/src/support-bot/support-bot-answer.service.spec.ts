import { Logger } from '@nestjs/common';
import { DATO_OCULTO, TEXTOS_SOPORTE } from '@agenia/shared';
import { SupportBotAnswerService } from './support-bot-answer.service';
import { SupportBotKnowledgeService } from './support-bot-knowledge.service';
import type { SupportBotCasesService } from './support-bot-cases.service';
import type { Interlocutor } from './support-bot-session.service';
import type { SupportBotRuntime } from './support-bot.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { SupportBotWatchService } from './support-bot-watch.service';
import type { LlmFactoryService } from '../llm/llm-factory.service';
import type {
  LLMProvider,
  PeticionConversacion,
} from '../llm/interfaces/llm-provider.interface';

/**
 * La respuesta del asistente (Fase 2), con el AGENIA.md REAL y una IA falsa. Lo
 * que no puede fallar:
 *  1. El empleado SIEMPRE recibe respuesta: sin IA, con la IA caída, tarde o con
 *     una respuesta ilegible, responde el buscador del Centro de ayuda.
 *  2. A la IA no le llegan datos de pacientes (S8) ni el manual de otro rol.
 *  3. Lo que importa lo decide el código: temas validados, «no cubierta», enlaces
 *     solo para quien ve la ayuda, tope diario por clínica (S15).
 */
describe('SupportBotAnswerService', () => {
  const AHORA = new Date('2026-10-19T15:32:00Z');
  const RT = {
    enabled: true,
    token: 't',
    botUsername: 'AgeniaSoporteBot',
    routeKey: 'r',
    webhookSecret: 's',
    conversationIdleMinutes: 30,
    maxMessagesPerHour: 40,
    maxMessageChars: 2000,
    maxAiTurnsPerOrgPerDay: 300,
    piloto: { activo: false, usuarios: [] },
  } satisfies SupportBotRuntime;
  const ANA: Interlocutor = {
    conversationId: 'conv-1',
    userId: 'u-1',
    email: 'ana@clinica.co',
    role: 'BOOKING_AGENT',
    organizationId: 'org-1',
    organizationName: 'Hospital de Prueba',
    isTest: false,
    chatId: '777',
    telegramName: 'Ana',
  };
  const RESPUESTA_IA = JSON.stringify({
    tipo: 'respuesta',
    respuesta:
      'Eso lo hace el administrador desde Agendas (Slots) › «Clonar Día».',
    temas: ['agenda', 'inventado'],
    urgencia: 'normal',
    caso: null,
  });
  const ENV = { ...process.env };

  let mensajes: Array<{ direction: string; text: string }>;
  let org: Record<string, unknown> | null;
  let contador: number;
  let redisCaido: boolean;
  let principal: LLMProvider & { conversar: jest.Mock };
  let otros: Record<string, (LLMProvider & { conversar: jest.Mock }) | null>;
  let llm: { forOrgOrNull: jest.Mock; forOrgByProvider: jest.Mock };
  let svc: SupportBotAnswerService;
  let casosSvc: { casosDe: jest.Mock; incidentesPara: jest.Mock };
  let vigilancia: Record<string, jest.Mock>;

  const proveedor = (
    name: 'GEMINI' | 'CHATGPT' | 'CLAUDE',
    texto = RESPUESTA_IA,
  ) =>
    ({
      name,
      conversar: jest.fn(async () => ({
        texto,
        modelo: 'm',
        tokensEntrada: 30_000,
        tokensSalida: 90,
        tokensCache: 29_000,
      })),
    }) as unknown as LLMProvider & { conversar: jest.Mock };
  const peticion = (p = principal): PeticionConversacion =>
    p.conversar.mock.calls[0][0];

  beforeEach(() => {
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    process.env = { ...ENV };
    delete process.env.LLM_FAILOVER_ENABLED;
    delete process.env.AGENIA_CONOCIMIENTO_PATH;
    process.env.PUBLIC_WEB_URL = 'https://panel.prueba.co';
    mensajes = [
      {
        direction: 'SALIDA',
        text: 'Listo, Ana. Hablas como Agente de Reservas…',
      },
      { direction: 'ENTRADA', text: 'hola' },
      {
        direction: 'ENTRADA',
        text: '¿cómo copio la agenda del lunes al martes?',
      },
    ];
    org = {
      name: 'Hospital de Prueba',
      supportPhone: '+57 300 000 0000',
      settings: {
        botName: 'Sofi',
        bookingEnabled: false,
        cancelEnabled: true,
        rescheduleEnabled: true,
        remindersEnabled: true,
        remindersOnlySelfBooked: false,
        reminderMinLeadMinutes: 60,
        dailyAppointmentLimitEnabled: true,
        maxAppointmentsPerDay: 1,
        monthlyAppointmentLimitEnabled: false,
        maxAppointmentsPerMonth: 3,
      },
      aiProviderConfig: { activeProvider: 'GEMINI' },
      whatsappConfig: { isActive: true },
      telegramConfig: null,
      hospitalMirrorConfig: {
        enabled: true,
        driverKey: 'cnt-sanvicente-anserma',
        avisosMasivos: null,
        availabilityMode: 'HUECOS',
        lastHeartbeatAt: new Date(AHORA.getTime() - 2 * 60_000),
        lastHisReachable: true,
      },
    };
    contador = 0;
    redisCaido = false;
    principal = proveedor('GEMINI');
    otros = { CHATGPT: null, CLAUDE: null };
    llm = {
      forOrgOrNull: jest.fn(async () => principal),
      forOrgByProvider: jest.fn(
        async (_o: string, n: string) => otros[n] ?? null,
      ),
    };
    const prisma = {
      supportBotMessage: {
        findMany: jest.fn(async () => [...mensajes].reverse()),
      },
      organization: { findUnique: jest.fn(async () => org) },
    };
    const redis = {
      incr: jest.fn(async () => {
        if (redisCaido) throw new Error('Redis caído');
        return ++contador;
      }),
      expire: jest.fn(async () => 1),
    };
    casosSvc = {
      casosDe: jest.fn(async () => [
        {
          numero: 58,
          titulo: 'No salen los recordatorios',
          estado: 'IN_PROGRESS',
          creadoEn: new Date(AHORA.getTime() - 3_600_000),
          tomadoEn: new Date(AHORA.getTime() - 1_800_000),
          resueltoEn: null,
          respuesta: null,
        },
      ]),
      incidentesPara: jest.fn(async () => [
        {
          frase: 'WhatsApp (Meta) tiene fallas',
          desde: new Date(AHORA.getTime() - 600_000),
        },
      ]),
    };
    vigilancia = {
      iaFallo: jest.fn(async () => undefined),
      iaRespondio: jest.fn(async () => undefined),
      topeAlcanzado: jest.fn(async () => undefined),
    };
    svc = new SupportBotAnswerService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      llm as unknown as LlmFactoryService,
      new SupportBotKnowledgeService(),
      casosSvc as unknown as SupportBotCasesService,
      vigilancia as unknown as SupportBotWatchService,
    );
  });

  afterEach(() => {
    process.env = ENV;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('nada pendiente (lo último fue del asistente): no responde', async () => {
    mensajes = [
      { direction: 'ENTRADA', text: 'hola' },
      { direction: 'SALIDA', text: 'Hola' },
    ];
    await expect(svc.responder(ANA, RT, AHORA)).resolves.toBeNull();
    expect(principal.conversar).not.toHaveBeenCalled();
  });

  it('«Abrir un caso» sin nada escrito: trae lo que contó en el turno anterior', async () => {
    llm.forOrgOrNull.mockResolvedValue(null);
    mensajes = [
      { direction: 'SALIDA', text: 'Listo, Ana.' },
      { direction: 'ENTRADA', text: 'la agenda del Dr. Ruiz sale en blanco' },
      { direction: 'ENTRADA', text: 'desde las 8' },
      { direction: 'SALIDA', text: 'Lo más cercano del manual…' },
      { direction: 'ENTRADA', text: '/nuevo' },
    ];
    const r = await svc.responder(ANA, RT, AHORA, { pedirCaso: true });
    expect(r?.pendientes).toEqual(['/nuevo']);
    expect(r?.turnoAnterior).toEqual([
      'la agenda del Dr. Ruiz sale en blanco',
      'desde las 8',
    ]);
  });

  describe('con la IA de la clínica', () => {
    it('responde con lo que dijo la IA, descarta los temas inventados y deja todo para las cifras', async () => {
      const r = await svc.responder(ANA, RT, AHORA);
      expect(r).toEqual({
        texto:
          'Eso lo hace el administrador desde Agendas (Slots) › «Clonar Día».',
        botones: 'UTIL',
        registro: {
          source: 'IA',
          aiKind: 'respuesta',
          uncovered: false,
          topics: ['agenda'],
          aiProvider: 'GEMINI',
          inputTokens: 30_000,
          outputTokens: 90,
          latencyMs: expect.any(Number),
        },
        motivoSinIA: null,
        ia: expect.objectContaining({
          tipo: 'respuesta',
          temas: ['agenda'],
          ampliarCaso: null,
        }),
        pendientes: ['hola', '¿cómo copio la agenda del lunes al martes?'],
        turnoAnterior: [],
      });
    });

    it('le da a la IA sus casos, lo que el equipo ya sabe que falla, el borrador y el pedido de caso', async () => {
      await svc.responder(ANA, RT, AHORA, {
        pedirCaso: true,
        borrador: {
          fase: 'RECOPILANDO',
          titulo: 'No carga la agenda',
          descripcion: null,
          pantalla: null,
          falta: ['desde cuándo'],
          prioridad: 'NORMAL',
          creadoEn: AHORA.toISOString(),
          venceEn: null,
        },
      });
      const v = peticion().sistema.variable;
      expect(v).toContain('#58 «No salen los recordatorios»');
      expect(v).toContain('WhatsApp (Meta) tiene fallas');
      expect(v).toContain('- Título: No carga la agenda');
      expect(v).toContain('La persona pidió abrir un caso');
      // Los incidentes, con la IA de la ficha (Gemini).
      expect(casosSvc.incidentesPara).toHaveBeenCalledWith('org-1', 'Gemini');
    });

    it('si quien llama ya trae sus casos, no los vuelve a buscar', async () => {
      await svc.responder(ANA, RT, AHORA, { casos: [] });
      expect(casosSvc.casosDe).not.toHaveBeenCalled();
      expect(peticion().sistema.variable).toContain('- No tiene casos.');
    });

    it('el prompt: manual con la Parte 1 en lo fijo; su rol, su menú y la ficha en lo variable; JSON y tiempo máximo', async () => {
      await svc.responder(ANA, RT, AHORA);
      const p = peticion();
      expect(p.json).toBe(true);
      expect(p.timeoutMs).toBe(25_000);
      expect(p.sistema.fijo).toContain('## Categoría: Para empezar {#inicio}');
      expect(p.sistema.fijo).not.toContain('Arquitectura técnica');
      expect(p.sistema.variable).toContain('- Rol: Agente de Reservas.');
      // Con espejo: el agente ve la Bandeja.
      expect(p.sistema.variable).toContain('Bandeja de sincronización');
      expect(p.sistema.variable).toContain('agendar apagado');
      expect(p.sistema.variable).toContain(
        'El asistente de los pacientes se llama «Sofi»',
      );
      expect(p.sistema.variable).toContain(
        'último latido del agente hace 2 min',
      );
    });

    it('🔒 a la IA no le llegan datos de pacientes, y los mensajes seguidos van juntos', async () => {
      mensajes.push({
        direction: 'ENTRADA',
        text: 'la paciente CC 1053789456 no aparece',
      });
      await svc.responder(ANA, RT, AHORA);
      const turnos = peticion().turnos;
      expect(turnos).toEqual([
        {
          rol: 'usuario',
          texto: `hola\n¿cómo copio la agenda del lunes al martes?\nla paciente CC ${DATO_OCULTO} no aparece`,
        },
      ]);
    });

    it('al administrador le agrega el enlace al Centro de ayuda; al agente, no', async () => {
      const admin = await svc.responder(
        { ...ANA, role: 'ORG_ADMIN' },
        RT,
        AHORA,
      );
      expect(admin?.texto).toContain(
        'https://panel.prueba.co/dashboard/soporte/ayuda?tema=agenda',
      );
      const agente = await svc.responder(ANA, RT, AHORA);
      expect(agente?.texto).not.toContain('dashboard/soporte/ayuda');
    });

    it('el super admin en modo prueba pregunta como el administrador de la clínica, sin enlace', async () => {
      const r = await svc.responder(
        { ...ANA, role: 'SUPER_ADMIN', isTest: true },
        RT,
        AHORA,
      );
      expect(peticion().sistema.variable).toContain(
        '- Rol: Administrador del Hospital.',
      );
      expect(r?.texto).not.toContain('dashboard/soporte/ayuda');
    });

    it('una respuesta sin apoyo en el manual: ofrece el caso, sin botones, y queda como hueco', async () => {
      principal = proveedor(
        'GEMINI',
        JSON.stringify({
          tipo: 'respuesta',
          respuesta: 'Creo que sí se puede.',
          temas: [],
        }),
      );
      llm.forOrgOrNull.mockResolvedValue(principal);
      const r = await svc.responder(ANA, RT, AHORA);
      expect(r?.texto).toBe(
        `Creo que sí se puede.\n\n${TEXTOS_SOPORTE.ofrecerCaso}`,
      );
      expect(r?.botones).toBe('OFRECER_CASO');
      expect(r?.registro).toMatchObject({ uncovered: true, topics: [] });
    });

    it('sin clínica (borrada), igual responde sin ficha', async () => {
      org = null;
      await expect(svc.responder(ANA, RT, AHORA)).resolves.toMatchObject({
        registro: { source: 'IA' },
      });
      expect(peticion().sistema.variable).not.toContain('Ficha de la clínica');
    });
  });

  describe('sin IA: el buscador del Centro de ayuda', () => {
    it('la clínica no tiene IA', async () => {
      llm.forOrgOrNull.mockResolvedValue(null);
      const r = await svc.responder(ANA, RT, AHORA);
      expect(r?.motivoSinIA).toBe('SIN_IA_CONFIGURADA');
      expect(r?.texto.startsWith(TEXTOS_SOPORTE.sinIA)).toBe(true);
      expect(r?.texto).toContain('Agendas (Slots)');
      expect(r?.texto.endsWith(TEXTOS_SOPORTE.ofrecerCaso)).toBe(true);
      expect(r?.botones).toBe('OFRECER_CASO');
      expect(r?.ia).toBeNull();
      expect(r?.pendientes).toEqual([
        'hola',
        '¿cómo copio la agenda del lunes al martes?',
      ]);
      expect(r?.turnoAnterior).toEqual([]);
      // La agente no tiene «Agendas (Slots)» en su menú: se lo marca.
      expect(r?.texto).toContain('Agendas (Slots) (no está en tu menú)');
      expect(r?.registro).toMatchObject({ source: 'SIN_IA', aiProvider: null });
    });

    it('no se pudo leer la configuración de IA', async () => {
      llm.forOrgOrNull.mockRejectedValue(new Error('descifrado'));
      await expect(svc.responder(ANA, RT, AHORA)).resolves.toMatchObject({
        motivoSinIA: 'SIN_IA_CONFIGURADA',
      });
    });

    it('la IA falla y no hay respaldo encendido', async () => {
      principal.conversar.mockRejectedValue(
        Object.assign(new Error('Gemini 429'), { status: 429 }),
      );
      await expect(svc.responder(ANA, RT, AHORA)).resolves.toMatchObject({
        motivoSinIA: 'FALLO',
      });
      expect(llm.forOrgByProvider).not.toHaveBeenCalled();
      // La vigilancia lo cuenta (3 en 15 min abren la alerta de la clínica).
      expect(vigilancia.iaFallo).toHaveBeenCalledWith(
        { id: 'org-1', nombre: 'Hospital de Prueba' },
        'la IA falló o tardó',
      );
      expect(vigilancia.iaRespondio).not.toHaveBeenCalled();
    });

    it('🩺 una respuesta con IA le avisa a la vigilancia (resuelve la alerta si había)', async () => {
      await svc.responder(ANA, RT, AHORA);
      expect(vigilancia.iaRespondio).toHaveBeenCalledWith('org-1');
      expect(vigilancia.iaFallo).not.toHaveBeenCalled();
    });

    it('🩺 sin IA configurada no es una falla: la vigilancia no se entera', async () => {
      llm.forOrgOrNull.mockResolvedValue(null);
      await svc.responder(ANA, RT, AHORA);
      expect(vigilancia.iaFallo).not.toHaveBeenCalled();
      expect(vigilancia.iaRespondio).not.toHaveBeenCalled();
    });

    it('con LLM_FAILOVER_ENABLED, responde otro proveedor de la clínica', async () => {
      process.env.LLM_FAILOVER_ENABLED = 'true';
      principal.conversar.mockRejectedValue(new Error('Gemini caído'));
      otros.CHATGPT = null;
      otros.CLAUDE = proveedor('CLAUDE');
      const r = await svc.responder(ANA, RT, AHORA);
      expect(r?.registro).toMatchObject({ source: 'IA', aiProvider: 'CLAUDE' });
      expect(llm.forOrgByProvider).toHaveBeenCalledWith('org-1', 'CHATGPT');
    });

    it('con respaldo encendido pero ninguno responde (o ninguno configurado), sin IA', async () => {
      process.env.LLM_FAILOVER_ENABLED = 'true';
      principal.conversar.mockRejectedValue(new Error('x'));
      otros.CHATGPT = proveedor('CHATGPT');
      otros.CHATGPT.conversar.mockRejectedValue(new Error('y'));
      llm.forOrgByProvider.mockImplementation(async (_o: string, n: string) => {
        if (n === 'CLAUDE') throw new Error('sin clave');
        return otros[n];
      });
      await expect(svc.responder(ANA, RT, AHORA)).resolves.toMatchObject({
        motivoSinIA: 'FALLO',
      });
    });

    it('la IA tarda más de 25 s', async () => {
      jest.useFakeTimers();
      principal.conversar.mockImplementation(
        () => new Promise(() => undefined),
      );
      const p = svc.responder(ANA, RT, AHORA);
      await jest.advanceTimersByTimeAsync(25_001);
      await expect(p).resolves.toMatchObject({ motivoSinIA: 'FALLO' });
    });

    it('la IA devuelve algo que no se puede leer', async () => {
      principal = proveedor('GEMINI', 'Claro, con gusto te ayudo.');
      llm.forOrgOrNull.mockResolvedValue(principal);
      await expect(svc.responder(ANA, RT, AHORA)).resolves.toMatchObject({
        motivoSinIA: 'NO_SE_PUDO_LEER',
      });
      expect(vigilancia.iaFallo).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'org-1' }),
        'la IA respondió algo ilegible',
      );
    });

    it('sin nada parecido en el manual, lo dice', async () => {
      llm.forOrgOrNull.mockResolvedValue(null);
      mensajes = [{ direction: 'ENTRADA', text: 'zzqx wvyk' }];
      const r = await svc.responder(ANA, RT, AHORA);
      expect(r?.texto).toBe(
        `${TEXTOS_SOPORTE.sinIASinResultados}\n\n${TEXTOS_SOPORTE.ofrecerCaso}`,
      );
    });

    it('sin el archivo del manual, no llama a la IA y responde igual', async () => {
      process.env.AGENIA_CONOCIMIENTO_PATH = '/no/existe/AGENIA.md';
      const r = await svc.responder(ANA, RT, AHORA);
      expect(r?.motivoSinIA).toBe('SIN_MANUAL');
      expect(principal.conversar).not.toHaveBeenCalled();
    });
  });

  describe('tope diario de respuestas con IA por clínica (S15)', () => {
    it('pasado el tope, sin IA', async () => {
      const rt = { ...RT, maxAiTurnsPerOrgPerDay: 1 };
      await expect(svc.responder(ANA, rt, AHORA)).resolves.toMatchObject({
        registro: { source: 'IA' },
      });
      await expect(svc.responder(ANA, rt, AHORA)).resolves.toMatchObject({
        motivoSinIA: 'TOPE_DIARIO',
      });
      expect(principal.conversar).toHaveBeenCalledTimes(1);
      // La primera vez que se pasa, el equipo técnico se entera; las siguientes, no.
      expect(vigilancia.topeAlcanzado).toHaveBeenCalledWith(
        { id: 'org-1', nombre: 'Hospital de Prueba' },
        1,
        AHORA,
      );
      await svc.responder(ANA, rt, AHORA);
      expect(vigilancia.topeAlcanzado).toHaveBeenCalledTimes(1);
    });

    it('tope 0: la clínica se atiende siempre sin IA', async () => {
      await expect(
        svc.responder(ANA, { ...RT, maxAiTurnsPerOrgPerDay: 0 }, AHORA),
      ).resolves.toMatchObject({
        motivoSinIA: 'TOPE_DIARIO',
      });
    });

    it('sin Redis no hay tope', async () => {
      redisCaido = true;
      await expect(svc.responder(ANA, RT, AHORA)).resolves.toMatchObject({
        registro: { source: 'IA' },
      });
    });
  });
});
