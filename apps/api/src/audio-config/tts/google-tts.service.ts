import { Injectable, Logger } from '@nestjs/common';
import textToSpeech from '@google-cloud/text-to-speech';
import { AudioDiagnosisErrorCode } from '../dto/audio-config.types';
import {
  GoogleTtsParams,
  TtsProvider,
  TtsResult,
} from './tts-provider.interface';
import { getGrpcErrorDetail } from '../../common/error-message.util';

/** Cap de latencia antes de declarar TIMEOUT (no debe colgar el chat). */
const GOOGLE_TTS_TIMEOUT_MS = 8000;

/**
 * Interruptor MANUAL de Google Cloud TTS. Apagado salvo `GOOGLE_TTS_ENABLED=true`.
 *
 * Decisión del 2026-10-02: la voz de las clínicas sale por ElevenLabs y Google
 * quedó sin credenciales en producción. Encendido, su check fallaba cada 15 min
 * (más un UnhandledRejection del cliente gRPC) sin que nadie lo usara. Se
 * enciende a mano solo ante una emergencia de ElevenLabs o un cambio de
 * proveedor (junto con GOOGLE_APPLICATION_CREDENTIALS y reinicio de la API).
 *
 * Apagado: el cliente de Google ni se crea, el monitor omite el check, y si
 * ElevenLabs falla el bot responde solo con texto.
 */
export function isGoogleTtsEnabled(): boolean {
  return process.env.GOOGLE_TTS_ENABLED?.trim().toLowerCase() === 'true';
}

/** Mensaje común cuando algo pide Google TTS con el interruptor apagado. */
export const GOOGLE_TTS_DISABLED_MESSAGE =
  'Google Cloud TTS está apagado (GOOGLE_TTS_ENABLED no es true). Se enciende manualmente solo ante una emergencia o un cambio de proveedor.';

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
  /**
   * Perezoso: crear el cliente ya dispara la búsqueda de credenciales de
   * Google, así que con el interruptor apagado no se crea nunca.
   */
  private ttsClient?: InstanceType<typeof textToSpeech.TextToSpeechClient>;

  private client() {
    return (this.ttsClient ??= new textToSpeech.TextToSpeechClient());
  }

  async generate(text: string, params: GoogleTtsParams): Promise<TtsResult> {
    if (!isGoogleTtsEnabled()) {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        message: GOOGLE_TTS_DISABLED_MESSAGE,
        rtt_ms: 0,
      };
    }
    const startedAt = Date.now();
    try {
      const [response] = await this.withTimeout(
        this.client().synthesizeSpeech({
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
  private classify(error: unknown): {
    code: AudioDiagnosisErrorCode;
    message: string;
  } {
    const raw = getGrpcErrorDetail(error);
    const h = raw.toLowerCase();

    if (
      (error instanceof Error && error.name === 'TimeoutError') ||
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
    return { code: 'UNKNOWN', message: raw };
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
