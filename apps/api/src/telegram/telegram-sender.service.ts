import { Injectable, Logger } from '@nestjs/common';
import type {
  TelegramMessageKind,
  TelegramMessageType,
} from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';
import { TelegramApiClient, splitTelegramText } from './telegram-api.client';
import { TelegramConfigService } from './telegram-config.service';
import type {
  TelegramOutboundContext,
  TelegramResult,
  TelegramSendOutcome,
  TelegramSentMessage,
} from './telegram.types';

/**
 * Envío de mensajes por el bot de Telegram de una clínica.
 *
 * Es el equivalente de `sendWhatsAppMessage` para este canal y cumple lo mismo:
 * **nunca lanza**, y cada envío queda en su libro (`TelegramMessageLog`, T6).
 * Además reacciona a los dos errores que cambian el estado del sistema:
 *
 *  - 403 → el paciente bloqueó al bot: se marca `telegramBlockedAt` en su
 *    ficha para que el recordatorio caiga a WhatsApp (T4).
 *  - 401 → el token se revocó: se apaga el canal de la clínica.
 *
 * Recibe el `chat_id` SIN prefijo; traducir `tg:<chat_id>` es cosa de quien
 * llama (el bot, en la Fase 2).
 */
@Injectable()
export class TelegramSenderService {
  private readonly logger = new Logger(TelegramSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TelegramApiClient,
    private readonly config: TelegramConfigService,
  ) {}

  /** Texto plano; si pasa del tope de Telegram se envía en varios mensajes. */
  async sendText(
    organizationId: string,
    chatId: string,
    text: string,
    ctx: TelegramOutboundContext = {},
  ): Promise<TelegramSendOutcome> {
    const token = await this.activeToken(organizationId, chatId, 'TEXT', ctx);
    if (!token) return FAILED_NO_CHANNEL;

    let last: TelegramSendOutcome = FAILED_NO_CHANNEL;
    for (const part of splitTelegramText(text)) {
      const res = await this.api.sendMessage(token, chatId, part);
      last = await this.settle(organizationId, chatId, 'TEXT', ctx, res);
      // Si un trozo falla, los siguientes no se mandan: un listado de
      // horarios cortado a la mitad confunde más que no recibirlo.
      if (!last.ok) break;
    }
    return last;
  }

  /** Nota de voz (OGG/Opus, lo que produce el TTS). */
  async sendVoice(
    organizationId: string,
    chatId: string,
    ogg: Buffer,
    ctx: TelegramOutboundContext = {},
  ): Promise<TelegramSendOutcome> {
    const token = await this.activeToken(organizationId, chatId, 'VOICE', ctx);
    if (!token) return FAILED_NO_CHANNEL;
    const res = await this.api.sendVoice(token, chatId, ogg);
    return this.settle(organizationId, chatId, 'VOICE', ctx, res);
  }

  // ── internos ────────────────────────────────────────────────────────────

  /** Token del bot si el canal está activo; si no, deja constancia y `null`. */
  private async activeToken(
    organizationId: string,
    chatId: string,
    messageType: TelegramMessageType,
    ctx: TelegramOutboundContext,
  ): Promise<string | null> {
    let creds: Awaited<ReturnType<TelegramConfigService['forOrg']>> = null;
    try {
      creds = await this.config.forOrg(organizationId);
    } catch (error: unknown) {
      this.logger.error(
        `No se pudieron leer las credenciales de Telegram de org ${organizationId}: ${getErrorMessage(error)}`,
      );
    }
    if (creds?.isActive) return creds.botToken;

    this.logger.error(
      `CRÍTICO: canal de Telegram ${creds ? 'inactivo' : 'sin configurar'} para org ${organizationId}. Mensaje NO enviado al chat ${chatId}.`,
    );
    await this.record({
      organizationId,
      chatId,
      messageType,
      ctx,
      messageId: null,
      errorCode: 'CHANNEL_INACTIVE',
      errorDetail: creds ? 'Canal inactivo' : 'Canal sin configurar',
    });
    return null;
  }

  private async settle(
    organizationId: string,
    chatId: string,
    messageType: TelegramMessageType,
    ctx: TelegramOutboundContext,
    res: TelegramResult<TelegramSentMessage>,
  ): Promise<TelegramSendOutcome> {
    if (res.ok) {
      await this.record({
        organizationId,
        chatId,
        messageType,
        ctx,
        messageId: res.result.message_id,
        errorCode: null,
        errorDetail: null,
      });
      return {
        ok: true,
        messageId: res.result.message_id,
        errorCode: null,
        blocked: false,
      };
    }

    this.logger.error(
      `Error enviando ${messageType} por Telegram al chat ${chatId} (org ${organizationId}): ${res.errorCode ?? 'red'} ${res.description}`,
    );
    await this.record({
      organizationId,
      chatId,
      messageType,
      ctx,
      messageId: null,
      errorCode: res.errorCode === null ? 'NETWORK' : String(res.errorCode),
      errorDetail: res.description.slice(0, 500),
    });

    const blocked = res.errorCode === 403;
    if (blocked) await this.markBlocked(organizationId, chatId);
    if (res.errorCode === 401) {
      await this.config.markTokenRevoked(organizationId);
    }
    return { ok: false, messageId: null, errorCode: res.errorCode, blocked };
  }

  /** El paciente bloqueó al bot. Nunca lanza. */
  private async markBlocked(
    organizationId: string,
    chatId: string,
  ): Promise<void> {
    try {
      await this.prisma.patientProfile.updateMany({
        where: { organizationId, telegramChatId: chatId },
        data: { telegramBlockedAt: new Date() },
      });
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo marcar el bloqueo del chat ${chatId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /** Libro de mensajes. Nunca lanza: la evidencia no puede tumbar el envío. */
  private async record(p: {
    organizationId: string;
    chatId: string;
    messageType: TelegramMessageType;
    ctx: TelegramOutboundContext;
    messageId: number | null;
    errorCode: string | null;
    errorDetail: string | null;
  }): Promise<void> {
    const kind: TelegramMessageKind = p.ctx.kind ?? 'BOT_REPLY';
    try {
      await this.prisma.telegramMessageLog.create({
        data: {
          organizationId: p.organizationId,
          chatId: p.chatId,
          messageId: p.messageId,
          messageType: p.messageType,
          kind,
          appointmentId: p.ctx.appointmentId ?? null,
          status: p.messageId !== null ? 'ACCEPTED' : 'FAILED',
          errorCode: p.errorCode,
          errorDetail: p.errorDetail,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo registrar el envío de Telegram al chat ${p.chatId}: ${getErrorMessage(error)}`,
      );
    }
  }
}

const FAILED_NO_CHANNEL: TelegramSendOutcome = {
  ok: false,
  messageId: null,
  errorCode: null,
  blocked: false,
};
