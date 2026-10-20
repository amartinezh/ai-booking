import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  ROL_LEGIBLE,
  TEXTOS_SOPORTE,
  esCodigoDeEnlace,
  esSoloSaludo,
  extraerCodigoCorto,
  leerComando,
  type ComandoSoporte,
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
import type { EntradaDelAsistente } from './support-bot-inbound';
import type { SupportBotRuntime } from './support-bot.types';

type Mensaje = Extract<EntradaDelAsistente, { accion: 'mensaje' }>;
type Boton = Extract<EntradaDelAsistente, { accion: 'boton' }>;
type Comando = { comando: ComandoSoporte; argumento: string | null } | null;

/**
 * El turno del asistente de soporte (docs/PLAN_BOT_SOPORTE.md §3.1 y §3.3).
 *
 * Fase 1: cualquiera le escribe, pero sin conversación verificada solo pide el
 * código (y guarda la pregunta para responderla apenas se valide). Con
 * conversación: /salir, /ayuda y, mientras llegan las respuestas con el manual
 * (Fase 2) y los casos (Fase 3), un texto fijo.
 *
 * Nada de esto usa IA. Cada mensaje de una conversación verificada queda en
 * `SupportBotMessage`; el `update_id` es único, así que un reintento de Telegram
 * no se atiende dos veces.
 */
@Injectable()
export class SupportBotService {
  private readonly logger = new Logger(SupportBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly api: TelegramApiClient,
    private readonly config: SupportBotConfigService,
    private readonly sesiones: SupportBotSessionService,
  ) {}

  /** Atiende un update ya autenticado. Nunca lanza: un fallo queda en el log. */
  async procesar(
    entrada: Mensaje | Boton,
    rt: SupportBotRuntime,
    ahora: Date = new Date(),
  ): Promise<void> {
    try {
      if (entrada.accion === 'boton') await this.boton(entrada, rt);
      else await this.mensaje(entrada, rt, ahora);
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
          e.updateId,
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
    if (yo) await this.enConversacion(e, yo, texto, comando, rt, ahora);
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
      !(await this.registrar(yo.conversationId, 'ENTRADA', texto, e.updateId))
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
      default:
        // Fase 1: aún sin respuestas con el manual (Fase 2) ni casos (Fase 3).
        await this.responder(rt, yo, TEXTOS_SOPORTE.enConstruccion);
    }
  }

  /** Valida el código y, si sirve, saluda y responde la pregunta que quedó en espera. */
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

    const pendiente = await this.sesiones.tomarPreguntaEnEspera(
      e.telegramUserId,
    );
    if (
      pendiente &&
      (await this.registrar(yo.conversationId, 'ENTRADA', pendiente, null))
    ) {
      // Fase 1: aún sin respuestas con el manual (Fase 2).
      await this.responder(rt, yo, TEXTOS_SOPORTE.enConstruccion);
    }
  }

  // ── Botones ────────────────────────────────────────────────────────────

  private async boton(e: Boton, rt: SupportBotRuntime): Promise<void> {
    // Sin respuesta, Telegram deja el botón «cargando». La Fase 1 todavía no pone
    // botones: cualquier toque es de un mensaje viejo y no hace nada.
    await this.api.answerCallbackQuery(rt.token, e.callbackId);
  }

  // ── Envío y registro ───────────────────────────────────────────────────

  /** Responde dentro de la conversación y lo deja registrado. */
  private async responder(
    rt: SupportBotRuntime,
    yo: Interlocutor,
    texto: string,
  ): Promise<void> {
    await this.enviar(rt, yo.chatId, texto);
    await this.registrar(yo.conversationId, 'SALIDA', texto, null);
  }

  /** Texto plano: un carácter mal escapado no puede hacer que la respuesta se pierda. */
  private async enviar(
    rt: SupportBotRuntime,
    chatId: string,
    texto: string,
  ): Promise<boolean> {
    for (const parte of splitTelegramText(texto)) {
      const r = await this.api.sendMessage(rt.token, chatId, parte);
      if (!r.ok) {
        this.logger.warn(
          `El asistente no pudo enviar (${r.errorCode ?? 'red'}): ${r.description}`,
        );
        await this.config.registrarEnvio(false, r.description);
        return false;
      }
    }
    await this.config.registrarEnvio(true);
    return true;
  }

  /**
   * Guarda un mensaje de la conversación. Devuelve `false` si ese `update_id` ya
   * estaba: Telegram reintentó la entrega y el mensaje ya se atendió.
   */
  private async registrar(
    conversationId: string,
    direction: 'ENTRADA' | 'SALIDA',
    text: string,
    updateId: string | null,
  ): Promise<boolean> {
    try {
      await this.prisma.supportBotMessage.create({
        data: {
          conversationId,
          direction,
          text,
          source: direction === 'SALIDA' ? 'FIJO' : null,
          telegramUpdateId: updateId,
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
