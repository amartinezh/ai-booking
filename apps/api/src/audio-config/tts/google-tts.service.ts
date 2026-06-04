import { Injectable, Logger } from '@nestjs/common';
import textToSpeech from '@google-cloud/text-to-speech';
import { AudioDiagnosisErrorCode } from '../dto/audio-config.types';
import {
  GoogleTtsParams,
  TtsProvider,
  TtsResult,
} from './tts-provider.interface';

/** Cap de latencia antes de declarar TIMEOUT (no debe colgar el chat). */
const GOOGLE_TTS_TIMEOUT_MS = 8000;

/**
 * Proveedor de producción / Plan B: Google Cloud TTS.
 *
 * Stateless respecto al tenant: recibe la voz, pitch, velocidad y códec ya
 * resueltos por `AudioConfigService`. No lee la BD ni el `.env`.
 */
@Injectable()
export class GoogleTtsService implements TtsProvider<GoogleTtsParams> {
  readonly name = 'GOOGLE' as const;
  private readonly logger = new Logger(GoogleTtsService.name);
  private readonly ttsClient = new textToSpeech.TextToSpeechClient();

  async generate(text: string, params: GoogleTtsParams): Promise<TtsResult> {
    const startedAt = Date.now();
    try {
      const [response] = await this.withTimeout(
        this.ttsClient.synthesizeSpeech({
          input: { text },
          voice: { languageCode: params.languageCode, name: params.voiceId },
          audioConfig: {
            audioEncoding: params.audioEncoding,
            pitch: params.pitch,
            speakingRate: params.speakingRate,
          },
        }),
        GOOGLE_TTS_TIMEOUT_MS,
      );
      const rtt_ms = Date.now() - startedAt;

      if (!response.audioContent) {
        return {
          ok: false,
          code: 'NO_AUDIO',
          message:
            'Google TTS respondió sin contenido de audio. Revise la voz y el códec.',
          rtt_ms,
        };
      }
      const audio = Buffer.from(response.audioContent as Uint8Array);
      return { ok: true, audio, bytes: audio.length, rtt_ms };
    } catch (error: any) {
      const rtt_ms = Date.now() - startedAt;
      const { code, message } = this.classify(error);
      this.logger.error(`Google TTS falló (${code}): ${message}`);
      return { ok: false, code, message, rtt_ms };
    }
  }

  /** Traduce el error crudo de Google a un código de diagnóstico estable. */
  private classify(error: any): {
    code: AudioDiagnosisErrorCode;
    message: string;
  } {
    const raw = error?.details || error?.message || String(error);
    const h = String(raw).toLowerCase();

    if (
      error?.name === 'TimeoutError' ||
      h.includes('deadline') ||
      h.includes('timeout')
    ) {
      return {
        code: 'TIMEOUT',
        message: 'Google Cloud TTS no respondió a tiempo.',
      };
    }
    if (
      h.includes('permission') ||
      h.includes('credential') ||
      h.includes('unauthenticated') ||
      h.includes('401') ||
      h.includes('403')
    ) {
      return {
        code: 'AUTH',
        message: `Google rechazó las credenciales del proyecto TTS: ${raw}`,
      };
    }
    if (
      h.includes('voice') ||
      h.includes('does not exist') ||
      h.includes('not found')
    ) {
      return {
        code: 'INVALID_VOICE',
        message: `La voz no es válida o no soporta estos parámetros: ${raw}`,
      };
    }
    if (h.includes('invalid') || h.includes('400')) {
      return {
        code: 'BAD_REQUEST',
        message: `Google rechazó los parámetros (pitch/rate/códec): ${raw}`,
      };
    }
    return { code: 'UNKNOWN', message: String(raw) };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`timeout after ${ms}ms`);
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() =>
      clearTimeout(timer),
    ) as Promise<T>;
  }
}
