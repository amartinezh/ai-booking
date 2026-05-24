import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemLogService } from '../../system-log/system-log.service';
import { GoogleTtsService } from './google-tts.service';
import { ElevenLabsTtsService } from './elevenlabs-tts.service';
import {
  TtsProvider,
  TtsProviderName,
  normalizeTtsProvider,
} from './tts-provider.interface';

/**
 * Factoría + orquestador del "Gestor de Audios".
 *
 * Decide, basándose EXCLUSIVAMENTE en el flag `ACTIVE_TTS_PROVIDER` del `.env`,
 * qué estrategia (`GoogleTtsService` o `ElevenLabsTtsService`) atiende la
 * síntesis, y aplica el safeguard de fallback de la PoC.
 *
 * Aislamiento (Fase 3):
 *  - `ACTIVE_TTS_PROVIDER=GOOGLE`     → solo se invoca Google. ElevenLabs jamás
 *    se ejecuta ni lee sus credenciales (no consume cuota ni red).
 *  - `ACTIVE_TTS_PROVIDER=ELEVENLABS` → se usa la voz nueva; si ElevenLabs falla,
 *    se hace **fallback silencioso a Google** para no degradar WhatsApp. Nunca se
 *    toca la configuración de Google de la clínica.
 */
@Injectable()
export class TtsFactoryService {
  private readonly logger = new Logger(TtsFactoryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly google: GoogleTtsService,
    private readonly elevenLabs: ElevenLabsTtsService,
    private readonly systemLog: SystemLogService,
  ) {}

  /** Nombre del proveedor activo según el flag (default GOOGLE). */
  activeProviderName(): TtsProviderName {
    return normalizeTtsProvider(this.config.get<string>('ACTIVE_TTS_PROVIDER'));
  }

  /** Resuelve la estrategia activa. Factory puro (sin efectos secundarios). */
  resolve(): TtsProvider {
    return this.activeProviderName() === 'ELEVENLABS'
      ? this.elevenLabs
      : this.google;
  }

  /**
   * Punto de entrada único de síntesis para el chatbot.
   *
   * Sintetiza con el proveedor activo. Si el activo es ElevenLabs (PoC) y falla,
   * hace fallback silencioso a Google para que el paciente siga recibiendo audio.
   * Google nunca hace fallback: es el proveedor de producción y su `null` ya
   * significa "no enviar audio" (el chatbot manda solo el texto).
   */
  async synthesize(
    organizationId: string,
    text: string,
  ): Promise<Buffer | null> {
    const provider = this.resolve();
    const audio = await provider.synthesize({ organizationId, text });

    if (audio || provider.name === 'GOOGLE') return audio;

    // El activo era ElevenLabs y devolvió null → fallback de producción.
    this.logger.warn(
      `ElevenLabs falló; fallback silencioso a Google TTS (org ${organizationId}).`,
    );
    await this.systemLog.warning({
      action: 'TTS_ELEVENLABS_FALLBACK_GOOGLE',
      message:
        'La síntesis con ElevenLabs (PoC) falló; fallback silencioso a Google Cloud TTS.',
      organizationId,
      metadata: { from: 'ELEVENLABS', to: 'GOOGLE' },
    });
    return this.google.synthesize({ organizationId, text });
  }
}
