import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AudioEncoding,
  VoiceGender,
  VoiceProvider,
} from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { GoogleTtsService } from './tts/google-tts.service';
import { ElevenLabsTtsService } from './tts/elevenlabs-tts.service';
import { TtsResult } from './tts/tts-provider.interface';
import {
  ALLOWED_VOICE_IDS,
  ALLOWED_VOICES,
  AudioDiagnosisResult,
  DEFAULT_ACTIVE_PROVIDER,
  DEFAULT_AUDIO_ENCODING,
  DEFAULT_GENDER,
  DEFAULT_PITCH,
  DEFAULT_SPEAKING_RATE,
  DEFAULT_VOICE_ID,
  ELEVENLABS_VOICE_PRESETS,
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
const VALID_PROVIDERS: ReadonlySet<VoiceProvider> = new Set<VoiceProvider>([
  'GOOGLE',
  'ELEVENLABS',
]);
const VALID_GENDERS: ReadonlySet<VoiceGender> = new Set<VoiceGender>([
  'MASCULINO',
  'FEMENINO',
]);

/** Forma cruda de la fila, para tipar lecturas parciales. */
type AudioConfigRow = {
  activeProvider: VoiceProvider;
  gender: VoiceGender;
  audioEncoding: AudioEncoding;
  googlePitch: number;
  googleSpeakingRate: number;
  googleVoiceId: string;
  elevenLabsApiKey: string | null;
  elevenLabsVoiceId: string | null;
  updatedAt?: Date;
};

/**
 * Configuración de voz/audio por organización (multi-tenant) con inyección
 * dinámica de proveedores (Google / ElevenLabs).
 *
 * Toda lectura/escritura está estrictamente acotada por `organizationId`.
 *  - `getEffective`: config saneada lista para el `TtsFactoryService`
 *    (incluye la API key de ElevenLabs DESENCRIPTADA — uso interno).
 *  - `getPublic` / `upsert`: contrato del panel de administración (sin secretos).
 *  - `diagnose`: sintetiza un audio mínimo con el PROVEEDOR ACTIVO de la clínica.
 */
@Injectable()
export class AudioConfigService {
  private readonly logger = new Logger(AudioConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly google: GoogleTtsService,
    private readonly elevenLabs: ElevenLabsTtsService,
  ) {}

  // ── Resolución para el motor de TTS ─────────────────────────────────────────

  /**
   * Config EFECTIVA de una organización: lee su fila y cae a defaults seguros si
   * falta o trae valores corruptos. Clampa rangos y valida la voz de Google, de
   * modo que el resultado jamás rompe la llamada al proveedor. Desencripta la
   * API key de ElevenLabs (solo para uso interno del factory).
   */
  async getEffective(organizationId: string): Promise<ResolvedAudioConfig> {
    let row: AudioConfigRow | null = null;
    try {
      row = await this.prisma.organizationAudioConfig.findUnique({
        where: { organizationId },
        select: {
          activeProvider: true,
          gender: true,
          audioEncoding: true,
          googlePitch: true,
          googleSpeakingRate: true,
          googleVoiceId: true,
          elevenLabsApiKey: true,
          elevenLabsVoiceId: true,
        },
      });
    } catch (err: any) {
      // Nunca tumbamos el flujo del chatbot por un problema de config: log + defaults.
      this.logger.warn(
        `No se pudo leer audioConfig de org ${organizationId}, uso defaults: ${err.message}`,
      );
    }

    const audioEncoding = VALID_ENCODINGS.has(
      row?.audioEncoding as AudioEncoding,
    )
      ? row!.audioEncoding
      : DEFAULT_AUDIO_ENCODING;

    return {
      activeProvider: VALID_PROVIDERS.has(row?.activeProvider as VoiceProvider)
        ? row!.activeProvider
        : DEFAULT_ACTIVE_PROVIDER,
      gender: VALID_GENDERS.has(row?.gender as VoiceGender)
        ? row!.gender
        : DEFAULT_GENDER,
      audioEncoding,
      google: {
        voiceId:
          row?.googleVoiceId && ALLOWED_VOICE_IDS.has(row.googleVoiceId)
            ? row.googleVoiceId
            : DEFAULT_VOICE_ID,
        pitch: clamp(row?.googlePitch ?? DEFAULT_PITCH, PITCH_MIN, PITCH_MAX),
        speakingRate: clamp(
          row?.googleSpeakingRate ?? DEFAULT_SPEAKING_RATE,
          RATE_MIN,
          RATE_MAX,
        ),
        audioEncoding,
        languageCode: LANGUAGE_CODE,
      },
      elevenLabs: {
        apiKey: this.safeDecrypt(row?.elevenLabsApiKey ?? null, organizationId),
        voiceId: row?.elevenLabsVoiceId ?? null,
      },
    };
  }

  // ── Panel de administración ─────────────────────────────────────────────────

  /** Estado actual para el GET del panel (sin secretos; incluye catálogo). */
  async getPublic(organizationId: string): Promise<PublicAudioConfig> {
    const row = await this.prisma.organizationAudioConfig.findUnique({
      where: { organizationId },
    });

    return {
      activeProvider:
        (row?.activeProvider as VoiceProvider) ?? DEFAULT_ACTIVE_PROVIDER,
      gender: (row?.gender as VoiceGender) ?? DEFAULT_GENDER,
      audioEncoding:
        (row?.audioEncoding as AudioEncoding) ?? DEFAULT_AUDIO_ENCODING,
      googleVoiceId: row?.googleVoiceId ?? DEFAULT_VOICE_ID,
      googlePitch: row?.googlePitch ?? DEFAULT_PITCH,
      googleSpeakingRate: row?.googleSpeakingRate ?? DEFAULT_SPEAKING_RATE,
      elevenLabsVoiceId: row?.elevenLabsVoiceId ?? null,
      // NUNCA exponemos la key; solo si existe.
      hasElevenLabsApiKey: !!row?.elevenLabsApiKey,
      allowedVoices: ALLOWED_VOICES,
      elevenLabsVoicePresets: ELEVENLABS_VOICE_PRESETS,
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
   * Crea o actualiza la configuración (patch parcial). Valida ANTES de tocar la
   * BD; encripta la API key de ElevenLabs si se envía. Una key vacía/omitida no
   * modifica la existente.
   */
  async upsert(
    organizationId: string,
    input: SaveAudioConfigInput,
  ): Promise<PublicAudioConfig> {
    const data: Record<string, unknown> = {};

    if (input.activeProvider !== undefined) {
      if (!VALID_PROVIDERS.has(input.activeProvider)) {
        throw new BadRequestException(
          `Proveedor inválido: ${input.activeProvider}.`,
        );
      }
      data.activeProvider = input.activeProvider;
    }

    if (input.gender !== undefined) {
      if (!VALID_GENDERS.has(input.gender)) {
        throw new BadRequestException(`Género inválido: ${input.gender}.`);
      }
      data.gender = input.gender;
    }

    if (input.audioEncoding !== undefined) {
      if (!VALID_ENCODINGS.has(input.audioEncoding)) {
        throw new BadRequestException(
          `Códec inválido: ${input.audioEncoding}. Permitidos: ${[...VALID_ENCODINGS].join(', ')}.`,
        );
      }
      data.audioEncoding = input.audioEncoding;
    }

    if (input.googlePitch !== undefined) {
      assertInRange('googlePitch', input.googlePitch, PITCH_MIN, PITCH_MAX);
      data.googlePitch = input.googlePitch;
    }

    if (input.googleSpeakingRate !== undefined) {
      assertInRange(
        'googleSpeakingRate',
        input.googleSpeakingRate,
        RATE_MIN,
        RATE_MAX,
      );
      data.googleSpeakingRate = input.googleSpeakingRate;
    }

    if (input.googleVoiceId !== undefined) {
      if (!ALLOWED_VOICE_IDS.has(input.googleVoiceId)) {
        throw new BadRequestException(
          `Voz de Google no permitida: ${input.googleVoiceId}. Use una del catálogo.`,
        );
      }
      data.googleVoiceId = input.googleVoiceId;
    }

    // ElevenLabs voiceId: cualquier string no vacío; null/'' lo limpia.
    if (input.elevenLabsVoiceId !== undefined) {
      const v = input.elevenLabsVoiceId?.trim();
      data.elevenLabsVoiceId = v ? v : null;
    }

    // ElevenLabs API key: se ENCRIPTA al guardar. Vacío/omitido = sin cambios.
    if (
      input.elevenLabsApiKey !== undefined &&
      input.elevenLabsApiKey.trim() !== ''
    ) {
      data.elevenLabsApiKey = this.crypto.encrypt(
        input.elevenLabsApiKey.trim(),
      );
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
   * Sintetiza un audio mínimo ("ok") con el PROVEEDOR ACTIVO de la clínica y su
   * configuración real. Confirma credenciales + voz + parámetros sin enviar nada
   * a ningún paciente.
   */
  async diagnose(organizationId: string): Promise<AudioDiagnosisResult> {
    const cfg = await this.getEffective(organizationId);

    if (cfg.activeProvider === 'ELEVENLABS') {
      if (!cfg.elevenLabs.apiKey || !cfg.elevenLabs.voiceId) {
        return {
          success: false,
          provider: 'ELEVENLABS',
          error_code: 'NOT_CONFIGURED',
          error_message:
            'ElevenLabs es el proveedor activo pero falta la API key y/o el Voice ID. Configúrelos y guarde antes de validar.',
        };
      }
      const res = await this.elevenLabs.generate('ok', {
        apiKey: cfg.elevenLabs.apiKey,
        voiceId: cfg.elevenLabs.voiceId,
      });
      return this.toDiagnosis(res, 'ELEVENLABS', cfg.elevenLabs.voiceId);
    }

    const res = await this.google.generate('ok', cfg.google);
    return this.toDiagnosis(res, 'GOOGLE', cfg.google.voiceId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private toDiagnosis(
    res: TtsResult,
    provider: VoiceProvider,
    voiceId: string,
  ): AudioDiagnosisResult {
    if (res.ok) {
      return {
        success: true,
        status: 'alive',
        provider,
        rtt_ms: res.rtt_ms,
        audio_bytes: res.bytes,
        voiceId,
      };
    }
    return {
      success: false,
      provider,
      error_code: res.code,
      error_message: res.message,
      rtt_ms: res.rtt_ms,
    };
  }

  /** Desencripta sin tumbar el flujo: si falla, loguea y devuelve null. */
  private safeDecrypt(
    ciphertext: string | null,
    organizationId: string,
  ): string | null {
    if (!ciphertext) return null;
    try {
      return this.crypto.decrypt(ciphertext);
    } catch (err: any) {
      this.logger.error(
        `No se pudo desencriptar la API key de ElevenLabs de org ${organizationId}: ${err.message}`,
      );
      return null;
    }
  }
}

// ── utilidades puras ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function assertInRange(
  field: string,
  value: number,
  min: number,
  max: number,
): void {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    value < min ||
    value > max
  ) {
    throw new BadRequestException(
      `${field} fuera de rango: ${value}. Debe estar entre ${min} y ${max}.`,
    );
  }
}
