import { Module } from '@nestjs/common';
import { AudioConfigController } from './audio-config.controller';
import { AudioConfigService } from './audio-config.service';

/**
 * Configuración multi-tenant de voz/audio (TTS) por organización.
 *
 * Exporta `AudioConfigService` para que `ChatbotModule` resuelva la config
 * efectiva al sintetizar respuestas de voz (inyección dinámica de pitch, rate,
 * voz y códec por clínica).
 */
@Module({
  controllers: [AudioConfigController],
  providers: [AudioConfigService],
  exports: [AudioConfigService],
})
export class AudioConfigModule {}
