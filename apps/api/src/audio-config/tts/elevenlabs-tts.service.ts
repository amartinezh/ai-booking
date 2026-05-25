import { Injectable, Logger } from '@nestjs/common';
import { AudioDiagnosisErrorCode } from '../dto/audio-config.types';
import {
  ElevenLabsTtsParams,
  TtsProvider,
  TtsResult,
} from './tts-provider.interface';

// ── Constantes del proveedor ──────────────────────────────────────────────────
/** Endpoint oficial: POST /v1/text-to-speech/{voice_id}. */
const ELEVENLABS_TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
/** Modelo multilingüe v2: soporta español con calidad Studio. */
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
/**
 * `opus_48000_64` devuelve OGG/Opus, justo lo que espera la subida a WhatsApp
 * (`audio/ogg`). Verificado contra la API real durante la PoC.
 */
const ELEVENLABS_OUTPUT_FORMAT = 'opus_48000_64';
/** Cap de latencia antes de abortar la request. */
const ELEVENLABS_TIMEOUT_MS = 12_000;

/**
 * Proveedor: ElevenLabs (Studio Quality).
 *
 * Stateless respecto al tenant: recibe `apiKey` y `voiceId` ya resueltos y
 * desencriptados por `AudioConfigService`. No lee la BD ni el `.env`.
 */
@Injectable()
export class ElevenLabsTtsService implements TtsProvider<ElevenLabsTtsParams> {
  readonly name = 'ELEVENLABS' as const;
  private readonly logger = new Logger(ElevenLabsTtsService.name);

  async generate(
    text: string,
    { apiKey, voiceId }: ElevenLabsTtsParams,
  ): Promise<TtsResult> {
    if (!apiKey || !voiceId) {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        message:
          'ElevenLabs no está configurado: falta la API key y/o el Voice ID de la clínica.',
        rtt_ms: 0,
      };
    }

    const url = `${ELEVENLABS_TTS_BASE}/${voiceId}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/ogg',
        },
        body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL_ID }),
        signal: controller.signal,
      });
      const rtt_ms = Date.now() - startedAt;

      if (!res.ok) {
        const body = await safeReadText(res);
        const code = classifyHttpStatus(res.status);
        const message = `ElevenLabs ${res.status} (${code}): ${body.slice(0, 500)}`;
        this.logger.error(message);
        return { ok: false, code, message, rtt_ms };
      }

      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) {
        return {
          ok: false,
          code: 'NO_AUDIO',
          message: 'ElevenLabs respondió 200 pero sin contenido de audio.',
          rtt_ms,
        };
      }
      this.logger.log(
        `ElevenLabs TTS OK — ${audio.length} bytes, ${rtt_ms}ms, voice=${voiceId}`,
      );
      return { ok: true, audio, bytes: audio.length, rtt_ms };
    } catch (error: any) {
      const rtt_ms = Date.now() - startedAt;
      const isTimeout = error?.name === 'AbortError';
      return {
        ok: false,
        code: isTimeout ? 'TIMEOUT' : 'UNKNOWN',
        message: isTimeout
          ? `ElevenLabs no respondió en ${ELEVENLABS_TIMEOUT_MS}ms.`
          : `Fallo de red contactando ElevenLabs: ${error?.message ?? String(error)}`,
        rtt_ms,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── helpers puros ─────────────────────────────────────────────────────────────

/** Mapea el HTTP status de ElevenLabs a un código de diagnóstico estable. */
function classifyHttpStatus(status: number): AudioDiagnosisErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402) return 'PLAN_REQUIRED'; // voz de librería exige plan de pago
  if (status === 429) return 'QUOTA_EXCEEDED';
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  if (status === 404) return 'INVALID_VOICE';
  return 'UNKNOWN';
}

/** Lee el cuerpo de error sin que un fallo de parseo enmascare el error real. */
async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<cuerpo de respuesta ilegible>';
  }
}
