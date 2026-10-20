import { Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  FLUJO_VACIO,
  HORARIO_EQUIPO_POR_DEFECTO,
  TEXTOS_SOPORTE,
  type BorradorCaso,
  type CasoDeLaPersona,
  type FlujoConversacion,
  type RespuestaIA,
} from '@agenia/shared';
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
import type { SupportBotCasesService } from './support-bot-cases.service';
import type { SupportBotWatchService } from './support-bot-watch.service';

/**
 * El turno del asistente. Lo que no puede fallar:
 *  1. Sin conversación verificada no hay respuesta con contenido: solo se pide el código.
 *  2. La pregunta escrita antes del código se responde apenas se valida.
 *  3. Un reintento de Telegram (mismo update_id) no se atiende dos veces.
 *  4. 🔒 Un caso NUNCA se abre sin el «Sí» (S9), y una nota solo va a un caso suyo
 *     con su «Sí». La clínica y el autor salen de la conversación, no de la IA.
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
    maxAiTurnsPerOrgPerDay: 300,
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
  const ia = (cambios: Partial<RespuestaIA> = {}): RespuestaIA => ({
    tipo: 'respuesta',
    respuesta: 'Pulsa «Clonar Día».',
    temas: ['agenda'],
    urgencia: 'normal',
    caso: null,
    ampliarCaso: null,
    ...cambios,
  });
  const ARMADA: RespuestaArmada = {
    texto: 'Pulsa «Clonar Día».',
    botones: 'UTIL',
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
    ia: ia(),
    pendientes: ['¿cómo copio la agenda?'],
    turnoAnterior: [],
  };
  const CASO_COMPLETO = {
    titulo: 'No salen los recordatorios',
    descripcion:
      'Desde las 7 de la mañana no sale ningún recordatorio automático.',
    pantalla: '/dashboard/configuracion',
    falta: [],
  };
  const MIS_CASOS: CasoDeLaPersona[] = [
    {
      numero: 58,
      titulo: 'No salen los recordatorios',
      estado: 'IN_PROGRESS',
      creadoEn: new Date('2026-10-19T14:00:00Z'),
      tomadoEn: new Date('2026-10-19T14:30:00Z'),
      resueltoEn: null,
      respuesta: null,
    },
  ];
  const CONFIRMAR = ['s1:CASO_SI', 's1:CASO_CORREGIR', 's1:CASO_NO'];

  let enviados: Array<{ chat: string; texto: string; botones?: unknown }>;
  let registrados: Array<Record<string, unknown>>;
  let estado: EstadoConversacion;
  let resultado: ResultadoCodigo;
  let espera: string | null;
  let accionEspera: { datos: string; messageId: number | null } | null;
  let contador: number;
  let flujo: FlujoConversacion;
  let sesiones: Record<string, jest.Mock>;
  let api: Record<string, jest.Mock>;
  let redis: Record<string, jest.Mock>;
  let respuestas: { responder: jest.Mock };
  let casos: Record<string, jest.Mock>;
  let conversaciones: { updateMany: jest.Mock };
  let vigilancia: { contar: jest.Mock };
  let ultimo: Map<string, string>;
  let service: SupportBotService;

  const msg = (texto: string | null, updateId = String(Math.random())) => ({
    accion: 'mensaje' as const,
    updateId,
    telegramUserId: '777',
    chatId: '777',
    nombre: 'Ana',
    texto,
  });
  const boton = (datos: string, messageId: number | null = 42) => ({
    accion: 'boton' as const,
    updateId: String(Math.random()),
    telegramUserId: '777',
    chatId: '777',
    nombre: 'Ana',
    callbackId: 'cb',
    datos,
    messageId,
  });
  const textos = () => enviados.map((e) => e.texto);
  const teclado = (i = enviados.length - 1) =>
    (enviados[i]?.botones as Array<Array<{ datos: string }>> | undefined)
      ?.flat()
      .map((b) => b.datos);
  const borrador = (cambios: Partial<BorradorCaso> = {}): BorradorCaso => ({
    fase: 'CONFIRMANDO',
    ...CASO_COMPLETO,
    prioridad: 'HIGH',
    creadoEn: new Date().toISOString(),
    venceEn: null,
    ...cambios,
  });

  beforeEach(() => {
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    enviados = [];
    registrados = [];
    estado = { tipo: 'NINGUNA' };
    resultado = { tipo: 'INVALIDO', restantes: 4 };
    espera = null;
    accionEspera = null;
    contador = 0;
    flujo = { ...FLUJO_VACIO };
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
      guardarAccionEnEspera: jest.fn(
        async (_id: string, a: { datos: string; messageId: number | null }) => {
          accionEspera = a;
          return true;
        },
      ),
      tomarAccionEnEspera: jest.fn(async () => {
        const a = accionEspera;
        accionEspera = null;
        return a;
      }),
    };
    api = {
      sendMessage: jest.fn(
        async (
          _t: string,
          chat: string,
          texto: string,
          opts?: { botones?: unknown },
        ) => {
          enviados.push({ chat, texto, botones: opts?.botones });
          return { ok: true, result: { message_id: enviados.length } };
        },
      ),
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
    casos = {
      leerFlujo: jest.fn(async () => flujo),
      guardarFlujo: jest.fn(async (_id: string, f: FlujoConversacion) => {
        flujo = f;
      }),
      casosDe: jest.fn(async () => MIS_CASOS),
      abrirCaso: jest.fn(async () => 59),
      agregarNota: jest.fn(async () => true),
      recibeAvisos: jest.fn(async () => true),
      casoDelAviso: jest.fn(async () => ({
        numero: 58,
        titulo: 'No salen los recordatorios',
        estado: 'RESOLVED',
        respuesta: 'Se reinició el envío.',
      })),
      reabrir: jest.fn(async () => true),
      textosSinResponder: jest.fn(async () => []),
    };
    conversaciones = { updateMany: jest.fn(async () => ({ count: 1 })) };
    vigilancia = { contar: jest.fn(async () => undefined) };
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
      horario: jest.fn(async () => HORARIO_EQUIPO_POR_DEFECTO),
    };
    service = new SupportBotService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      api as unknown as TelegramApiClient,
      config as unknown as SupportBotConfigService,
      sesiones as unknown as SupportBotSessionService,
      respuestas as unknown as SupportBotAnswerService,
      casos as unknown as SupportBotCasesService,
      vigilancia as unknown as SupportBotWatchService,
    );
    (service as unknown as { agruparMs: number }).agruparMs = 0;
  });

  afterEach(() => jest.restoreAllMocks());

  // ── Sin conversación ─────────────────────────────────────────────────────

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
      expect(respuestas.responder).not.toHaveBeenCalled();
    });

    it('si Redis no guarda la pregunta, no promete responderla', async () => {
      sesiones.guardarPreguntaEnEspera.mockResolvedValue(false);
      await service.procesar(msg('¿cómo copio la agenda?'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.pedirCodigo]);
    });

    it('un código equivocado, bloqueado o sin acceso: lo dice', async () => {
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
      resultado = { tipo: 'BLOQUEADO', minutos: 37 };
      await service.procesar(msg('482913'), RT);
      resultado = { tipo: 'SIN_ACCESO' };
      await service.procesar(msg('482913'), RT);
      expect(textos()).toEqual([
        TEXTOS_SOPORTE.codigoIncorrecto(4),
        TEXTOS_SOPORTE.bloqueado(37),
        TEXTOS_SOPORTE.sinAcceso,
      ]);
    });

    it('el código correcto: saluda con su rol y clínica, y responde la pregunta guardada', async () => {
      espera = '¿cómo copio la agenda?';
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: [],
        borradorRetomado: null,
      };
      await service.procesar(msg('482913'), RT);
      expect(textos()).toEqual([
        'Listo, Ana. Hablas como Agente de Reservas de Hospital de Prueba (a***@clinica.co). Si no fuiste tú, escribe /salir.',
        'Pulsa «Clonar Día».',
      ]);
      expect(registrados.map((r) => [r.direction, r.text])).toEqual([
        ['SALIDA', expect.stringContaining('Listo, Ana')],
        ['ENTRADA', '¿cómo copio la agenda?'],
        ['SALIDA', 'Pulsa «Clonar Día».'],
      ]);
    });

    it('el QR (/start con el código largo) abre la conversación', async () => {
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: [],
        borradorRetomado: null,
      };
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
        borradorRetomado: null,
      };
      await service.procesar(msg('482913'), RT);
      expect(enviados[0]).toMatchObject({
        chat: '555',
        texto: TEXTOS_SOPORTE.cerradaPorOtra,
      });
    });

    it('al abrir, ofrece el caso que quedó listo para confirmar, con sus botones', async () => {
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: [],
        borradorRetomado: borrador(),
      };
      await service.procesar(msg('482913'), RT);
      expect(textos()[1]).toContain(
        TEXTOS_SOPORTE.retomarBorrador('No salen los recordatorios', true),
      );
      expect(textos()[1]).toContain('Este es el caso que abriría:');
      expect(teclado(1)).toEqual(CONFIRMAR);
    });

    it('al abrir, uno a medio armar: pide lo que falta, sin botones', async () => {
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: [],
        borradorRetomado: borrador({
          fase: 'RECOPILANDO',
          falta: ['desde cuándo'],
        }),
      };
      await service.procesar(msg('482913'), RT);
      expect(textos()[1]).toBe(
        TEXTOS_SOPORTE.retomarBorrador('No salen los recordatorios', false),
      );
      expect(teclado(1)).toBeUndefined();
    });

    it.each([
      ['/start', TEXTOS_SOPORTE.pedirCodigo],
      ['/start corto', TEXTOS_SOPORTE.pedirCodigo],
      ['/casos', TEXTOS_SOPORTE.pedirCodigo],
      ['/nuevo', TEXTOS_SOPORTE.pedirCodigo],
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

    it('🩺 cada mensaje sin código cuenta para las cifras (los códigos y /salir, no)', async () => {
      await service.procesar(msg('hola'), RT);
      await service.procesar(msg('/casos'), RT);
      await service.procesar(msg(null), RT);
      expect(vigilancia.contar).toHaveBeenCalledTimes(3);
      expect(vigilancia.contar).toHaveBeenCalledWith('sinCodigo');
      await service.procesar(msg('482913'), RT);
      await service.procesar(msg('/salir'), RT);
      expect(vigilancia.contar).toHaveBeenCalledTimes(3);
    });
  });

  // ── Con conversación ─────────────────────────────────────────────────────

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
        { pedirCaso: false, borrador: null, casos: MIS_CASOS },
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
      expect(api.sendChatAction).toHaveBeenCalledWith('TOKEN', '777');
    });

    it('los botones de cada respuesta: «Me sirvió», ofrecer el caso, o ninguno', async () => {
      await service.procesar(msg('a'), RT);
      expect(teclado()).toEqual(['s1:UTIL_SI', 's1:UTIL_NO']);
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        botones: 'OFRECER_CASO',
      });
      await service.procesar(msg('b'), RT);
      expect(teclado()).toEqual(['s1:CASO_NUEVO', 's1:CASO_NO']);
      respuestas.responder.mockResolvedValue({ ...ARMADA, botones: null });
      await service.procesar(msg('c'), RT);
      expect(teclado()).toBeUndefined();
    });

    it('una pregunta que el manual no cubre marca la conversación', async () => {
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        registro: { ...ARMADA.registro, uncovered: true, topics: [] },
      });
      await service.procesar(msg('¿puedo exportar a Excel?'), RT);
      expect(conversaciones.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { hadUncoveredQuestion: true },
      });
    });

    it('sin IA, igual responde (y lo deja en el log); si no hay nada pendiente, no responde', async () => {
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        texto: 'Lo más cercano del manual…',
        botones: 'OFRECER_CASO',
        ia: null,
        registro: { ...ARMADA.registro, source: 'SIN_IA', aiProvider: null },
        motivoSinIA: 'SIN_IA_CONFIGURADA',
      });
      await service.procesar(msg('¿cómo copio la agenda?'), RT);
      expect(textos()).toEqual(['Lo más cercano del manual…']);
      expect(registrados[1]).toMatchObject({ source: 'SIN_IA' });
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Respuesta del asistente sin IA (SIN_IA_CONFIGURADA).',
      );
      respuestas.responder.mockResolvedValue(null);
      await service.procesar(msg('hola'), RT);
      expect(textos()).toHaveLength(1);
    });

    it('🧩 mensajes seguidos: el primero no responde si detrás llegó otro; el último responde los dos', async () => {
      await service.alLlegar(msg('hola', '501'));
      await service.alLlegar(msg('no me deja clonar la agenda', '502'));
      await service.procesar(msg('hola', '501'), RT);
      expect(respuestas.responder).not.toHaveBeenCalled();
      await service.procesar(msg('no me deja clonar la agenda', '502'), RT);
      expect(respuestas.responder).toHaveBeenCalledTimes(1);
      expect(registrados.filter((r) => r.direction === 'ENTRADA')).toHaveLength(
        2,
      );
    });

    it('alLlegar solo marca el texto libre (no comandos, códigos, botones ni lo que no es texto)', async () => {
      for (const t of ['/salir', '482 913', null])
        await service.alLlegar(msg(t, '9'));
      await service.alLlegar(boton('s1:UTIL_SI'));
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

    it('la espera de verdad (sin sobrescribir) también termina', async () => {
      (service as unknown as { agruparMs: number }).agruparMs = 20;
      await service.procesar(msg('hola', '703'), RT, new Date(), Date.now());
      expect(respuestas.responder).toHaveBeenCalledTimes(1);
    });

    it('🔁 el mismo update_id dos veces se atiende una sola', async () => {
      await service.procesar(msg('hola', '300'), RT);
      await service.procesar(msg('hola', '300'), RT);
      expect(respuestas.responder).toHaveBeenCalledTimes(1);
    });

    it('/salir cierra; /start y /ayuda responden fijo', async () => {
      await service.procesar(msg('/salir'), RT);
      expect(sesiones.cerrar).toHaveBeenCalledWith(
        'conv-1',
        'SALIR',
        expect.any(Date),
      );
      await service.procesar(msg('/start'), RT);
      await service.procesar(msg('/ayuda'), RT);
      expect(textos()).toEqual([
        TEXTOS_SOPORTE.conversacionCerrada,
        TEXTOS_SOPORTE.yaConversando,
        TEXTOS_SOPORTE.ayuda,
      ]);
    });

    it('/casos: su lista (sin IA), o que no tiene', async () => {
      await service.procesar(msg('/casos'), RT);
      expect(textos()[0]).toContain(
        '• #58 «No salen los recordatorios»: en atención desde',
      );
      casos.casosDe.mockResolvedValue([]);
      await service.procesar(msg('/casos'), RT);
      expect(textos()[1]).toBe(TEXTOS_SOPORTE.sinCasos);
      expect(respuestas.responder).not.toHaveBeenCalled();
    });

    it('/nuevo: pide que cuente y deja la conversación esperando el caso', async () => {
      flujo = {
        ...FLUJO_VACIO,
        notaPendiente: { caso: 58, texto: 'x' },
      };
      await service.procesar(msg('/nuevo'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.contarFalla]);
      expect(flujo).toMatchObject({ modoCaso: true, notaPendiente: null });
      expect(respuestas.responder).not.toHaveBeenCalled();
    });

    it('/nuevo con algo contado: arma el caso de una vez', async () => {
      await service.procesar(msg('/nuevo no carga la agenda'), RT);
      expect(respuestas.responder).toHaveBeenCalledWith(
        ANA,
        RT,
        expect.any(Date),
        expect.objectContaining({ pedirCaso: true }),
      );
    });

    it('un código nuevo o el QR abre otra conversación', async () => {
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: { ...ANA, conversationId: 'conv-2' },
        chatsCerrados: [],
        borradorRetomado: null,
      };
      await service.procesar(msg('482913'), RT);
      await service.procesar(msg(`/start ${'B'.repeat(30)}`), RT);
      expect(sesiones.validarCodigo).toHaveBeenCalledTimes(2);
      expect(registrados[0]).toMatchObject({
        conversationId: 'conv-2',
        direction: 'SALIDA',
      });
    });

    it('algo que no es texto: lo dice una vez y queda registrado', async () => {
      await service.procesar(msg(null, '400'), RT);
      await service.procesar(msg(null, '400'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.soloTexto]);
      expect(registrados[0]).toMatchObject({
        direction: 'ENTRADA',
        text: '(mensaje que no es texto)',
        telegramUpdateId: '400',
      });
    });

    it('un mensaje vacío no hace nada', async () => {
      await service.procesar(msg('   '), RT);
      expect(enviados).toEqual([]);
    });
  });

  // ── El caso (§3.4) ───────────────────────────────────────────────────────

  describe('🔒 el caso: la IA lo arma, el código lo muestra y solo el «Sí» lo abre', () => {
    beforeEach(() => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
    });

    const falla = (
      caso: RespuestaIA['caso'],
      pendientes = ['nadie puede agendar, no salen los recordatorios'],
    ) =>
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        botones: null,
        ia: ia({
          tipo: 'falla',
          respuesta: 'Entiendo, con pacientes esperando es urgente.',
          temas: [],
          urgencia: 'alta',
          caso,
        }),
        pendientes,
      });

    it('una falla completa: la respuesta, el borrador con prioridad alta y los botones; nada se abre', async () => {
      falla(CASO_COMPLETO);
      await service.procesar(
        msg('nadie puede agendar, no salen los recordatorios'),
        RT,
      );
      expect(textos()[0]).toBe(
        [
          'Entiendo, con pacientes esperando es urgente.',
          '',
          'Este es el caso que abriría:',
          '',
          '«No salen los recordatorios»',
          'Prioridad: alta (frena la atención de pacientes)',
          'Pantalla: /dashboard/configuracion',
          'Detalle: Desde las 7 de la mañana no sale ningún recordatorio automático.',
          '',
          '¿Lo abro?',
        ].join('\n'),
      );
      expect(teclado()).toEqual(CONFIRMAR);
      expect(flujo.borrador).toMatchObject({
        fase: 'CONFIRMANDO',
        prioridad: 'HIGH',
      });
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('una falla a la que le falta algo: pregunta (la IA) y queda esperando, sin botones', async () => {
      falla({ ...CASO_COMPLETO, falta: ['desde cuándo pasa'] });
      await service.procesar(msg('no salen'), RT);
      expect(textos()).toEqual([
        'Entiendo, con pacientes esperando es urgente.',
      ]);
      expect(teclado()).toBeUndefined();
      expect(flujo).toMatchObject({
        modoCaso: true,
        borrador: { fase: 'RECOPILANDO' },
      });
    });

    it('la IA recibe el borrador en curso y el pedido de caso en el turno siguiente', async () => {
      flujo = {
        borrador: borrador({ fase: 'RECOPILANDO', falta: ['desde cuándo'] }),
        notaPendiente: null,
        modoCaso: true,
      };
      await service.procesar(msg('desde las 7'), RT);
      expect(respuestas.responder).toHaveBeenCalledWith(
        ANA,
        RT,
        expect.any(Date),
        expect.objectContaining({
          pedirCaso: true,
          borrador: expect.objectContaining({ fase: 'RECOPILANDO' }),
        }),
      );
    });

    it('en modo caso, una respuesta que no es falla pero trae el caso también lo arma', async () => {
      flujo = { ...FLUJO_VACIO, modoCaso: true };
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        ia: ia({ caso: CASO_COMPLETO }),
      });
      await service.procesar(msg('no salen los recordatorios'), RT);
      expect(teclado()).toEqual(CONFIRMAR);
    });

    it('🔺 con IA, la alta ya confirmada se mantiene mientras la IA siga diciendo «alta»', async () => {
      flujo = {
        borrador: borrador({ fase: 'RECOPILANDO', prioridad: 'HIGH' }),
        notaPendiente: null,
        modoCaso: true,
      };
      falla(CASO_COMPLETO, ['también pasa con el Dr. Ruiz']);
      await service.procesar(msg('también pasa con el Dr. Ruiz'), RT);
      expect(flujo.borrador?.prioridad).toBe('HIGH');
    });

    it('la urgencia de la IA sin una señal fija en lo que escribió queda normal', async () => {
      falla(CASO_COMPLETO, ['el botón de guardar está gris']);
      await service.procesar(msg('el botón de guardar está gris'), RT);
      expect(flujo.borrador?.prioridad).toBe('NORMAL');
      expect(textos()[0]).toContain('Prioridad: normal');
    });

    it.each(['sí', 'Sí, ábrelo', '👍'])(
      '«%s» escrito: abre el caso con su número y cuándo lo ve el equipo, sin pasar por la IA',
      async (si) => {
        flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
        await service.procesar(msg(si), RT);
        expect(casos.abrirCaso).toHaveBeenCalledWith(
          ANA,
          expect.objectContaining({
            titulo: 'No salen los recordatorios',
            prioridad: 'HIGH',
          }),
        );
        expect(textos()[0]).toMatch(
          /^Listo, abrí el caso #59: «No salen los recordatorios»\. El equipo técnico .*Te escribo por aquí cuando lo tomen y cuando quede resuelto\.$/,
        );
        expect(flujo).toEqual(FLUJO_VACIO);
        expect(respuestas.responder).not.toHaveBeenCalled();
      },
    );

    it('con los avisos de sus casos apagados, no promete escribirle', async () => {
      casos.recibeAvisos.mockResolvedValue(false);
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(msg('sí'), RT);
      expect(textos()[0]).toMatch(
        /Puedes ver cómo va con \/casos o en el panel › Soporte\.$/,
      );
    });

    it('el botón «Sí, ábrelo»: abre, responde el toque y quita los botones; un segundo toque no abre otro', async () => {
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(boton('s1:CASO_SI'), RT);
      expect(api.answerCallbackQuery).toHaveBeenCalledWith(
        'TOKEN',
        'cb',
        undefined,
      );
      expect(api.quitarBotones).toHaveBeenCalledWith('TOKEN', '777', 42);
      expect(casos.abrirCaso).toHaveBeenCalledTimes(1);
      await service.procesar(boton('s1:CASO_SI'), RT);
      expect(casos.abrirCaso).toHaveBeenCalledTimes(1);
      expect(textos()[1]).toBe(TEXTOS_SOPORTE.borradorVencido);
    });

    it('«no, gracias»: lo descarta', async () => {
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(msg('no, gracias'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.casoDescartado]);
      expect(flujo.borrador).toBeNull();
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('«Corregir algo»: pide qué cambia y vuelve a armarlo', async () => {
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(boton('s1:CASO_CORREGIR'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.pedirCorreccion]);
      expect(flujo).toMatchObject({
        modoCaso: true,
        borrador: { fase: 'RECOPILANDO' },
      });
    });

    it('un «sí» a un borrador incompleto pide lo que falta', async () => {
      flujo = {
        borrador: borrador({ descripcion: 'corto' }),
        notaPendiente: null,
        modoCaso: false,
      };
      await service.procesar(msg('sí'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.contarFalla]);
      expect(flujo.modoCaso).toBe(true);
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('«no puedo agendar» no es un «no»: va a la IA', async () => {
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(msg('no puedo agendar'), RT);
      expect(respuestas.responder).toHaveBeenCalled();
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('un «sí» sin nada pendiente va a la IA como cualquier mensaje', async () => {
      await service.procesar(msg('sí'), RT);
      expect(respuestas.responder).toHaveBeenCalled();
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('un «sí» a un borrador que todavía no se mostró (a medio armar) va a la IA', async () => {
      flujo = {
        borrador: borrador({ fase: 'RECOPILANDO' }),
        notaPendiente: null,
        modoCaso: true,
      };
      await service.procesar(msg('sí'), RT);
      expect(respuestas.responder).toHaveBeenCalled();
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('en modo prueba el caso se simula', async () => {
      estado = { tipo: 'VIGENTE', interlocutor: { ...ANA, isTest: true } };
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(msg('sí'), RT);
      expect(casos.abrirCaso).not.toHaveBeenCalled();
      expect(textos()).toEqual([
        TEXTOS_SOPORTE.casoSimulado('No salen los recordatorios'),
      ]);
    });

    it('«No, abrir un caso» y «Abrir un caso»: el caso se arma con lo que ya contó', async () => {
      await service.procesar(boton('s1:UTIL_NO'), RT);
      expect(conversaciones.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { feedback: 'NO_UTIL' },
      });
      expect(registrados[0]).toMatchObject({
        direction: 'ENTRADA',
        text: '/nuevo',
      });
      expect(respuestas.responder).toHaveBeenCalledWith(
        ANA,
        RT,
        expect.any(Date),
        expect.objectContaining({ pedirCaso: true }),
      );
      await service.procesar(boton('s1:CASO_NUEVO'), RT);
      expect(respuestas.responder).toHaveBeenCalledTimes(2);
      // «Abrir un caso» no cuenta como «no me sirvió».
      expect(conversaciones.updateMany).toHaveBeenCalledTimes(1);
    });

    it('«No, gracias» al ofrecimiento (sin borrador): solo quita los botones', async () => {
      await service.procesar(boton('s1:CASO_NO'), RT);
      expect(api.quitarBotones).toHaveBeenCalled();
      expect(enviados).toEqual([]);
    });

    describe('sin IA', () => {
      const sinIA = (pendientes: string[]) =>
        respuestas.responder.mockResolvedValue({
          ...ARMADA,
          texto: 'Lo más cercano del manual…',
          botones: 'OFRECER_CASO',
          ia: null,
          motivoSinIA: 'FALLO',
          pendientes,
        });

      it('el caso se arma con lo que escribió y se muestra para confirmar', async () => {
        flujo = { ...FLUJO_VACIO, modoCaso: true };
        sinIA(['nadie puede agendar desde las 8 de la mañana']);
        await service.procesar(
          msg('nadie puede agendar desde las 8 de la mañana'),
          RT,
        );
        expect(textos()[0]).toMatch(/^Este es el caso que abriría:/);
        expect(textos()[0]).toContain('Prioridad: alta');
        expect(teclado()).toEqual(CONFIRMAR);
      });

      it('si escribió muy poco, pide que cuente más', async () => {
        flujo = { ...FLUJO_VACIO, modoCaso: true };
        sinIA(['/nuevo', 'x']);
        await service.procesar(msg('x'), RT);
        expect(textos()).toEqual([TEXTOS_SOPORTE.contarFalla]);
        expect(flujo.modoCaso).toBe(true);
      });

      it('«Abrir un caso» sin escribir nada: el borrador sale de lo que contó antes', async () => {
        respuestas.responder.mockResolvedValue({
          ...ARMADA,
          ia: null,
          motivoSinIA: 'SIN_IA_CONFIGURADA',
          pendientes: ['/nuevo'],
          turnoAnterior: [
            'La agenda del Dr. Ruiz no deja copiar el lunes.',
            'Sale un error rojo.',
          ],
        });
        await service.procesar(boton('s1:CASO_NUEVO'), RT);
        expect(textos()[0]).toContain(
          '«La agenda del Dr. Ruiz no deja copiar el lunes»',
        );
        expect(textos()[0]).toContain('Sale un error rojo.');
        expect(teclado()).toEqual(CONFIRMAR);
      });

      it('lo del turno anterior no se mezcla con un borrador en curso ni con lo recién escrito', async () => {
        respuestas.responder.mockResolvedValue({
          ...ARMADA,
          ia: null,
          motivoSinIA: 'FALLO',
          pendientes: ['El botón de imprimir no hace nada.'],
          turnoAnterior: ['¿cómo copio la agenda?'],
        });
        flujo = { ...FLUJO_VACIO, modoCaso: true };
        await service.procesar(msg('El botón de imprimir no hace nada.'), RT);
        expect(textos()[0]).not.toContain('copio la agenda');
      });

      it('🔺 una corrección no le baja la prioridad alta', async () => {
        flujo = {
          borrador: borrador({ fase: 'RECOPILANDO', prioridad: 'HIGH' }),
          notaPendiente: null,
          modoCaso: true,
        };
        sinIA(['también pasa con la agenda del Dr. Ruiz']);
        await service.procesar(
          msg('también pasa con la agenda del Dr. Ruiz'),
          RT,
        );
        expect(flujo.borrador?.prioridad).toBe('HIGH');
        expect(textos()[0]).toContain('Prioridad: alta');
      });

      it('una corrección se suma a lo que ya tenía el borrador', async () => {
        flujo = {
          borrador: borrador({
            fase: 'RECOPILANDO',
            titulo: 'No carga la agenda',
            descripcion: 'No carga la agenda del Dr. Ruiz.',
          }),
          notaPendiente: null,
          modoCaso: true,
        };
        sinIA(['desde las 8 de la mañana']);
        await service.procesar(msg('desde las 8 de la mañana'), RT);
        expect(flujo.borrador?.descripcion).toBe(
          'No carga la agenda del Dr. Ruiz. desde las 8 de la mañana',
        );
      });

      it('fuera del modo caso, responde lo del manual con su ofrecimiento', async () => {
        sinIA(['¿cómo copio la agenda?']);
        await service.procesar(msg('¿cómo copio la agenda?'), RT);
        expect(textos()).toEqual(['Lo más cercano del manual…']);
        expect(teclado()).toEqual(['s1:CASO_NUEVO', 's1:CASO_NO']);
        expect(flujo.borrador).toBeNull();
      });
    });
  });

  // ── Ampliar un caso suyo ─────────────────────────────────────────────────

  describe('🔒 ampliar uno de SUS casos: solo con su «Sí»', () => {
    beforeEach(() => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
    });

    it('la IA lo reconoce: se le pregunta antes de agregarlo', async () => {
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        ia: ia({
          tipo: 'seguimiento_caso',
          respuesta: 'Entendido.',
          ampliarCaso: 58,
        }),
        pendientes: ['/nuevo', 'agrégale que también pasa con el Dr. Ruiz'],
      });
      await service.procesar(
        msg('agrégale que también pasa con el Dr. Ruiz'),
        RT,
      );
      expect(textos()).toEqual([
        `Entendido.\n\n${TEXTOS_SOPORTE.confirmarNota(58)}`,
      ]);
      expect(teclado()).toEqual(['s1:NOTA_SI', 's1:NOTA_NO']);
      expect(flujo.notaPendiente).toEqual({
        caso: 58,
        texto: 'agrégale que también pasa con el Dr. Ruiz',
      });
      expect(casos.agregarNota).not.toHaveBeenCalled();
    });

    it('un caso que no es suyo (o ya solucionado) no se ofrece', async () => {
      respuestas.responder.mockResolvedValue({
        ...ARMADA,
        ia: ia({ ampliarCaso: 99 }),
      });
      await service.procesar(msg('agrégale esto al 99'), RT);
      expect(flujo.notaPendiente).toBeNull();
      expect(teclado()).toEqual(['s1:UTIL_SI', 's1:UTIL_NO']);
    });

    it('«Sí, agrégalo»: la nota va al caso', async () => {
      flujo = {
        ...FLUJO_VACIO,
        notaPendiente: { caso: 58, texto: 'también pasa con el Dr. Ruiz' },
      };
      await service.procesar(boton('s1:NOTA_SI'), RT);
      expect(casos.agregarNota).toHaveBeenCalledWith(
        ANA,
        58,
        'también pasa con el Dr. Ruiz',
      );
      expect(textos()).toEqual([TEXTOS_SOPORTE.notaAgregada(58)]);
      expect(flujo.notaPendiente).toBeNull();
    });

    it('si el caso se solucionó mientras tanto, lo dice', async () => {
      casos.agregarNota.mockResolvedValue(false);
      flujo = { ...FLUJO_VACIO, notaPendiente: { caso: 58, texto: 'x' } };
      await service.procesar(msg('sí'), RT);
      expect(textos()).toEqual([TEXTOS_SOPORTE.borradorVencido]);
    });

    it('«No» (o «corregir»): no agrega nada', async () => {
      flujo = { ...FLUJO_VACIO, notaPendiente: { caso: 58, texto: 'x' } };
      await service.procesar(boton('s1:NOTA_NO'), RT);
      flujo = { ...FLUJO_VACIO, notaPendiente: { caso: 58, texto: 'x' } };
      await service.procesar(msg('corregir'), RT);
      expect(casos.agregarNota).not.toHaveBeenCalled();
      expect(textos()).toEqual([
        TEXTOS_SOPORTE.notaDescartada,
        TEXTOS_SOPORTE.notaDescartada,
      ]);
    });

    it('en modo prueba la nota se simula', async () => {
      estado = { tipo: 'VIGENTE', interlocutor: { ...ANA, isTest: true } };
      flujo = { ...FLUJO_VACIO, notaPendiente: { caso: 58, texto: 'x' } };
      await service.procesar(msg('sí'), RT);
      expect(casos.agregarNota).not.toHaveBeenCalled();
      expect(textos()).toEqual([TEXTOS_SOPORTE.notaAgregada(58)]);
    });
  });

  // ── Otros ────────────────────────────────────────────────────────────────

  describe('botones', () => {
    it('«Me sirvió»: lo agradece, quita los botones y lo anota', async () => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
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

    it('sin el mensaje del botón, no intenta quitarlo', async () => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
      await service.procesar(boton('s1:UTIL_SI', null), RT);
      expect(api.quitarBotones).not.toHaveBeenCalled();
    });

    it('sin conversación abierta, pide el código y no abre nada', async () => {
      flujo = { borrador: borrador(), notaPendiente: null, modoCaso: false };
      await service.procesar(boton('s1:CASO_SI'), RT);
      expect(api.answerCallbackQuery).toHaveBeenCalledWith(
        'TOKEN',
        'cb',
        TEXTOS_SOPORTE.escribeElCodigo,
      );
      expect(casos.abrirCaso).not.toHaveBeenCalled();
    });

    it('los que no son del asistente (o de otra versión) solo se responden', async () => {
      await service.procesar(boton('otro:cosa'), RT);
      await service.procesar(boton('s1:INCIDENTE_AVISAR:abc'), RT);
      expect(api.answerCallbackQuery).toHaveBeenCalledTimes(2);
      expect(sesiones.conversacionDe).not.toHaveBeenCalled();
    });
  });

  // ── Los avisos de sus casos (Fase 4, §3.6) ───────────────────────────────

  describe('📣 los avisos de sus casos', () => {
    it('«Sí, gracias»: lo agradece y quita los botones, sin pedir el código', async () => {
      await service.procesar(boton('s1:AVISO_BIEN:58'), RT);
      expect(api.answerCallbackQuery).toHaveBeenCalledWith(
        'TOKEN',
        'cb',
        TEXTOS_SOPORTE.avisoBien,
      );
      expect(api.quitarBotones).toHaveBeenCalledWith('TOKEN', '777', 42);
      expect(sesiones.conversacionDe).not.toHaveBeenCalled();
      expect(enviados).toEqual([]);
    });

    it('🔒 sin conversación, «Ver la respuesta» y «No, sigue pasando» piden el código y esperan', async () => {
      await service.procesar(boton('s1:AVISO_VER:58'), RT);
      expect(accionEspera).toEqual({ datos: 's1:AVISO_VER:58', messageId: 42 });
      expect(textos()).toEqual([TEXTOS_SOPORTE.accionEnEspera]);
      expect(casos.casoDelAviso).not.toHaveBeenCalled();
      await service.procesar(boton('s1:AVISO_SIGUE:58'), RT);
      expect(accionEspera).toEqual({
        datos: 's1:AVISO_SIGUE:58',
        messageId: 42,
      });
      expect(casos.reabrir).not.toHaveBeenCalled();
    });

    it('al dar el código, hace lo que esperaba: muestra la respuesta con el «¿quedó bien?»', async () => {
      accionEspera = { datos: 's1:AVISO_VER:58', messageId: 42 };
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: [],
        borradorRetomado: null,
      };
      await service.procesar(msg('482913'), RT);
      expect(casos.casoDelAviso).toHaveBeenCalledWith(ANA, 58);
      expect(api.quitarBotones).toHaveBeenCalledWith('TOKEN', '777', 42);
      expect(textos()[1]).toBe(
        TEXTOS_SOPORTE.respuestaDelCaso(58, 'Se reinició el envío.'),
      );
      expect(teclado(1)).toEqual(['s1:AVISO_BIEN:58', 's1:AVISO_SIGUE:58']);
    });

    it('una acción en espera que no es de un aviso no se hace', async () => {
      accionEspera = { datos: 's1:CASO_SI', messageId: null };
      resultado = {
        tipo: 'ABIERTA',
        interlocutor: ANA,
        chatsCerrados: [],
        borradorRetomado: null,
      };
      await service.procesar(msg('482913'), RT);
      expect(casos.casoDelAviso).not.toHaveBeenCalled();
      expect(casos.abrirCaso).not.toHaveBeenCalled();
      expect(textos()).toHaveLength(1);
    });

    describe('con conversación', () => {
      beforeEach(() => {
        estado = { tipo: 'VIGENTE', interlocutor: ANA };
      });

      it('«Ver la respuesta» de un caso que ya no está solucionado: cómo van sus casos', async () => {
        casos.casoDelAviso.mockResolvedValue({
          numero: 58,
          titulo: 'x',
          estado: 'OPEN',
          respuesta: 'vieja',
        });
        await service.procesar(boton('s1:AVISO_VER:58'), RT);
        expect(textos()[0]).toMatch(/^Tus casos más recientes:/);
      });

      it('🔒 el aviso de un caso de otra persona (el celular cambió de manos): no hace nada', async () => {
        casos.casoDelAviso.mockResolvedValue(null);
        await service.procesar(boton('s1:AVISO_SIGUE:58'), RT);
        expect(textos()).toEqual([TEXTOS_SOPORTE.casoDeOtraPersona]);
        expect(casos.reabrir).not.toHaveBeenCalled();
      });

      it('«No, sigue pasando»: reabre, pide contar qué pasa y lo ofrece como nota (sin IA)', async () => {
        await service.procesar(boton('s1:AVISO_SIGUE:58'), RT);
        expect(casos.reabrir).toHaveBeenCalledWith(ANA, 58, expect.any(Date));
        expect(textos()).toEqual([TEXTOS_SOPORTE.casoReabierto(58)]);
        expect(flujo.notaPara).toBe(58);

        casos.textosSinResponder.mockResolvedValue([
          'sigue sin salir el de las 7',
        ]);
        await service.procesar(msg('sigue sin salir el de las 7'), RT);
        expect(respuestas.responder).not.toHaveBeenCalled();
        expect(textos()[1]).toBe(TEXTOS_SOPORTE.confirmarNota(58));
        expect(teclado(1)).toEqual(['s1:NOTA_SI', 's1:NOTA_NO']);
        expect(flujo).toMatchObject({
          notaPara: null,
          notaPendiente: { caso: 58, texto: 'sigue sin salir el de las 7' },
        });

        await service.procesar(boton('s1:NOTA_SI'), RT);
        expect(casos.agregarNota).toHaveBeenCalledWith(
          ANA,
          58,
          'sigue sin salir el de las 7',
        );
      });

      it('si ya no se puede reabrir (más de 7 días, o no estaba solucionado), lo dice', async () => {
        casos.reabrir.mockResolvedValue(false);
        await service.procesar(boton('s1:AVISO_SIGUE:58'), RT);
        expect(textos()).toEqual([TEXTOS_SOPORTE.casoNoReabierto(58)]);
        expect(flujo.notaPara).toBeUndefined();
      });

      it('esperando la nota, sin texto pendiente (solo comandos), va a la IA', async () => {
        flujo = { ...FLUJO_VACIO, notaPara: 58 };
        await service.procesar(msg('hola'), RT);
        expect(respuestas.responder).toHaveBeenCalled();
      });

      it('/nuevo deja de esperar la nota', async () => {
        flujo = { ...FLUJO_VACIO, notaPara: 58 };
        await service.procesar(msg('/nuevo'), RT);
        expect(flujo).toMatchObject({ notaPara: null, modoCaso: true });
      });
    });

    describe('enviarAviso (lo usa el despachador del seguimiento)', () => {
      it('con su conversación abierta: queda registrado en ella, con los botones', async () => {
        const r = await service.enviarAviso(
          RT,
          { chatId: '777', yo: ANA },
          'Aviso',
          { caso: 58, conVer: false },
        );
        expect(r).toEqual({ ok: true, messageId: '1' });
        expect(teclado()).toEqual(['s1:AVISO_BIEN:58', 's1:AVISO_SIGUE:58']);
        expect(registrados).toEqual([
          expect.objectContaining({
            conversationId: 'conv-1',
            direction: 'SALIDA',
            text: 'Aviso',
            source: 'FIJO',
            telegramMessageId: '1',
          }),
        ]);
      });

      it('sin conversación: solo se envía; «Ver la respuesta» si salió sin ella', async () => {
        await service.enviarAviso(RT, { chatId: '777', yo: null }, 'Aviso', {
          caso: 58,
          conVer: true,
        });
        await service.enviarAviso(
          RT,
          { chatId: '777', yo: null },
          'Tomado',
          null,
        );
        expect(teclado(0)).toEqual([
          's1:AVISO_BIEN:58',
          's1:AVISO_SIGUE:58',
          's1:AVISO_VER:58',
        ]);
        expect(teclado(1)).toBeUndefined();
        expect(registrados).toEqual([]);
      });

      it.each([
        [null, true],
        [429, true],
        [502, true],
        [403, false],
        [400, false],
      ])(
        'si Telegram falla (%s), dice si vale la pena reintentar (%s)',
        async (codigo, reintentar) => {
          api.sendMessage.mockResolvedValue({
            ok: false,
            errorCode: codigo,
            description: 'x',
          });
          await expect(
            service.enviarAviso(RT, { chatId: '777', yo: null }, 'Aviso', null),
          ).resolves.toEqual({ ok: false, reintentar });
        },
      );
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

  it('si Telegram no acepta el envío, lo anota y no lanza', async () => {
    api.sendMessage.mockResolvedValue({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    await expect(service.procesar(msg('hola'), RT)).resolves.toBeUndefined();
  });

  it('un texto larguísimo se parte, y los botones van en el último pedazo', async () => {
    estado = { tipo: 'VIGENTE', interlocutor: ANA };
    respuestas.responder.mockResolvedValue({
      ...ARMADA,
      texto: `${'a'.repeat(4000)}\n${'b'.repeat(500)}`,
    });
    await service.procesar(msg('hola'), RT);
    expect(enviados).toHaveLength(2);
    expect(enviados[0].botones).toBeUndefined();
    expect(teclado(1)).toEqual(['s1:UTIL_SI', 's1:UTIL_NO']);
  });

  it('nunca lanza: un error inesperado queda en el log', async () => {
    sesiones.conversacionDe.mockRejectedValue(new Error('db caída'));
    await expect(service.procesar(msg('hola'), RT)).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('avisar el cierre desde el panel', async () => {
    await service.avisarCierreDesdePanel('777');
    expect(enviados).toEqual([
      {
        chat: '777',
        texto: TEXTOS_SOPORTE.cerradaDesdePanel,
        botones: undefined,
      },
    ]);
  });
});
