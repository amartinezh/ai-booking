import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  ETIQUETAS_BOTON,
  LIMITES_SOPORTE,
  ROL_LEGIBLE,
  TEXTOS_SOPORTE,
  borradorSinIA,
  casoAmpliable,
  datosDeBoton,
  esCodigoDeEnlace,
  esSoloSaludo,
  extraerCodigoCorto,
  interpretarRespuestaCorta,
  leerBoton,
  leerComando,
  prioridadDelCaso,
  siguienteBorrador,
  textoCuandoLoVeElEquipo,
  textoDelBorrador,
  textoListaDeCasos,
  type BorradorCaso,
  type BotonSoporte,
  type CasoPropuesto,
  type ComandoSoporte,
  type FlujoConversacion,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage, getErrorStack } from '../common/error-message.util';
import {
  TelegramApiClient,
  splitTelegramText,
} from '../telegram/telegram-api.client';
import { SupportBotConfigService } from './support-bot-config.service';
import {
  SupportBotSessionService,
  type Interlocutor,
} from './support-bot-session.service';
import {
  SupportBotAnswerService,
  type RespuestaArmada,
} from './support-bot-answer.service';
import { SupportBotCasesService } from './support-bot-cases.service';
import type { EntradaDelAsistente } from './support-bot-inbound';
import type { SupportBotRuntime } from './support-bot.types';

type Mensaje = Extract<EntradaDelAsistente, { accion: 'mensaje' }>;
type Boton = Extract<EntradaDelAsistente, { accion: 'boton' }>;
type Comando = { comando: ComandoSoporte; argumento: string | null } | null;
type Registro = Omit<Partial<RespuestaArmada['registro']>, 'source'> & {
  source?: 'IA' | 'SIN_IA' | 'FIJO';
  updateId?: string | null;
  telegramMessageId?: string | null;
};
type Teclado = ReadonlyArray<ReadonlyArray<{ texto: string; datos: string }>>;

/** «escribiendo…» dura unos 5 s en Telegram: se renueva mientras piensa la IA. */
const RENOVAR_ESCRIBIENDO_MS = 4_500;
const boton = (b: BotonSoporte, texto: string) => ({
  texto,
  datos: datosDeBoton(b),
});
const TECLADOS = {
  UTIL: [
    [
      boton({ accion: 'UTIL_SI' }, ETIQUETAS_BOTON.UTIL_SI),
      boton({ accion: 'UTIL_NO' }, ETIQUETAS_BOTON.UTIL_NO),
    ],
  ],
  OFRECER_CASO: [
    [
      boton({ accion: 'CASO_NUEVO' }, ETIQUETAS_BOTON.CASO_NUEVO),
      boton({ accion: 'CASO_NO' }, ETIQUETAS_BOTON.CASO_NO),
    ],
  ],
  CONFIRMAR: [
    [boton({ accion: 'CASO_SI' }, ETIQUETAS_BOTON.CASO_SI)],
    [
      boton({ accion: 'CASO_CORREGIR' }, ETIQUETAS_BOTON.CASO_CORREGIR),
      boton({ accion: 'CASO_NO' }, ETIQUETAS_BOTON.CASO_NO),
    ],
  ],
  NOTA: [
    [
      boton({ accion: 'NOTA_SI' }, ETIQUETAS_BOTON.NOTA_SI),
      boton({ accion: 'NOTA_NO' }, ETIQUETAS_BOTON.NOTA_NO),
    ],
  ],
} satisfies Record<string, Teclado>;
const CASO_VACIO: CasoPropuesto = {
  titulo: null,
  descripcion: null,
  pantalla: null,
  falta: [],
};

/**
 * El turno del asistente de soporte (docs/PLAN_BOT_SOPORTE.md §3.1, §3.3 y §3.4).
 *
 *   · Sin conversación verificada solo pide el código (y guarda la pregunta para
 *     responderla apenas se valide). Sin IA.
 *   · Con conversación: /salir, /ayuda, /casos, /nuevo y, a todo lo demás, la
 *     respuesta con el manual y la IA de la clínica. Los mensajes seguidos (menos
 *     de 2 s entre uno y otro) se responden juntos.
 *   · Los casos: la IA propone el borrador y pregunta lo que falta; el código lo
 *     muestra y NUNCA lo abre sin el «Sí» (S9), con botón o por escrito. Sin IA,
 *     el borrador se arma con lo que escribió. Un caso suyo abierto se amplía con
 *     una nota, también con su «Sí». Un borrador a medio abrir se retoma (24 h).
 *
 * Cada mensaje de una conversación verificada queda en `SupportBotMessage`; el
 * `update_id` es único, así que un reintento de Telegram no se atiende dos veces.
 */
