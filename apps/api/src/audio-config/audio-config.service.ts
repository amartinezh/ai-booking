import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import textToSpeech from '@google-cloud/text-to-speech';
import { AudioEncoding } from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_VOICE_IDS,
  ALLOWED_VOICES,
  AudioDiagnosisResult,
  DEFAULT_AUDIO_ENCODING,
  DEFAULT_PITCH,
  DEFAULT_SPEAKING_RATE,
  DEFAULT_VOICE_ID,
  LANGUAGE_CODE,
  PITCH_MAX,
  PITCH_MIN,
  PublicAudioConfig,
  RATE_MAX,
  RATE_MIN,
  ResolvedAudioConfig,
  SaveAudioConfigInput,
} from './dto/audio-config.types';

/** Códecs aceptados (debe coincidir con el enum Prisma AudioEncoding). */
const VALID_ENCODINGS: ReadonlySet<AudioEncoding> = new Set<AudioEncoding>([
  'OGG_OPUS',
  'MP3',
  'LINEAR16',
]);

/** Cap de latencia del diagnóstico antes de declarar TIMEOUT. */
const DIAGNOSE_TIMEOUT_MS = 8000;

/**
 * Configuración de voz/audio por organización (multi-tenant).
 *
 * Reemplaza las constantes hardcoded del antiguo "Gestor de Audios". Toda
 * lectura/escritura está estrictamente acotada por `organizationId`. Expone:
 *   - `getEffective`: config saneada lista para inyectar en Google TTS.
 *   - `getPublic` / `upsert`: contrato del panel de administración.
 *   - `diagnose`: sintetiza un audio mínimo ("ok") para el botón "Alive".
 */
@Injectable()
export class AudioConfigService {
  private readonly logger = new Logger(AudioConfigService.name);
  private readonly ttsClient = new textToSpeech.TextToSpeechClient();

  constructor(private readonly prisma: PrismaService) {}

  // ── Resolución para el motor de TTS ─────────────────────────────────────────

  /**
   * Devuelve la configuración EFECTIVA de una organización: lee la fila propia
   * y, si falta o trae valores corruptos, cae a defaults seguros. Siempre
   * clampa al rango válido y valida la voz contra la lista blanca, de modo que
   * el resultado jamás puede romper la llamada a Google TTS.
   */
  async getEffective(organizationId: string): Promise<ResolvedAudioConfig> {
    let row: {
      audioEncoding: AudioEncoding;
      pitch: number;
      speakingRate: number;
      voiceId: string;
    } | null = null;

    try {
      row = await this.prisma.organizationAudioConfig.findUnique({
        where: { organizationId },
        select: {
          audioEncoding: true,
          pitch: true,
          speakingRate: true,
          voiceId: true,
        },
      });
    } catch (err: any) {
      // Nunca tumbamos el flujo del chatbot por un problema de config: log + defaults.
      this.logger.warn(
        `No se pudo leer audioConfig de org ${organizationId}, uso defaults: ${err.message}`,
      );
    }

    return {
      audioEncoding: VALID_ENCODINGS.has(row?.audioEncoding as AudioEncoding)
        ? (row!.audioEncoding as AudioEncoding)
        : DEFAULT_AUDIO_ENCODING,
      pitch: clamp(row?.pitch ?? DEFAULT_PITCH, PITCH_MIN, PITCH_MAX),
      speakingRate: clamp(
        row?.speakingRate ?? DEFAULT_SPEAKING_RATE,
        RATE_MIN,
        RATE_MAX,
      ),
      voiceId:
        row?.voiceId && ALLOWED_VOICE_IDS.has(row.voiceId)
          ? row.voiceId
          : DEFAULT_VOICE_ID,
      languageCode: LANGUAGE_CODE,
    };
  }

  // ── Panel de administración ─────────────────────────────────────────────────

