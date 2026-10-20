import { Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import { TEXTOS_SOPORTE } from '@agenia/shared';
import { SupportBotService } from './support-bot.service';
import type {
  EstadoConversacion,
  Interlocutor,
  ResultadoCodigo,
  SupportBotSessionService,
} from './support-bot-session.service';
import type { SupportBotConfigService } from './support-bot-config.service';
import type { TelegramApiClient } from '../telegram/telegram-api.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { SupportBotRuntime } from './support-bot.types';
import type {
  RespuestaArmada,
  SupportBotAnswerService,
} from './support-bot-answer.service';

/**
 * El turno del asistente (Fase 1). Lo que no puede fallar:
 *  1. Sin conversación verificada no hay respuesta con contenido: solo se pide el código.
 *  2. La pregunta escrita antes del código se responde apenas se valida.
 *  3. Un reintento de Telegram (mismo update_id) no se atiende dos veces.
 *  4. Lo que pasa en la conversación queda registrado; lo de antes, no.
 */
describe('SupportBotService', () => {
  const RT: SupportBotRuntime = {
    enabled: true,
    token: 'TOKEN',
    botUsername: 'AgeniaSoporteBot',
    routeKey: 'r',
    webhookSecret: 's',
    conversationIdleMinutes: 30,
    maxMessagesPerHour: 40,
    maxMessageChars: 2000,
  };
  const ANA: Interlocutor = {
    conversationId: 'conv-1',
    userId: 'u-1',
    email: 'ana.perez@clinica.co',
    role: 'BOOKING_AGENT',
    organizationId: 'org-1',
    organizationName: 'Hospital de Prueba',
    isTest: false,
    chatId: '777',
    telegramName: 'Ana',
  };

  let enviados: Array<{ chat: string; texto: string }>;
  let registrados: Array<{
    conversationId: string;
    direction: string;
    text: string;
    telegramUpdateId: string | null;
  }>;
  let estado: EstadoConversacion;
  let resultado: ResultadoCodigo;
  let espera: string | null;
  let contador: number;
  let sesiones: Record<string, jest.Mock>;
  let api: Record<string, jest.Mock>;
  let redis: Record<string, jest.Mock>;
  let service: SupportBotService;
  let respuestas: { responder: jest.Mock };
  let conversaciones: { updateMany: jest.Mock };
  let ultimo: Map<string, string>;
  const ARMADA: RespuestaArmada = {
    texto: 'Pulsa «Clonar Día».',
    botonesUtil: true,
    registro: {
      source: 'IA',
      aiKind: 'respuesta',
      uncovered: false,
      topics: ['agenda'],
      aiProvider: 'GEMINI',
      inputTokens: 30_000,
      outputTokens: 80,
      latencyMs: 1200,
    },
    motivoSinIA: null,
  };

  const msg = (texto: string | null, updateId = '100') => ({
    accion: 'mensaje' as const,
    updateId,
    telegramUserId: '777',
    chatId: '777',
    nombre: 'Ana',
    texto,
  });
  const textos = () => enviados.map((e) => e.texto);

  beforeEach(() => {
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    enviados = [];
    registrados = [];
    estado = { tipo: 'NINGUNA' };
    resultado = { tipo: 'INVALIDO', restantes: 4 };
    espera = null;
    contador = 0;
    sesiones = {
      conversacionDe: jest.fn(async () => estado),
      validarCodigo: jest.fn(async () => resultado),
      guardarPreguntaEnEspera: jest.fn(async (_id: string, t: string) => {
        espera = t;
        return true;
      }),
      tomarPreguntaEnEspera: jest.fn(async () => {
        const t = espera;
        espera = null;
        return t;
      }),
      cerrar: jest.fn(async () => true),
      tocar: jest.fn(async () => undefined),
    };
    api = {
      sendMessage: jest.fn(async (_t: string, chat: string, texto: string) => {
        enviados.push({ chat, texto });
        return { ok: true, result: { message_id: 1 } };
      }),
      answerCallbackQuery: jest.fn(async () => ({ ok: true, result: true })),
      sendChatAction: jest.fn(async () => ({ ok: true, result: true })),
      quitarBotones: jest.fn(async () => ({ ok: true, result: true })),
    };
    ultimo = new Map();
    redis = {
      incr: jest.fn(async () => ++contador),
      expire: jest.fn(async () => 1),
      set: jest.fn(async (k: string, v: string) => {
        ultimo.set(k, v);
        return 'OK';
      }),
      get: jest.fn(async (k: string) => ultimo.get(k) ?? null),
    };
    respuestas = { responder: jest.fn(async () => ARMADA) };
    conversaciones = { updateMany: jest.fn(async () => ({ count: 1 })) };
    const prisma = {
      supportBotConversation: conversaciones,
      supportBotMessage: {
        create: jest.fn(async ({ data }) => {
          if (
            data.telegramUpdateId &&
            registrados.some(
              (r) => r.telegramUpdateId === data.telegramUpdateId,
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError('repetido', {
              code: 'P2002',
              clientVersion: 'x',
            });
          }
          registrados.push(data);
          return data;
        }),
      },
    };
    const config = {
      registrarEnvio: jest.fn(async () => undefined),
      runtime: jest.fn(async () => RT),
    };
    service = new SupportBotService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      api as unknown as TelegramApiClient,
      config as unknown as SupportBotConfigService,
      sesiones as unknown as SupportBotSessionService,
      respuestas as unknown as SupportBotAnswerService,
    );
    (service as unknown as { agruparMs: number }).agruparMs = 0;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('sin conversación', () => {
    it('un saludo: pide el código y no guarda nada', async () => {
      await service.procesar(msg('Hola!'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.pedirCodigo]);
      expect(sesiones.guardarPreguntaEnEspera).not.toHaveBeenCalled();
      expect(registrados).toEqual([]);
    });

    it('una pregunta: pide el código y la guarda para después (sin IA, sin base)', async () => {
      await service.procesar(msg('¿cómo copio la agenda del lunes?'), RT);
      expect(textos()).toEqual([
        `${TEXTOS_SOPORTE.pedirCodigo}\n\n${TEXTOS_SOPORTE.preguntaGuardada}`,
      ]);
      expect(espera).toBe('¿cómo copio la agenda del lunes?');
      expect(registrados).toEqual([]);
    });

    it('si Redis no guarda la pregunta, no promete responderla', async () => {
      sesiones.guardarPreguntaEnEspera.mockResolvedValue(false);
      await service.procesar(msg('¿cómo copio la agenda?'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.pedirCodigo]);
    });

    it('un código equivocado: cuenta el intento', async () => {
      await service.procesar(msg('482 913'), RT);
      expect(sesiones.validarCodigo).toHaveBeenCalledWith(
        expect.objectContaining({
          codigo: '482913',
          tipo: 'CORTO',
          telegramUserId: '777',
          chatId: '777',
          telegramName: 'Ana',
        }),
      );
      expect(textos()).toEqual([TEXTOS_SOPORTE.codigoIncorrecto(4)]);
    });

    it('bloqueado: lo dice con los minutos', async () => {
      resultado = { tipo: 'BLOQUEADO', minutos: 37 };
      await service.procesar(msg('482913'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.bloqueado(37)]);
    });

    it('sin acceso: lo dice', async () => {
      resultado = { tipo: 'SIN_ACCESO' };
      await service.procesar(msg('482913'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.sinAcceso]);
    });

    it('el código correcto: saluda con su rol y clínica, y responde la pregunta guardada', async () => {
      espera = '¿cómo copio la agenda?';
      resultado = { tipo: 'ABIERTA', interlocutor: ANA, chatsCerrados: [] };
      await service.procesar(msg('482913'), RT);
      expect(textos()).toEqual([
        'Listo, Ana. Hablas como Agente de Reservas de Hospital de Prueba (a***@clinica.co). Si no fuiste tú, escribe /salir.',
        'Pulsa «Clonar Día».',
      ]);
      // El código no queda registrado; la pregunta guardada, sí, y se responde con el manual.
      expect(registrados.map((r) => [r.direction, r.text])).toEqual([
        ['SALIDA', expect.stringContaining('Listo, Ana')],
        ['ENTRADA', '¿cómo copio la agenda?'],
        ['SALIDA', 'Pulsa «Clonar Día».'],
      ]);
    });

    it('el QR (/start con el código largo) abre la conversación', async () => {
      resultado = { tipo: 'ABIERTA', interlocutor: ANA, chatsCerrados: [] };
      const codigo = 'A'.repeat(32);
      await service.procesar(msg(`/start ${codigo}`), RT);
      expect(sesiones.validarCodigo).toHaveBeenCalledWith(
        expect.objectContaining({ codigo, tipo: 'ENLACE' }),
      );
      expect(textos()[0]).toContain('Listo, Ana');
    });

    it('al abrir, avisa a la conversación que se cerró en otra cuenta', async () => {
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: ['555'],
      };
      await service.procesar(msg('482913'), RT);
      expect(enviados[0]).toEqual({
        chat: '555',
        texto: TEXTOS_SOPORTE.cerradaPorOtra,
      });
    });

    it.each([
      ['/start', TEXTOS_SOPORTE.pedirCodigo],
      ['/start corto', TEXTOS_SOPORTE.pedirCodigo],
      ['/casos', TEXTOS_SOPORTE.pedirCodigo],
      ['/salir', TEXTOS_SOPORTE.sinConversacion],
    ])('«%s» sin conversación', async (texto, respuesta) => {
      await service.procesar(msg(texto), RT);
      expect(textos()).toEqual([respuesta]);
      expect(sesiones.validarCodigo).not.toHaveBeenCalled();
    });

    it('algo que no es texto: pide el código', async () => {
      await service.procesar(msg(null), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.pedirCodigo]);
    });
  });

  describe('con conversación', () => {
    beforeEach(() => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
    });

    it('una pregunta: queda registrada, mantiene viva la conversación y responde con el manual', async () => {
      await service.procesar(msg('¿cómo copio la agenda?', '200'), RT);
      expect(respuestas.responder).toHaveBeenCalledWith(
        ANA,
        RT,
        expect.any(Date),
      );
      expect(registrados).toEqual([
        expect.objectContaining({
          direction: 'ENTRADA',
          text: '¿cómo copio la agenda?',
          telegramUpdateId: '200',
          source: null,
        }),
        expect.objectContaining({
          direction: 'SALIDA',
          text: 'Pulsa «Clonar Día».',
          telegramUpdateId: null,
          // Lo que respondió la IA queda para las cifras: tipo, temas, tokens.
          source: 'IA',
          aiKind: 'respuesta',
          topics: ['agenda'],
          aiProvider: 'GEMINI',
          inputTokens: 30_000,
          outputTokens: 80,
          latencyMs: 1200,
          uncovered: false,
          telegramMessageId: '1',
        }),
      ]);
      expect(sesiones.tocar).toHaveBeenCalledWith('conv-1', expect.any(Date));
    });

    it('la respuesta lleva los botones «Me sirvió» / «No me sirvió» y muestra «escribiendo…»', async () => {
      await service.procesar(msg('¿cómo copio la agenda?'), RT);
      expect(api.sendChatAction).toHaveBeenCalledWith('TOKEN', '777');
      expect(api.sendMessage.mock.calls[0][3]).toEqual({
        botones: [
          [
            { texto: '✅ Me sirvió', datos: 's1:UTIL_SI' },
            { texto: '🙋 No me sirvió', datos: 's1:UTIL_NO' },
          ],
        ],
      });
    });

    it('sin botones cuando la respuesta no los lleva', async () => {
      respuestas.responder.mockResolvedValue({ ...ARMADA, botonesUtil: false });
      await service.procesar(msg('hola'), RT);
      expect(api.sendMessage.mock.calls[0][3]).toEqual({});
    });

    it('una pregunta que el manual no cubre marca la conversación', async () => {
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        botonesUtil: false,
        registro: { ...ARMADA.registro, uncovered: true, topics: [] },
      });
      await service.procesar(msg('¿puedo exportar a Excel?'), RT);
      expect(conversaciones.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { hadUncoveredQuestion: true },
      });
      expect(registrados[1]).toMatchObject({ uncovered: true });
    });

    it('sin IA, igual responde (y lo deja en el log)', async () => {
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        texto: 'Lo más cercano del manual…',
        botonesUtil: false,
        registro: { ...ARMADA.registro, source: 'SIN_IA', aiProvider: null },
        motivoSinIA: 'SIN_IA_CONFIGURADA',
      });
      await service.procesar(msg('¿cómo copio la agenda?'), RT);
      expect(textos()).toEqual(['Lo más cercano del manual…']);
      expect(registrados[1]).toMatchObject({ source: 'SIN_IA' });
    });

    it('si no hay nada pendiente, no responde', async () => {
      respuestas.responder.mockResolvedValue(null);
      await service.procesar(msg('hola'), RT);
      expect(enviados).toEqual([]);
    });

    it('🧩 mensajes seguidos: el primero no responde si detrás llegó otro; el último responde los dos', async () => {
      await service.alLlegar(msg('hola', '501'));
      await service.alLlegar(msg('no me deja clonar la agenda', '502'));
      await service.procesar(msg('hola', '501'), RT);
      expect(respuestas.responder).not.toHaveBeenCalled();
      await service.procesar(msg('no me deja clonar la agenda', '502'), RT);
      expect(respuestas.responder).toHaveBeenCalledTimes(1);
      // Los dos quedaron registrados; una sola respuesta.
      expect(registrados.filter((r) => r.direction === 'ENTRADA')).toHaveLength(
        2,
      );
      expect(textos()).toEqual(['Pulsa «Clonar Día».']);
    });

    it('alLlegar solo marca el texto libre (no comandos, códigos, botones ni lo que no es texto)', async () => {
      for (const t of ['/salir', '482 913', null])
        await service.alLlegar(msg(t, '9'));
      await service.alLlegar({
        accion: 'boton',
        updateId: '9',
        telegramUserId: '777',
        chatId: '777',
        nombre: null,
        callbackId: 'c',
        datos: 's1:UTIL_SI',
        messageId: 1,
      });
      expect(redis.set).not.toHaveBeenCalled();
      await service.alLlegar(msg('una pregunta', '10'));
      expect(redis.set).toHaveBeenCalledWith(
        'soporte:ultimo:777',
        '10',
        'EX',
        60,
      );
    });

    it('sin Redis, cada mensaje se responde por separado', async () => {
      redis.set.mockRejectedValue(new Error('caído'));
      redis.get.mockRejectedValue(new Error('caído'));
      await service.alLlegar(msg('hola', '601'));
      await service.procesar(msg('hola', '601'), RT);
      expect(respuestas.responder).toHaveBeenCalledTimes(1);
    });

    it('espera a que lleguen mensajes seguidos, contando desde que llegó', async () => {
      const esperas: number[] = [];
      (service as unknown as { agruparMs: number }).agruparMs = 2000;
      (
        service as unknown as { esperar: (ms: number) => Promise<void> }
      ).esperar = async (ms) => {
        esperas.push(ms);
      };
      await service.procesar(
        msg('hola', '701'),
        RT,
        new Date(),
        Date.now() - 500,
      );
      expect(esperas[0]).toBeGreaterThan(1400);
      expect(esperas[0]).toBeLessThanOrEqual(1500);
      await service.procesar(
        msg('hola', '702'),
        RT,
        new Date(),
        Date.now() - 5000,
      );
      expect(esperas[1]).toBe(0);
    });

    it('🔁 el mismo update_id dos veces se atiende una sola', async () => {
      await service.procesar(msg('hola', '300'), RT);
      await service.procesar(msg('hola', '300'), RT);
      expect(respuestas.responder).toHaveBeenCalledTimes(1);
    });

    it('/salir cierra la conversación', async () => {
      await service.procesar(msg('/salir'), RT);
      expect(sesiones.cerrar).toHaveBeenCalledWith(
        'conv-1',
        'SALIR',
        expect.any(Date),
      );
      expect(textos()).toEqual([TEXTOS_SOPORTE.conversacionCerrada]);
    });

    it.each([
      ['/start', TEXTOS_SOPORTE.yaConversando],
      ['/ayuda', TEXTOS_SOPORTE.ayuda],
      ['/casos', TEXTOS_SOPORTE.enConstruccion],
      ['/nuevo', TEXTOS_SOPORTE.enConstruccion],
    ])('«%s»', async (texto, respuesta) => {
      await service.procesar(msg(texto), RT);
      expect(textos()).toEqual([respuesta]);
    });

    it('un código nuevo abre otra conversación', async () => {
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: { ...ANA, conversationId: 'conv-2' },
        chatsCerrados: [],
      };
      await service.procesar(msg('482913'), RT);
      expect(sesiones.validarCodigo).toHaveBeenCalled();
      expect(registrados[0]).toMatchObject({
        conversationId: 'conv-2',
        direction: 'SALIDA',
      });
    });

    it('el QR con conversación abierta también abre otra', async () => {
      resultado = { tipo: 'ABIERTA', interlocutor: ANA, chatsCerrados: [] };
      await service.procesar(msg(`/start ${'B'.repeat(30)}`), RT);
      expect(sesiones.validarCodigo).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'ENLACE' }),
      );
    });

    it('algo que no es texto: lo dice y queda registrado', async () => {
      await service.procesar(msg(null, '400'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.soloTexto]);
      expect(registrados[0]).toMatchObject({
        direction: 'ENTRADA',
        text: '(mensaje que no es texto)',
        telegramUpdateId: '400',
      });
    });

    it('algo que no es texto, repetido, no se contesta dos veces', async () => {
      await service.procesar(msg(null, '401'), RT);
      await service.procesar(msg(null, '401'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.soloTexto]);
    });

    it('un mensaje vacío no hace nada', async () => {
      await service.procesar(msg('   '), RT);
      expect(enviados).toEqual([]);
    });
  });

  it('acceso revocado: lo dice', async () => {
    estado = { tipo: 'REVOCADA', chatId: '777' };
    await service.procesar(msg('hola'), RT);
    expect(textos()).toEqual([TEXTOS_SOPORTE.accesoRevocado]);
  });

  it('un mensaje demasiado largo: pide resumirlo y no lo procesa', async () => {
    estado = { tipo: 'VIGENTE', interlocutor: ANA };
    await service.procesar(msg('x'.repeat(2001)), RT);
    expect(textos()).toEqual([TEXTOS_SOPORTE.mensajeLargo(2000)]);
    expect(registrados).toEqual([]);
  });

  describe('tope de mensajes por hora', () => {
    it('al pasarlo avisa UNA vez y lo demás se ignora', async () => {
      contador = 40;
      await service.procesar(msg('hola', '1'), RT);
      await service.procesar(msg('hola', '2'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.muchosMensajes]);
      expect(sesiones.conversacionDe).not.toHaveBeenCalled();
    });

    it('la ventana de una hora empieza con el primer mensaje', async () => {
      await service.procesar(msg('hola'), RT);
      expect(redis.expire).toHaveBeenCalledWith('soporte:mensajes:777', 3600);
    });

    it('sin Redis, no hay tope (se atiende igual)', async () => {
      redis.incr.mockRejectedValue(new Error('redis caído'));
      await service.procesar(msg('hola'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.pedirCodigo]);
    });
  });

  describe('botones «Me sirvió» / «No me sirvió»', () => {
    const boton = (datos: string, messageId: number | null = 42) => ({
      accion: 'boton' as const,
      updateId: '900',
      telegramUserId: '777',
      chatId: '777',
      nombre: 'Ana',
      callbackId: 'cb',
      datos,
      messageId,
    });

    beforeEach(() => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
    });

    it('«Me sirvió»: lo agradece, quita los botones y lo anota', async () => {
      await service.procesar(boton('s1:UTIL_SI'), RT);
      expect(api.answerCallbackQuery).toHaveBeenCalledWith(
        'TOKEN',
        'cb',
        TEXTOS_SOPORTE.meSirvio,
      );
      expect(api.quitarBotones).toHaveBeenCalledWith('TOKEN', '777', 42);
      expect(conversaciones.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { feedback: 'UTIL' },
      });
      expect(enviados).toEqual([]);
    });

    it('«No me sirvió»: lo anota y ofrece seguir o reportarlo', async () => {
      await service.procesar(boton('s1:UTIL_NO'), RT);
      expect(conversaciones.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { feedback: 'NO_UTIL' },
      });
      expect(textos()).toEqual([TEXTOS_SOPORTE.noMeSirvio]);
    });

    it('sin el mensaje del botón, no intenta quitarlo', async () => {
      await service.procesar(boton('s1:UTIL_SI', null), RT);
      expect(api.quitarBotones).not.toHaveBeenCalled();
    });

    it('sin conversación abierta, pide el código', async () => {
      estado = { tipo: 'NINGUNA' };
      await service.procesar(boton('s1:UTIL_SI'), RT);
      expect(api.answerCallbackQuery).toHaveBeenCalledWith(
        'TOKEN',
        'cb',
        TEXTOS_SOPORTE.escribeElCodigo,
      );
      expect(conversaciones.updateMany).not.toHaveBeenCalled();
    });
  });

  it('un botón se responde para que Telegram no lo deje cargando', async () => {
    await service.procesar(
      {
        accion: 'boton',
        updateId: '9',
        telegramUserId: '777',
        chatId: '777',
        nombre: 'Ana',
        callbackId: 'cb',
        datos: 's1:CASO_SI',
        messageId: 7,
      },
      RT,
    );
    expect(api.answerCallbackQuery).toHaveBeenCalledWith('TOKEN', 'cb');
  });

  it('si Telegram no acepta el envío, lo anota y no lanza', async () => {
    api.sendMessage.mockResolvedValue({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    await expect(service.procesar(msg('hola'), RT)).resolves.toBeUndefined();
  });

  it('nunca lanza: un error inesperado queda en el log', async () => {
    sesiones.conversacionDe.mockRejectedValue(new Error('db caída'));
    await expect(service.procesar(msg('hola'), RT)).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('avisar el cierre desde el panel', async () => {
    await service.avisarCierreDesdePanel('777');
    expect(enviados).toEqual([
      { chat: '777', texto: TEXTOS_SOPORTE.cerradaDesdePanel },
    ]);
  });
});
