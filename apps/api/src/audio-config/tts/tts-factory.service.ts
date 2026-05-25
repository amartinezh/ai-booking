import { Injectable, Logger } from '@nestjs/common';
import { SystemLogService } from '../../system-log/system-log.service';
import { AudioConfigService } from '../audio-config.service';
import { GoogleTtsService } from './google-tts.service';
import { ElevenLabsTtsService } from './elevenlabs-tts.service';

/**
 * Factoría + orquestador del "Gestor de Audios" (inyección dinámica multi-tenant).
 *
 * En cada síntesis resuelve la configuración de la organización desde
 * `OrganizationAudioConfig` (NO del `.env`) y ejecuta el proveedor activo con
 * SUS credenciales. Implementa el Plan B:
 *
 *  - `activeProvider = ELEVENLABS` → intenta ElevenLabs con la key/voz de la
 *    clínica; si falla (sin cuota, plan, timeout, etc.) hace **fallback
 *    silencioso a Google** con la config Google de ESA MISMA clínica y registra
 *    el evento en SystemLog.
 *  - `activeProvider = GOOGLE`     → usa Google directamente.
 *
 * Aislamiento: ElevenLabs solo se invoca si la clínica lo activó; jamás se leen
 * credenciales de otra organización (todo va scoped por `organizationId`).
 */
@Injectable()
export class TtsFactoryService {
  private readonly logger = new Logger(TtsFactoryService.name);

  constructor(
    private readonly audioConfig: AudioConfigService,
    private readonly google: GoogleTtsService,
    private readonly elevenLabs: ElevenLabsTtsService,
    private readonly systemLog: SystemLogService,
  ) {}

  /**
   * Punto de entrada único de síntesis para el chatbot. Devuelve el audio
   * OGG/Opus listo para WhatsApp o `null` (en cuyo caso el bot envía solo texto).
   */
  async synthesize(
    organizationId: string,
    text: string,
  ): Promise<Buffer | null> {
    const cfg = await this.audioConfig.getEffective(organizationId);

    if (cfg.activeProvider === 'ELEVENLABS') {
      const { apiKey, voiceId } = cfg.elevenLabs;

      if (apiKey && voiceId) {
        const res = await this.elevenLabs.generate(text, { apiKey, voiceId });
        if (res.ok) return res.audio;

        // Falló ElevenLabs → log con detalle técnico + fallback a Google.
        await this.systemLog.error({
          action: `TTS_ELEVENLABS_${res.code}`,
          message: `ElevenLabs falló (${res.code}) tras ${res.rtt_ms}ms: ${res.message}`,
          organizationId,
          metadata: { provider: 'ELEVENLABS', voiceId, code: res.code, rtt_ms: res.rtt_ms },
        });
      } else {
        await this.systemLog.warning({
          action: 'TTS_ELEVENLABS_NOT_CONFIGURED',
          message:
            'activeProvider=ELEVENLABS pero falta API key y/o Voice ID; se usa Google como Plan B.',
          organizationId,
          metadata: { hasApiKey: !!apiKey, hasVoiceId: !!voiceId },
        });
      }

      this.logger.warn(
        `Fallback silencioso ElevenLabs → Google (org ${organizationId}).`,
      );
      await this.systemLog.warning({
        action: 'TTS_ELEVENLABS_FALLBACK_GOOGLE',
        message:
          'La síntesis con ElevenLabs falló; fallback silencioso a Google Cloud TTS (misma clínica).',
        organizationId,
        metadata: { from: 'ELEVENLABS', to: 'GOOGLE' },
      });
      const fb = await this.google.generate(text, cfg.google);
      return fb.ok ? fb.audio : null;
    }

    // Proveedor activo = GOOGLE.
    const res = await this.google.generate(text, cfg.google);
    if (!res.ok) {
      this.logger.error(
        `Google TTS falló (${res.code}) para org ${organizationId}: ${res.message}`,
      );
      return null;
    }
    return res.audio;
  }
}
