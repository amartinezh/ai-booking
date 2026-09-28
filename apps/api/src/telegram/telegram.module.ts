import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { TelegramCoreModule } from './telegram-core.module';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramConfigController } from './telegram-config.controller';

export { TelegramCoreModule } from './telegram-core.module';

/**
 * Rutas del canal: el webhook que llama Telegram y la configuración del panel.
 * Solo se registra con `TELEGRAM_ENABLED=true` (ver `telegramEnabled`): con el
 * interruptor apagado no existe ninguna ruta de Telegram (T9).
 */
@Module({
  imports: [TelegramCoreModule, ChatbotModule],
  controllers: [TelegramWebhookController, TelegramConfigController],
})
export class TelegramModule {}

/**
 * Interruptor global del canal (T9). Solo el valor exacto `true` lo enciende:
 * un `1`, un `yes` o una errata lo dejan apagado, que es el lado seguro.
 */
export function telegramEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TELEGRAM_ENABLED?.trim() === 'true';
}
