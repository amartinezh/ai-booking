import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramConfigService } from './telegram-config.service';
import { TelegramSenderService } from './telegram-sender.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramConfigController } from './telegram-config.controller';

/**
 * Núcleo del canal: cliente de la Bot API, configuración por clínica y envío.
 * No registra rutas. Es lo que el bot importa para responder por Telegram
 * (Fase 2), sin crear un ciclo con el módulo de las rutas, que a su vez
 * importa el bot.
 */
@Module({
  providers: [TelegramApiClient, TelegramConfigService, TelegramSenderService],
  exports: [TelegramApiClient, TelegramConfigService, TelegramSenderService],
})
export class TelegramCoreModule {}

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
