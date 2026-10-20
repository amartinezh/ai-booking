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
import { InboundQueueService } from '../chatbot/inbound-queue.service';
import { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotService } from './support-bot.service';
import { leerUpdate, type UpdateDelAsistente } from './support-bot-inbound';

/**
 * Entrada del asistente de soporte: `POST /support-bot/webhook/<routeKey>`.
 *
 * Mismo contrato que el webhook de los pacientes:
 *  - Autenticación antes que nada: la ruta y el header
 *    `X-Telegram-Bot-Api-Secret-Token` prueban que lo mandó Telegram al bot del
 *    asistente. Una ruta desconocida y un secreto inválido responden IGUAL (401).
 *  - Responder rápido: aquí solo se deduplica y se encola, serializado por cuenta
 *    de Telegram, en una cola PROPIA (no compite con los turnos de los pacientes).
 *  - Nada se pierde en silencio: con la cola llena se libera la deduplicación y se
 *    responde 503, y Telegram reintenta.
 *
 * Es una ruta PÚBLICA: en producción necesita su bloque en el Caddy (lista blanca).
 */
@Controller('support-bot')
export class SupportBotWebhookController {
  private readonly logger = new Logger(SupportBotWebhookController.name);

  constructor(
    private readonly config: SupportBotConfigService,
    private readonly bot: SupportBotService,
    private readonly cola: InboundQueueService,
  ) {}

  @Post('webhook/:routeKey')
  @HttpCode(HttpStatus.OK)
  async recibir(
    @Param('routeKey') routeKey: string,
    @Body() update: UpdateDelAsistente,
    @Headers('x-telegram-bot-api-secret-token') secreto?: string,
  ): Promise<{ ok: true }> {
    const rt = await this.config.destinoDelWebhook(routeKey, secreto);
    if (!rt) {
      this.logger.warn(
        'Webhook del asistente rechazado: ruta o secreto inválidos.',
      );
      throw new UnauthorizedException();
    }
    // Apagado desde el panel: 200 para que Telegram no los acumule, y nada más.
    if (!rt.enabled) return { ok: true };

    const entrada = leerUpdate(update);
    if (entrada.accion === 'ignorar') {
      this.logger.debug(`Update del asistente ignorado: ${entrada.motivo}.`);
      return { ok: true };
    }

    const clave = `soporte:${entrada.updateId}`;
    if (!(await this.cola.admit(clave))) return { ok: true };
    const aceptada = this.cola.enqueue(
      `soporte:${entrada.telegramUserId}`,
      () => this.bot.procesar(entrada, rt),
    );
    if (!aceptada) {
      await this.cola.releaseAdmission(clave);
      throw new ServiceUnavailableException();
    }
    return { ok: true };
  }
}
