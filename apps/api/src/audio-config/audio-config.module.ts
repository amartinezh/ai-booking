import { Module } from '@nestjs/common';
import { AudioConfigController } from './audio-config.controller';
import { AudioConfigService } from './audio-config.service';
import { GoogleTtsService } from './tts/google-tts.service';
import { ElevenLabsTtsService } from './tts/elevenlabs-tts.service';
import { TtsFactoryService } from './tts/tts-factory.service';

/**
 * Configuración multi-tenant de voz/audio (TTS) por organización.
 *
 * Exporta:
 *  - `AudioConfigService`: config efectiva por clínica (voz, pitch, rate, códec).
 *  - `TtsFactoryService`: factoría/orquestador (patrón Strategy) que el
 *    `ChatbotModule` usa para sintetizar voz con el proveedor activo
 *    (`GOOGLE` en producción, `ELEVENLABS` en la PoC) según `ACTIVE_TTS_PROVIDER`.
 *
 * `SystemLogService` y `ConfigService` son globales → no requieren import aquí.
 */
@Module({
  controllers: [AudioConfigController],
  providers: [
    AudioConfigService,
    GoogleTtsService,
    ElevenLabsTtsService,
    TtsFactoryService,
  ],
  exports: [AudioConfigService, TtsFactoryService],
})
export class AudioConfigModule {}
