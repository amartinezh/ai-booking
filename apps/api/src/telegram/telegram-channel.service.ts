import { Injectable, Logger } from '@nestjs/common';
import type {
  TelegramMessageKind,
  WhatsappMessageKind,
} from '@agenia/database';
import { chatIdFromTelegramSender } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramConfigService } from './telegram-config.service';
import { TelegramSenderService } from './telegram-sender.service';
import type { TelegramSendOutcome } from './telegram.types';

/** Contexto de envío tal como lo arma el bot (el mismo que para WhatsApp). */
export interface BotOutboundContext {
  kind?: WhatsappMessageKind;
  appointmentId?: string | null;
}

const NOT_SENT: TelegramSendOutcome = {
  ok: false,
  messageId: null,
  errorCode: null,
  blocked: false,
};

/**
 * Lo único que el bot necesita saber de Telegram (docs/PLAN_TELEGRAM.md §4.3).
 *
 * El bot habla en remitentes (`tg:<chat_id>`) y en contextos de WhatsApp; esta
 * fachada traduce las dos cosas y delega en el envío y el cliente. Así los
 * cambios dentro de `ChatbotService` se quedan en una línea por punto, detrás
 * de `isTelegramSender`, y nada de la Bot API se filtra al bot.
 *
 * Nunca lanza, igual que `sendWhatsAppMessage`.
 */
@Injectable()
export class TelegramChannelService {
  private readonly logger = new Logger(TelegramChannelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TelegramApiClient,
    private readonly config: TelegramConfigService,
    private readonly sender: TelegramSenderService,
  ) {}

  async sendText(
    organizationId: string,
    senderId: string,
    text: string,
    ctx?: BotOutboundContext,
  ): Promise<TelegramSendOutcome> {
    const chatId = this.chatIdOrLog(senderId);
    if (!chatId) return NOT_SENT;
    return this.sender.sendText(
      organizationId,
      chatId,
      text,
      toTelegramCtx(ctx),
    );
  }

  async sendVoice(
    organizationId: string,
    senderId: string,
    ogg: Buffer,
    ctx?: BotOutboundContext,
  ): Promise<TelegramSendOutcome> {
    const chatId = this.chatIdOrLog(senderId);
    if (!chatId) return NOT_SENT;
    return this.sender.sendVoice(
      organizationId,
      chatId,
      ogg,
      toTelegramCtx(ctx),
    );
  }

  /** Nota de voz del paciente, por su `file_id`. `null` si no se pudo bajar. */
  async downloadVoice(
    organizationId: string,
    fileId: string,
  ): Promise<Buffer | null> {
    try {
      const creds = await this.config.forOrg(organizationId);
      if (!creds) return null;
      return await this.api.downloadFile(creds.botToken, fileId);
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo bajar la nota de voz de Telegram (org ${organizationId}): ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * El paciente acaba de escribir por Telegram: si alguna ficha de esta clínica
   * tenía el chat marcado como bloqueado, ya no lo está (T4). Nunca lanza.
   */
  async noteInbound(organizationId: string, chatId: string): Promise<void> {
    try {
      await this.prisma.patientProfile.updateMany({
        where: {
          organizationId,
          telegramChatId: chatId,
          telegramBlockedAt: { not: null },
        },
        data: { telegramBlockedAt: null },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo limpiar el bloqueo del chat ${chatId}: ${getErrorMessage(error)}`,
      );
    }
  }

  private chatIdOrLog(senderId: string): string | null {
    const chatId = chatIdFromTelegramSender(senderId);
    if (!chatId) {
      this.logger.error(
        `CRÍTICO: remitente de Telegram malformado (${senderId}). Mensaje NO enviado.`,
      );
    }
    return chatId;
  }
}

/**
 * `WhatsappMessageKind` → `TelegramMessageKind`. Son los mismos valores salvo
 * `MASS_NOTICE`, que no sale por Telegram (T7); si llegara, se registra como
 * aviso del sistema en vez de fallar.
 */
function toTelegramCtx(ctx?: BotOutboundContext): {
  kind?: TelegramMessageKind;
  appointmentId?: string | null;
} {
  if (!ctx) return {};
  const kind: TelegramMessageKind | undefined =
    ctx.kind === 'MASS_NOTICE' ? 'SYSTEM_NOTICE' : ctx.kind;
  return { kind, appointmentId: ctx.appointmentId ?? null };
}
