import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemLogService } from '../../system-log/system-log.service';
import { TtsProvider, TtsSynthesisInput } from './tts-provider.interface';

// ── Constantes de la PoC ──────────────────────────────────────────────────────
/** Endpoint oficial de síntesis: POST /v1/text-to-speech/{voice_id}. */
const ELEVENLABS_TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
/** Modelo multilingüe v2: soporta español con calidad Studio. */
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
/**
 * Formato de salida. `opus_48000_64` devuelve audio OGG/Opus, que es justo lo
 * que `ChatbotService.uploadToWhatsApp` espera (blob `audio/ogg`) para enviar la
 * nota de voz. Así la PoC no toca la integración existente de WhatsApp.
 */
const ELEVENLABS_OUTPUT_FORMAT = 'opus_48000_64';
/** Cap de latencia antes de abortar la request (la PoC no debe colgar el chat). */
const ELEVENLABS_TIMEOUT_MS = 12_000;

/** Clasificación técnica del fallo, para `SystemLog.action` y telemetría. */
type ElevenLabsErrorCode =
  | 'AUTH' // API key rechazada (401/403)
  | 'QUOTA_EXCEEDED' // créditos agotados / rate limit (429)
  | 'BAD_REQUEST' // texto/voz/parámetros inválidos (400/422)
  | 'TIMEOUT' // no respondió dentro de ELEVENLABS_TIMEOUT_MS
  | 'NO_AUDIO' // 200 OK pero cuerpo vacío
  | 'HTTP_ERROR' // otros 4xx/5xx
  | 'NETWORK'; // fallo de red / excepción no clasificable

/**
 * Proveedor de Prueba de Concepto: ElevenLabs (voz "Studio Quality").
 *
 * AISLAMIENTO ESTRICTO: lee **exclusivamente** las variables hardcodeadas
 * `ELEVENLABS_API_KEY_POC` y `ELEVENLABS_VOICE_ID_POC` desde `@nestjs/config`.
 * No consulta la base de datos de la organización ni `OrganizationAudioConfig`.
 *
 * Si la síntesis falla, registra el detalle técnico en `SystemLogModule` y
 * devuelve `null`; el `TtsFactoryService` se encarga del fallback a Google.
 */
@Injectable()
export class ElevenLabsTtsService implements TtsProvider {
  readonly name = 'ELEVENLABS' as const;
  private readonly logger = new Logger(ElevenLabsTtsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly systemLog: SystemLogService,
  ) {}

  async synthesize({
    organizationId,
    text,
  }: TtsSynthesisInput): Promise<Buffer | null> {
    const apiKey = this.config.get<string>('ELEVENLABS_API_KEY_POC');
    const voiceId = this.config.get<string>('ELEVENLABS_VOICE_ID_POC');

    // Safeguard de configuración: sin credenciales PoC no intentamos la llamada.
    if (!apiKey || !voiceId) {
      const message =
        'ElevenLabs PoC mal configurado: faltan ELEVENLABS_API_KEY_POC y/o ELEVENLABS_VOICE_ID_POC en el .env.';
      this.logger.error(message);
      await this.systemLog.error({
        action: 'TTS_ELEVENLABS_CONFIG_MISSING',
        message,
        organizationId,
        metadata: { hasApiKey: !!apiKey, hasVoiceId: !!voiceId },
      });
      return null;
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
        await this.logError(organizationId, voiceId, code, rtt_ms, {
          httpStatus: res.status,
          responseBody: body.slice(0, 2000),
        });
        return null;
      }

      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) {
        await this.logError(organizationId, voiceId, 'NO_AUDIO', rtt_ms, {
          httpStatus: res.status,
        });
        return null;
      }

      this.logger.log(
        `ElevenLabs TTS OK — ${audio.length} bytes, ${rtt_ms}ms, voice=${voiceId}, format=${ELEVENLABS_OUTPUT_FORMAT}`,
      );
      return audio;
    } catch (error: any) {
      const rtt_ms = Date.now() - startedAt;
      const code: ElevenLabsErrorCode =
        error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      await this.logError(organizationId, voiceId, code, rtt_ms, {
        exception: error?.message ?? String(error),
        timeoutMs: ELEVENLABS_TIMEOUT_MS,
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Registra el fallo "con lujo de detalle técnico" en SystemLog (fire-and-forget)
   * y deja también una línea en el logger de la app. Nunca incluye la API key.
   */
  private async logError(
    organizationId: string,
    voiceId: string,
    code: ElevenLabsErrorCode,
    rtt_ms: number,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const message = `ElevenLabs TTS falló (${code}) tras ${rtt_ms}ms — voice=${voiceId}`;
    this.logger.error(`${message} :: ${JSON.stringify(extra)}`);
    await this.systemLog.error({
      action: `TTS_ELEVENLABS_${code}`,
      message,
      organizationId,
      metadata: {
        provider: 'ELEVENLABS',
        voiceId,
        modelId: ELEVENLABS_MODEL_ID,
        outputFormat: ELEVENLABS_OUTPUT_FORMAT,
        rtt_ms,
        ...extra,
      },
    });
  }
}

// ── helpers puros ─────────────────────────────────────────────────────────────

/** Mapea el HTTP status de ElevenLabs a un código de error interno. */
function classifyHttpStatus(status: number): ElevenLabsErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'QUOTA_EXCEEDED';
  // ElevenLabs usa 422 (Unprocessable Entity) para errores de validación.
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  return 'HTTP_ERROR';
}

/** Lee el cuerpo de error sin que un fallo de parseo enmascare el error real. */
async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<cuerpo de respuesta ilegible>';
  }
}
