import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ChatbotService } from '../chatbot/chatbot.service';
import { InboundQueueService } from '../chatbot/inbound-queue.service';
import { TelegramConfigService } from './telegram-config.service';
import { TelegramSenderService } from './telegram-sender.service';
import {
  TELEGRAM_UNSUPPORTED_REPLY,
  adaptTelegramUpdate,
} from './telegram-inbound.adapter';
import type { TelegramUpdate } from './telegram.types';

/**
 * Entrada de Telegram: `POST /telegram/webhook/<routeKey>` (T1, T2).
 *
 * Mismo contrato que el webhook de Meta:
 *
 *  - **Autenticación antes que nada.** La ruta dice de qué clínica viene el
 *    update y el header `X-Telegram-Bot-Api-Secret-Token` prueba que lo mandó
 *    Telegram. Sin él (o con el de otra clínica): 401 y no llega al bot.
 *  - **Responder rápido.** Aquí solo se deduplica y se encola; el turno corre
 *    en la cola compartida con WhatsApp, serializado por `tg:<chat_id>`.
 *  - **Nada se pierde en silencio.** Si la cola está llena se libera la
 *    deduplicación y se responde 503: Telegram reintenta ese update.
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly config: TelegramConfigService,
    private readonly sender: TelegramSenderService,
    private readonly inboundQueue: InboundQueueService,
    private readonly chatbot: ChatbotService,
  ) {}

  @Post('webhook/:routeKey')
  @HttpCode(HttpStatus.OK)
  async handleUpdate(
    @Param('routeKey') routeKey: string,
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ): Promise<{ ok: true }> {
    const target = await this.config.forRouteKey(routeKey);
    // Ruta desconocida y secreto inválido responden IGUAL: no se revela qué
    // rutas existen.
    if (!target || !sameSecret(secretHeader, target.webhookSecret)) {
      this.logger.warn(
        `Webhook de Telegram rechazado: ${target ? 'secreto inválido' : 'ruta desconocida'}.`,
      );
      throw new UnauthorizedException();
    }

    if (!target.isActive) {
      // 200 para que Telegram no los acumule: con el canal apagado no se
      // contesta nada (T9).
      this.logger.debug(
        `Update de Telegram descartado: canal inactivo (org ${target.organizationId}).`,
      );
      return { ok: true };
    }

    const decision = adaptTelegramUpdate(
      update,
      target.organizationId,
      routeKey,
    );
    if (decision.action === 'ignore') {
      this.logger.log(
        `Update de Telegram ignorado (org ${target.organizationId}): ${decision.reason}.`,
      );
      return { ok: true };
    }

    const admitted = await this.inboundQueue.admit(decision.dedupKey);
    if (!admitted) {
      this.logger.debug(`Update de Telegram duplicado: ${decision.dedupKey}.`);
      return { ok: true };
    }

    const { organizationId } = target;
    const accepted =
      decision.action === 'unsupported'
        ? this.inboundQueue.enqueue(decision.senderId, async () => {
            this.logger.log(
              `Telegram: ${decision.what} no soportado del chat ${decision.chatId} (org ${organizationId}); se envía aviso.`,
            );
            await this.sender.sendText(
              organizationId,
              decision.chatId,
              TELEGRAM_UNSUPPORTED_REPLY,
            );
          })
        : this.inboundQueue.enqueue(decision.event.telegram.senderId, () =>
            this.chatbot.processIncomingMessage(decision.event),
          );

    if (!accepted) {
      await this.inboundQueue.releaseAdmission(decision.dedupKey);
      this.logger.warn(
        `Backpressure: cola de entrada saturada (${this.inboundQueue.inFlight} en vuelo). ` +
          `Update ${decision.dedupKey} rechazado con 503; Telegram lo reintentará.`,
      );
      throw new ServiceUnavailableException();
    }

    return { ok: true };
  }
}

/** Comparación en tiempo constante del secreto del header. */
function sameSecret(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