@Injectable()
export class SupportBotService {
  private readonly logger = new Logger(SupportBotService.name);
  /** Cuánto se espera a que lleguen mensajes seguidos. Las pruebas lo bajan a 0. */
  protected agruparMs: number = LIMITES_SOPORTE.agruparMensajesMs;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly api: TelegramApiClient,
    private readonly config: SupportBotConfigService,
    private readonly sesiones: SupportBotSessionService,
    private readonly respuestas: SupportBotAnswerService,
    private readonly casos: SupportBotCasesService,
  ) {}

  /**
   * Al llegar un mensaje, ANTES de la cola por persona: marca cuál es el último.
   * Así el turno de un mensaje sabe si detrás venía otro y deja que ese responda
   * los dos juntos. Solo cuenta el texto libre (no comandos ni códigos).
   */
  async alLlegar(entrada: EntradaDelAsistente): Promise<void> {
    if (entrada.accion !== 'mensaje' || !entrada.texto) return;
    const texto = entrada.texto.trim();
    if (!texto || leerComando(texto) || extraerCodigoCorto(texto)) return;
    try {
      await this.redis.set(
        claveUltimo(entrada.telegramUserId),
        entrada.updateId,
        'EX',
        60,
      );
    } catch {
      // Sin Redis, cada mensaje se responde por separado.
    }
  }

  /** Atiende un update ya autenticado. Nunca lanza: un fallo queda en el log. */
  async procesar(
    entrada: Mensaje | Boton,
    rt: SupportBotRuntime,
    ahora: Date = new Date(),
    recibidoEn: number = Date.now(),
  ): Promise<void> {
    try {
      if (entrada.accion === 'boton') await this.boton(entrada, rt, ahora);
      else await this.mensaje(entrada, rt, ahora, recibidoEn);
    } catch (e: unknown) {
      this.logger.error(
        `El asistente falló atendiendo el update ${entrada.updateId}: ${getErrorMessage(e)}`,
        getErrorStack(e),
      );
    }
  }

  /** «Cerrar» desde el panel: se le avisa al chat, si había conversación. */
  async avisarCierreDesdePanel(chatId: string): Promise<void> {
    const rt = await this.config.runtime();
    if (rt) await this.enviar(rt, chatId, TEXTOS_SOPORTE.cerradaDesdePanel);
  }

  // ── Mensajes ───────────────────────────────────────────────────────────

  private async mensaje(
    e: Mensaje,
    rt: SupportBotRuntime,
    ahora: Date,
    recibidoEn: number,
  ): Promise<void> {
    if (!(await this.dentroDelLimite(e, rt))) return;

    const estado = await this.sesiones.conversacionDe(e.telegramUserId, ahora);
    if (estado.tipo === 'REVOCADA') {
      await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.accesoRevocado);
      return;
    }
    const yo = estado.tipo === 'VIGENTE' ? estado.interlocutor : null;

    if (e.texto === null) {
      if (!yo) {
        await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.pedirCodigo);
        return;
      }
      if (
        await this.registrar(
          yo.conversationId,
          'ENTRADA',
          '(mensaje que no es texto)',
          { updateId: e.updateId },
        )
      ) {
        await this.responder(rt, yo, TEXTOS_SOPORTE.soloTexto);
      }
      return;
    }

    const texto = e.texto.trim();
    if (texto.length === 0) return;
    if (texto.length > rt.maxMessageChars) {
      await this.enviar(
        rt,
        e.chatId,
        TEXTOS_SOPORTE.mensajeLargo(rt.maxMessageChars),
      );
      return;
    }
    const comando = leerComando(texto);
    if (yo)
      await this.enConversacion(e, yo, texto, comando, rt, ahora, recibidoEn);
    else await this.sinConversacion(e, texto, comando, rt, ahora);
  }

  private async sinConversacion(
    e: Mensaje,
    texto: string,
    comando: Comando,
    rt: SupportBotRuntime,
    ahora: Date,
  ): Promise<void> {
    if (comando?.comando === 'start' && esCodigoDeEnlace(comando.argumento)) {
      await this.abrir(e, comando.argumento as string, 'ENLACE', rt, ahora);
      return;
    }
    if (comando?.comando === 'salir') {
      await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.sinConversacion);
      return;
    }
    if (comando) {
      await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.pedirCodigo);
      return;
    }
    const codigo = extraerCodigoCorto(texto);
    if (codigo) {
      await this.abrir(e, codigo, 'CORTO', rt, ahora);
      return;
    }
    // Una pregunta antes del código: se guarda (sin IA) y se responde al validarlo.
    const guardada =
      !esSoloSaludo(texto) &&
      (await this.sesiones.guardarPreguntaEnEspera(e.telegramUserId, texto));
    await this.enviar(
      rt,
      e.chatId,
      guardada
        ? `${TEXTOS_SOPORTE.pedirCodigo}\n\n${TEXTOS_SOPORTE.preguntaGuardada}`
        : TEXTOS_SOPORTE.pedirCodigo,
    );
  }

  private async enConversacion(
    e: Mensaje,
    yo: Interlocutor,
    texto: string,
    comando: Comando,
    rt: SupportBotRuntime,
    ahora: Date,
    recibidoEn: number,
  ): Promise<void> {
    // Un código nuevo (escrito o del QR) abre otra conversación y cierra esta.
    if (comando?.comando === 'start' && esCodigoDeEnlace(comando.argumento)) {
      await this.abrir(e, comando.argumento as string, 'ENLACE', rt, ahora);
      return;
    }
    const codigo = comando ? null : extraerCodigoCorto(texto);
    if (codigo) {
      await this.abrir(e, codigo, 'CORTO', rt, ahora);
      return;
    }

    if (
      !(await this.registrar(yo.conversationId, 'ENTRADA', texto, {
        updateId: e.updateId,
      }))
    )
      return;
    await this.sesiones.tocar(yo.conversationId, ahora);

    switch (comando?.comando) {
      case 'salir':
        await this.sesiones.cerrar(yo.conversationId, 'SALIR', ahora);
        await this.responder(rt, yo, TEXTOS_SOPORTE.conversacionCerrada);
        return;
      case 'start':
        await this.responder(rt, yo, TEXTOS_SOPORTE.yaConversando);
        return;
      case 'ayuda':
        await this.responder(rt, yo, TEXTOS_SOPORTE.ayuda);
        return;
      case 'casos': {
        const lista = textoListaDeCasos(await this.casos.casosDe(yo, ahora));
        await this.responder(rt, yo, lista ?? TEXTOS_SOPORTE.sinCasos);
        return;
      }
      case 'nuevo': {
        const flujo = await this.casos.leerFlujo(yo.conversationId);
        await this.casos.guardarFlujo(yo.conversationId, {
          ...flujo,
          notaPendiente: null,
          modoCaso: true,
        });
        // «/nuevo no carga la agenda»: ya contó algo, se arma el caso con eso.
        if (comando.argumento)
          await this.responderConIA(rt, yo, ahora, { pedirCaso: true });
        else await this.responder(rt, yo, TEXTOS_SOPORTE.contarFalla);
        return;
      }
    }

    // ¿Responde «sí», «no» o «corregir» a un caso o a una nota que esperan? Sin IA.
    const flujo = await this.casos.leerFlujo(yo.conversationId);
    const corta = interpretarRespuestaCorta(texto);
    if (
      corta &&
      (flujo.borrador?.fase === 'CONFIRMANDO' || flujo.notaPendiente)
    ) {
      await this.decidir(rt, yo, flujo, corta, ahora);
      return;
    }

    // Si detrás de este viene otro mensaje, ese los responde a los dos.
    await this.esperar(Math.max(0, this.agruparMs - (Date.now() - recibidoEn)));
    if (!(await this.soyElUltimo(e))) return;
    await this.responderConIA(rt, yo, ahora);
  }

  /** Valida el código y, si sirve, saluda, ofrece lo que quedó a medias y responde lo que esperaba. */
  private async abrir(
    e: Mensaje,
    codigo: string,
    tipo: 'CORTO' | 'ENLACE',
    rt: SupportBotRuntime,
    ahora: Date,
  ): Promise<void> {
    const r = await this.sesiones.validarCodigo({
      codigo,
      tipo,
      telegramUserId: e.telegramUserId,
      chatId: e.chatId,
      telegramName: e.nombre,
      ahora,
    });
    if (r.tipo === 'BLOQUEADO') {
      await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.bloqueado(r.minutos));
      return;
    }
    if (r.tipo === 'INVALIDO') {
      await this.enviar(
        rt,
        e.chatId,
        TEXTOS_SOPORTE.codigoIncorrecto(r.restantes),
      );
      return;
    }
    if (r.tipo === 'SIN_ACCESO') {
      await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.sinAcceso);
      return;
    }

    const yo = r.interlocutor;
    for (const chat of r.chatsCerrados) {
      await this.enviar(rt, chat, TEXTOS_SOPORTE.cerradaPorOtra);
    }
    await this.responder(
      rt,
      yo,
      TEXTOS_SOPORTE.conversacionAbierta({
        nombre: e.nombre,
        rol: ROL_LEGIBLE[yo.role],
        clinica: yo.organizationName,
        correo: yo.email,
        prueba: yo.isTest,
      }),
    );

    // Un caso que quedó a medio abrir en la conversación anterior (§3.4 paso 7).
    const b = r.borradorRetomado;
    if (b) {
      const confirmar = b.fase === 'CONFIRMANDO';
      await this.responder(
        rt,
        yo,
        confirmar
          ? `${TEXTOS_SOPORTE.retomarBorrador(b.titulo, true)}\n\n${textoDelBorrador(b)}`
          : TEXTOS_SOPORTE.retomarBorrador(b.titulo, false),
        confirmar ? TECLADOS.CONFIRMAR : undefined,
      );
    }

    const pendiente = await this.sesiones.tomarPreguntaEnEspera(
      e.telegramUserId,
    );
    if (
      pendiente &&
      (await this.registrar(yo.conversationId, 'ENTRADA', pendiente, {}))
    ) {
      await this.responderConIA(rt, yo, ahora);
    }
  }

  /**
   * La respuesta con el manual (y la IA de la clínica, si hay), y lo que el código
   * decide con ella: el borrador del caso, la nota a uno de sus casos o los botones.
   * Mientras piensa, el chat muestra «escribiendo…».
   */
  private async responderConIA(
    rt: SupportBotRuntime,
    yo: Interlocutor,
    ahora: Date,
    opciones: { pedirCaso?: boolean } = {},
  ): Promise<void> {
    const flujo = await this.casos.leerFlujo(yo.conversationId);
    const pedirCaso = opciones.pedirCaso || flujo.modoCaso;
    const casos = await this.casos.casosDe(yo, ahora);

    const escribiendo = () => void this.api.sendChatAction(rt.token, yo.chatId);
    escribiendo();
    const intervalo = setInterval(escribiendo, RENOVAR_ESCRIBIENDO_MS);
    let armada: RespuestaArmada | null;
    try {
      armada = await this.respuestas.responder(yo, rt, ahora, {
        pedirCaso,
        borrador: flujo.borrador,
        casos,
      });
    } finally {
      clearInterval(intervalo);
    }
    if (!armada) return;
    if (armada.motivoSinIA) {
      this.logger.log(
        `Respuesta del asistente sin IA (${armada.motivoSinIA}).`,
      );
    }

    let texto = armada.texto;
    let teclado: Teclado | undefined = armada.botones
      ? TECLADOS[armada.botones]
      : undefined;
    let nuevo: FlujoConversacion = {
      ...flujo,
      notaPendiente: null,
      modoCaso: false,
    };
    const ia = armada.ia;

    if (ia && (ia.tipo === 'falla' || (pedirCaso && ia.caso))) {
      // La IA armó (o completó) el caso: el código decide si falta algo o se muestra.
      const prioridad = prioridadDelCaso({
        urgenciaIA: ia.urgencia,
        textos: armada.pendientes,
        anterior: flujo.borrador?.prioridad,
      });
      const r = siguienteBorrador(flujo.borrador, {
        tipo: 'PROPUESTA',
        caso: ia.caso ?? CASO_VACIO,
        prioridad,
        ahora,
      });
      nuevo = {
        borrador: r.borrador,
        notaPendiente: null,
        modoCaso: r.accion === 'PEDIR_DATOS',
      };
      if (r.accion === 'PEDIR_CONFIRMACION' && r.borrador) {
        texto = `${ia.respuesta}\n\n${textoDelBorrador(r.borrador)}`;
        teclado = TECLADOS.CONFIRMAR;
      } else {
        texto = ia.respuesta;
        teclado = undefined;
      }
    } else if (ia && casoAmpliable(casos, ia.ampliarCaso)) {
      // Más información para uno de SUS casos abiertos: se agrega con su «Sí».
      nuevo = {
        ...nuevo,
        notaPendiente: {
          caso: ia.ampliarCaso as number,
          texto: armada.pendientes.filter((t) => !t.startsWith('/')).join('\n'),
        },
      };
      texto = `${ia.respuesta}\n\n${TEXTOS_SOPORTE.confirmarNota(ia.ampliarCaso as number)}`;
      teclado = TECLADOS.NOTA;
    } else if (!ia && pedirCaso) {
      // Sin IA, el caso se arma con lo que escribió. Si solo tocó «Abrir un caso»
      // (nada nuevo escrito), con lo que contó en el turno anterior.
      const soloComandos = armada.pendientes.every((t) => t.startsWith('/'));
      const textos =
        soloComandos && !flujo.borrador
          ? [...armada.turnoAnterior, ...armada.pendientes]
          : armada.pendientes;
      const propuesto = borradorSinIA(
        flujo.borrador?.descripcion
          ? [flujo.borrador.descripcion, ...textos]
          : textos,
      );
      const r = siguienteBorrador(flujo.borrador, {
        tipo: 'PROPUESTA',
        caso: propuesto,
        prioridad: prioridadDelCaso({
          urgenciaIA: null,
          textos,
          anterior: flujo.borrador?.prioridad,
        }),
        ahora,
      });
      nuevo = {
        borrador: r.borrador,
        notaPendiente: null,
        modoCaso: r.accion === 'PEDIR_DATOS',
      };
      if (r.accion === 'PEDIR_CONFIRMACION' && r.borrador) {
        texto = textoDelBorrador(r.borrador);
        teclado = TECLADOS.CONFIRMAR;
      } else {
        texto = TEXTOS_SOPORTE.contarFalla;
        teclado = undefined;
      }
    }

    await this.casos.guardarFlujo(yo.conversationId, nuevo);
    await this.responder(rt, yo, texto, teclado, armada.registro);
    if (armada.registro.uncovered) {
      await this.prisma.supportBotConversation.updateMany({
        where: { id: yo.conversationId },
        data: { hadUncoveredQuestion: true },
      });
    }
  }

  /**
   * «Sí», «no» o «corregir» (con botón o por escrito) a un borrador mostrado o a una
   * nota pendiente. Es lo ÚNICO que abre un caso o agrega una nota.
   */
  private async decidir(
    rt: SupportBotRuntime,
    yo: Interlocutor,
    flujo: FlujoConversacion,
    respuesta: 'SI' | 'NO' | 'CORREGIR',
    ahora: Date,
  ): Promise<void> {
    if (flujo.notaPendiente) {
      const { caso, texto } = flujo.notaPendiente;
      await this.casos.guardarFlujo(yo.conversationId, {
        ...flujo,
        notaPendiente: null,
      });
      if (respuesta !== 'SI') {
        await this.responder(rt, yo, TEXTOS_SOPORTE.notaDescartada);
        return;
      }
      const agregada = yo.isTest
        ? true
        : await this.casos.agregarNota(yo, caso, texto);
      await this.responder(
        rt,
        yo,
        agregada
          ? TEXTOS_SOPORTE.notaAgregada(caso)
          : TEXTOS_SOPORTE.borradorVencido,
      );
      return;
    }

    const r = siguienteBorrador(flujo.borrador, { tipo: respuesta, ahora });
    switch (r.accion) {
      case 'ABRIR_CASO':
        await this.casos.guardarFlujo(yo.conversationId, {
          borrador: null,
          notaPendiente: null,
          modoCaso: false,
        });
        await this.abrirCaso(rt, yo, flujo.borrador as BorradorCaso, ahora);
        return;
      case 'DESCARTAR':
        await this.casos.guardarFlujo(yo.conversationId, {
          borrador: null,
          notaPendiente: null,
          modoCaso: false,
        });
        await this.responder(rt, yo, TEXTOS_SOPORTE.casoDescartado);
        return;
      case 'PEDIR_CORRECCION':
      case 'PEDIR_DATOS':
        await this.casos.guardarFlujo(yo.conversationId, {
          borrador: r.borrador,
          notaPendiente: null,
          modoCaso: true,
        });
        await this.responder(
          rt,
          yo,
          r.accion === 'PEDIR_CORRECCION'
            ? TEXTOS_SOPORTE.pedirCorreccion
            : TEXTOS_SOPORTE.contarFalla,
        );
        return;
      default:
        await this.responder(rt, yo, TEXTOS_SOPORTE.borradorVencido);
    }
  }

  private async abrirCaso(
    rt: SupportBotRuntime,
    yo: Interlocutor,
    borrador: BorradorCaso,
    ahora: Date,
  ): Promise<void> {
    const titulo = borrador.titulo ?? '';
    if (yo.isTest) {
      await this.responder(rt, yo, TEXTOS_SOPORTE.casoSimulado(titulo));
      return;
    }
    const numero = await this.casos.abrirCaso(yo, borrador);
    this.logger.log(
      `El asistente abrió el caso #${numero} (prioridad ${borrador.prioridad}).`,
    );
    const cuando = textoCuandoLoVeElEquipo(ahora, await this.config.horario());
    await this.responder(
      rt,
      yo,
      TEXTOS_SOPORTE.casoAbierto({ numero, titulo, cuando }),
    );
  }

  // ── Botones ────────────────────────────────────────────────────────────

  private async boton(
    e: Boton,
    rt: SupportBotRuntime,
    ahora: Date,
  ): Promise<void> {
    const b = leerBoton(e.datos);
    const propios = [
      'UTIL_SI',
      'UTIL_NO',
      'CASO_SI',
      'CASO_NO',
      'CASO_CORREGIR',
      'CASO_NUEVO',
      'NOTA_SI',
      'NOTA_NO',
    ];
    if (!b || !propios.includes(b.accion)) {
      // Botones de la Fase 4 (avisos) o viejos: solo se responden.
      await this.api.answerCallbackQuery(rt.token, e.callbackId);
      return;
    }
    const estado = await this.sesiones.conversacionDe(e.telegramUserId, ahora);
    if (estado.tipo !== 'VIGENTE') {
      await this.api.answerCallbackQuery(
        rt.token,
        e.callbackId,
        TEXTOS_SOPORTE.escribeElCodigo,
      );
      return;
    }
    const yo = estado.interlocutor;
    await this.api.answerCallbackQuery(
      rt.token,
      e.callbackId,
      b.accion === 'UTIL_SI' ? TEXTOS_SOPORTE.meSirvio : undefined,
    );
    // Un botón usado no se vuelve a tocar: se quita del mensaje.
    if (e.messageId !== null)
      await this.api.quitarBotones(rt.token, e.chatId, e.messageId);
    await this.sesiones.tocar(yo.conversationId, ahora);

    switch (b.accion) {
      case 'UTIL_SI':
        await this.feedback(yo, 'UTIL');
        return;
      case 'UTIL_NO':
      case 'CASO_NUEVO': {
        if (b.accion === 'UTIL_NO') await this.feedback(yo, 'NO_UTIL');
        // El caso se arma con lo que ya contó en la conversación.
        const flujo = await this.casos.leerFlujo(yo.conversationId);
        await this.casos.guardarFlujo(yo.conversationId, {
          ...flujo,
          notaPendiente: null,
          modoCaso: true,
        });
        if (
          await this.registrar(yo.conversationId, 'ENTRADA', '/nuevo', {
            updateId: e.updateId,
          })
        ) {
          await this.responderConIA(rt, yo, ahora, { pedirCaso: true });
        }
        return;
      }
      default: {
        const flujo = await this.casos.leerFlujo(yo.conversationId);
        const respuesta =
          b.accion === 'CASO_SI' || b.accion === 'NOTA_SI'
            ? 'SI'
            : b.accion === 'CASO_CORREGIR'
              ? 'CORREGIR'
              : 'NO';
        // Un «No, gracias» al ofrecimiento (sin borrador ni nota) no hace nada más.
        if (!flujo.borrador && !flujo.notaPendiente && respuesta === 'NO')
          return;
        await this.decidir(rt, yo, flujo, respuesta, ahora);
      }
    }
  }

  private async feedback(
    yo: Interlocutor,
    valor: 'UTIL' | 'NO_UTIL',
  ): Promise<void> {
    await this.prisma.supportBotConversation.updateMany({
      where: { id: yo.conversationId },
      data: { feedback: valor },
    });
  }

  // ── Envío y registro ───────────────────────────────────────────────────

  /** Responde dentro de la conversación y lo deja registrado. */
  private async responder(
    rt: SupportBotRuntime,
    yo: Interlocutor,
    texto: string,
    botones?: Teclado,
    registro: Registro = {},
  ): Promise<void> {
    const enviado = await this.enviar(rt, yo.chatId, texto, botones);
    await this.registrar(yo.conversationId, 'SALIDA', texto, {
      source: 'FIJO',
      ...registro,
      telegramMessageId: enviado ?? null,
    });
  }

  /**
   * Texto plano: un carácter mal escapado no puede hacer que la respuesta se pierda.
   * Devuelve el id del último mensaje enviado (para quitarle los botones), o null.
   */
  private async enviar(
    rt: SupportBotRuntime,
    chatId: string,
    texto: string,
    botones?: Teclado,
  ): Promise<string | null> {
    const partes = splitTelegramText(texto);
    let ultimo: string | null = null;
    for (const [i, parte] of partes.entries()) {
      // Los botones van en el último pedazo.
      const r = await this.api.sendMessage(rt.token, chatId, parte, {
        ...(botones && i === partes.length - 1 ? { botones } : {}),
      });
      if (!r.ok) {
        this.logger.warn(
          `El asistente no pudo enviar (${r.errorCode ?? 'red'}): ${r.description}`,
        );
        await this.config.registrarEnvio(false, r.description);
        return null;
      }
      ultimo = String(r.result.message_id);
    }
    await this.config.registrarEnvio(true);
    return ultimo;
  }

  /**
   * Guarda un mensaje de la conversación. Devuelve `false` si ese `update_id` ya
   * estaba: Telegram reintentó la entrega y el mensaje ya se atendió.
   */
  private async registrar(
    conversationId: string,
    direction: 'ENTRADA' | 'SALIDA',
    text: string,
    r: Registro,
  ): Promise<boolean> {
    try {
      await this.prisma.supportBotMessage.create({
        data: {
          conversationId,
          direction,
          text,
          source: direction === 'SALIDA' ? (r.source ?? 'FIJO') : null,
          aiKind: r.aiKind ?? null,
          uncovered: r.uncovered ?? false,
          topics: r.topics ?? [],
          aiProvider: r.aiProvider ?? null,
          inputTokens: r.inputTokens ?? null,
          outputTokens: r.outputTokens ?? null,
          latencyMs: r.latencyMs ?? null,
          telegramUpdateId: r.updateId ?? null,
          telegramMessageId: r.telegramMessageId ?? null,
        },
      });
      return true;
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return false;
      }
      throw e;
    }
  }

  /** ¿Sigue siendo este el último mensaje que llegó de esa cuenta? Sin Redis, sí. */
  private async soyElUltimo(e: Mensaje): Promise<boolean> {
    try {
      const ultimo = await this.redis.get(claveUltimo(e.telegramUserId));
      return ultimo === null || ultimo === e.updateId;
    } catch {
      return true;
    }
  }

  /** Se sobrescribe en las pruebas para no esperar de verdad. */
  protected esperar(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  /**
   * Tope de mensajes por hora y cuenta de Telegram (S15). Al pasarlo se avisa UNA
   * vez y lo demás se ignora hasta que corra la hora. Sin Redis no hay tope.
   */
  private async dentroDelLimite(
    e: Mensaje,
    rt: SupportBotRuntime,
  ): Promise<boolean> {
    try {
      const clave = `soporte:mensajes:${e.telegramUserId}`;
      const n = await this.redis.incr(clave);
      if (n === 1) await this.redis.expire(clave, 3600);
      if (n <= rt.maxMessagesPerHour) return true;
      if (n === rt.maxMessagesPerHour + 1) {
        await this.enviar(rt, e.chatId, TEXTOS_SOPORTE.muchosMensajes);
      }
      return false;
    } catch (err: unknown) {
      this.logger.warn(`Sin tope de mensajes (Redis): ${getErrorMessage(err)}`);
      return true;
    }
  }
}

const claveUltimo = (telegramUserId: string) =>
  `soporte:ultimo:${telegramUserId}`;