  /** Estado actual para el GET del panel (incluye catálogo y límites). */
  async getPublic(organizationId: string): Promise<PublicAudioConfig> {
    const row = await this.prisma.organizationAudioConfig.findUnique({
      where: { organizationId },
    });

    return {
      audioEncoding: (row?.audioEncoding as AudioEncoding) ?? DEFAULT_AUDIO_ENCODING,
      pitch: row?.pitch ?? DEFAULT_PITCH,
      speakingRate: row?.speakingRate ?? DEFAULT_SPEAKING_RATE,
      voiceId: row?.voiceId ?? DEFAULT_VOICE_ID,
      allowedVoices: ALLOWED_VOICES,
      limits: {
        pitchMin: PITCH_MIN,
        pitchMax: PITCH_MAX,
        rateMin: RATE_MIN,
        rateMax: RATE_MAX,
      },
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  /**
   * Crea o actualiza la configuración de la organización. Valida rangos y voz
   * ANTES de tocar la BD (el CHECK constraint es la última línea de defensa).
   */
  async upsert(
    organizationId: string,
    input: SaveAudioConfigInput,
  ): Promise<PublicAudioConfig> {
    const data: Record<string, unknown> = {};

    if (input.audioEncoding !== undefined) {
      if (!VALID_ENCODINGS.has(input.audioEncoding)) {
        throw new BadRequestException(
          `Códec inválido: ${input.audioEncoding}. Permitidos: ${[...VALID_ENCODINGS].join(', ')}.`,
        );
      }
      data.audioEncoding = input.audioEncoding;
    }

    if (input.pitch !== undefined) {
      assertInRange('pitch', input.pitch, PITCH_MIN, PITCH_MAX);
      data.pitch = input.pitch;
    }

    if (input.speakingRate !== undefined) {
      assertInRange('speakingRate', input.speakingRate, RATE_MIN, RATE_MAX);
      data.speakingRate = input.speakingRate;
    }

    if (input.voiceId !== undefined) {
      if (!ALLOWED_VOICE_IDS.has(input.voiceId)) {
        throw new BadRequestException(
          `Voz no permitida: ${input.voiceId}. Use una del catálogo.`,
        );
      }
      data.voiceId = input.voiceId;
    }

    await this.prisma.organizationAudioConfig.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });

    return this.getPublic(organizationId);
  }

  // ── Botón "Validar Servicio Alive" ──────────────────────────────────────────

  /**
   * Llama a Google TTS con la configuración REAL de la clínica para sintetizar
   * un audio mínimo ("ok"). Confirma que credenciales + voz + pitch + rate +
   * códec son aceptados por el proveedor. No envía nada a ningún paciente.
   */
  async diagnose(organizationId: string): Promise<AudioDiagnosisResult> {
    const cfg = await this.getEffective(organizationId);
    const startedAt = Date.now();

    try {
      const [response] = await this.withTimeout(
        this.ttsClient.synthesizeSpeech({
          input: { text: 'ok' },
          voice: { languageCode: cfg.languageCode, name: cfg.voiceId },
          audioConfig: {
            audioEncoding: cfg.audioEncoding,
            pitch: cfg.pitch,
            speakingRate: cfg.speakingRate,
          },
        }),
        DIAGNOSE_TIMEOUT_MS,
      );

      const rtt_ms = Date.now() - startedAt;
      const bytes = response?.audioContent
        ? Buffer.from(response.audioContent as Uint8Array).length
        : 0;

      if (!bytes) {
        return {
          success: false,
          error_code: 'NO_AUDIO',
          error_message:
            'Google TTS respondió pero sin contenido de audio. Revise la voz y el códec seleccionados.',
          rtt_ms,
        };
      }

      return {
        success: true,
        status: 'alive',
        rtt_ms,
        audio_bytes: bytes,
        voiceId: cfg.voiceId,
      };
    } catch (error: any) {
      return this.classifyError(error, Date.now() - startedAt);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private classifyError(error: any, rtt_ms: number): AudioDiagnosisResult {
    const raw = error?.details || error?.message || String(error);
    const h = String(raw).toLowerCase();

    if (error?.name === 'TimeoutError' || h.includes('deadline') || h.includes('timeout')) {
      return {
        success: false,
        error_code: 'TIMEOUT',
        error_message: 'Google Cloud TTS no respondió a tiempo.',
        rtt_ms,
      };
    }
    if (h.includes('permission') || h.includes('credential') || h.includes('unauthenticated') || h.includes('401') || h.includes('403')) {
      return {
        success: false,
        error_code: 'AUTH',
        error_message: `Google rechazó las credenciales del proyecto TTS: ${raw}`,
        rtt_ms,
      };
    }
    if (h.includes('voice') || h.includes('does not exist') || h.includes('not found')) {
      return {
        success: false,
        error_code: 'INVALID_VOICE',
        error_message: `La voz seleccionada no es válida o no soporta estos parámetros: ${raw}`,
        rtt_ms,
      };
    }
    if (h.includes('invalid') || h.includes('400')) {
      return {
        success: false,
        error_code: 'BAD_REQUEST',
        error_message: `Google rechazó los parámetros (pitch/rate/códec): ${raw}`,
        rtt_ms,
      };
    }

    this.logger.error(`Diagnóstico de audio falló: ${raw}`);
    return {
      success: false,
      error_code: 'UNKNOWN',
      error_message: String(raw),
      rtt_ms,
    };
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

// ── utilidades puras ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function assertInRange(field: string, value: number, min: number, max: number): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    throw new BadRequestException(
      `${field} fuera de rango: ${value}. Debe estar entre ${min} y ${max}.`,
    );
  }
}
