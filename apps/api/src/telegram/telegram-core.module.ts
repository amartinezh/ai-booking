import { Module } from '@nestjs/common';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramConfigService } from './telegram-config.service';
import { TelegramSenderService } from './telegram-sender.service';
import { TelegramChannelService } from './telegram-channel.service';

/**
 * Núcleo del canal: cliente de la Bot API, configuración por clínica y envío.
 * No registra rutas. Es lo que el bot importa para responder por Telegram.
 *
 * Vive en su PROPIO archivo, sin nada del bot, a propósito: `ChatbotModule`
 * lo importa y `TelegramModule` importa a `ChatbotModule`. Si los dos
 * módulos compartieran archivo, el ciclo de `import` dejaría a uno de ellos
 * `undefined` al cargar y la API no arrancaría con TELEGRAM_ENABLED=true
 * (pasó en la verificación de la Fase 2; lo vigila app.module.imports.spec.ts).
 */
@Module({
  providers: [
    TelegramApiClient,
    TelegramConfigService,
    TelegramSenderService,
    TelegramChannelService,
  ],
  exports: [
    TelegramApiClient,
    TelegramConfigService,
    TelegramSenderService,
    TelegramChannelService,
  ],
})
export class TelegramCoreModule {}
