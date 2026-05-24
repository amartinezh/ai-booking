import { Injectable, Logger } from '@nestjs/common';
import textToSpeech from '@google-cloud/text-to-speech';
import { AudioConfigService } from '../audio-config.service';
import { TtsProvider, TtsSynthesisInput } from './tts-provider.interface';

/**
 * Proveedor de producción: Google Cloud TTS.
 *
 * Encapsula —sin alterarla— la lógica que antes vivía inline en
 * `ChatbotService.generateTTS`. La configuración de voz, pitch, velocidad y
 * códec se sigue resolviendo dinámicamente por organización vía
 * `AudioConfigService.getEffective` (multi-tenant), con defaults seguros.
 */
@Injectable()
export class GoogleTtsService implements TtsProvider {
  readonly name = 'GOOGLE' as const;
  private readonly logger = new Logger(GoogleTtsService.name);
  private readonly ttsClient = new textToSpeech.TextToSpeechClient();

  constructor(private readonly audioConfig: AudioConfigService) {}

  async synthesize({
    organizationId,
    text,
  }: TtsSynthesisInput): Promise<Buffer | null> {
    try {
      // 🔊 Inyección dinámica multi-tenant: voz, pitch, velocidad y códec se
      // resuelven desde OrganizationAudioConfig (con defaults seguros si la
      // clínica no configuró nada).
      const cfg = await this.audioConfig.getEffective(organizationId);
      const request = {
        input: { text },
        voice: { languageCode: cfg.languageCode, name: cfg.voiceId },
        audioConfig: {
          audioEncoding: cfg.audioEncoding,
          pitch: cfg.pitch,
          speakingRate: cfg.speakingRate,
        },
      };
      const [response] = await this.ttsClient.synthesizeSpeech(request);
      if (!response.audioContent) {
        this.logger.error('Google Cloud TTS no devolvió audio');
        return null;
      }
      return Buffer.from(response.audioContent as Uint8Array);
    } catch (error: any) {
      this.logger.error(`Error en generateTTS (Google): ${error.message}`);
      return null;
    }
  }
}
