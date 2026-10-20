import { Module } from '@nestjs/common';
import { InboundQueueService } from '../chatbot/inbound-queue.service';
import { TelegramCoreModule } from '../telegram/telegram-core.module';
import { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotSessionService } from './support-bot-session.service';
import { SupportBotService } from './support-bot.service';
import { SupportBotWebhookController } from './support-bot-webhook.controller';
import {
  SupportBotAdminController,
  SupportBotPanelController,
} from './support-bot.controller';

/**
 * 🛟 Asistente de soporte por Telegram para el personal de las clínicas
 * (docs/PLAN_BOT_SOPORTE.md).
 *
 * Solo se registra con `SUPPORT_BOT_ENABLED=true` (ver `supportBotEnabled`): con el
 * interruptor apagado no existe ninguna de sus rutas y la tarjeta de Soporte no
 * aparece (la web lee el 404).
 *
 * Importa solo el cliente de Telegram, que no importa nada: nada del bot de los
 * pacientes (lección del ciclo de imports de la Fase 2 de Telegram; lo vigila
 * app.module.imports.spec.ts). Prisma, Redis y Crypto son globales. La cola de
 * entrada es una instancia PROPIA: los turnos del asistente no le quitan cupo a los
 * de los pacientes.
 */
@Module({
  imports: [TelegramCoreModule],
  controllers: [
    SupportBotWebhookController,
    SupportBotPanelController,
    SupportBotAdminController,
  ],
  providers: [
    SupportBotConfigService,
    SupportBotSessionService,
    SupportBotService,
    InboundQueueService,
  ],
})
export class SupportBotModule {}

/**
 * Interruptor del asistente en el servidor. Solo el valor exacto `true` lo
 * enciende: un `1`, un `yes` o una errata lo dejan apagado, que es el lado seguro.
 */
export function supportBotEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.SUPPORT_BOT_ENABLED?.trim() === 'true';
}
