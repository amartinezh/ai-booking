import { AudioEncoding } from '@antigravity/database';

/**
 * Contrato JSON del módulo de Configuración de Voz/Audio por organización.
 *
 * El frontend mantiene una copia espejo en
 * `apps/web/app/actions/audio-config.types.ts`. Mantener ambos sincronizados.
 */

// ── Rangos válidos de Google Cloud TTS (única fuente de verdad) ───────────────
export const PITCH_MIN = -20.0;
export const PITCH_MAX = 20.0;
export const RATE_MIN = 0.25;
export const RATE_MAX = 4.0;

// ── Defaults seguros (heredan del comportamiento global previo) ───────────────
export const DEFAULT_AUDIO_ENCODING: AudioEncoding = 'OGG_OPUS';
export const DEFAULT_PITCH = 0.0;
export const DEFAULT_SPEAKING_RATE = 1.0;
export const DEFAULT_VOICE_ID = 'es-US-Neural2-A';
/** Idioma fijo del producto; las voces del catálogo son todas es-US. */
export const LANGUAGE_CODE = 'es-US';

/**
 * Catálogo de voces permitidas. Es la lista blanca contra la que validamos en
 * el backend (una clínica no puede inyectar un `voiceId` arbitrario) y la que
 * alimenta el dropdown del frontend.
 */
export interface VoiceOption {
  id: string;
  /** Nombre comercial mostrado al admin de la clínica. */
  label: string;
  gender: 'FEMENINA' | 'MASCULINA';
  /** Familia de tecnología, para agrupar visualmente en el dropdown. */
  category: 'Neural2' | 'WaveNet' | 'Studio';
}

export const ALLOWED_VOICES: readonly VoiceOption[] = [
  { id: 'es-US-Neural2-A', label: 'A — Femenina (Neural2)', gender: 'FEMENINA', category: 'Neural2' },
  { id: 'es-US-Neural2-B', label: 'B — Masculina (Neural2)', gender: 'MASCULINA', category: 'Neural2' },
  { id: 'es-US-Neural2-C', label: 'C — Masculina (Neural2)', gender: 'MASCULINA', category: 'Neural2' },
  { id: 'es-US-Wavenet-A', label: 'A — Femenina (WaveNet)', gender: 'FEMENINA', category: 'WaveNet' },
  { id: 'es-US-Wavenet-B', label: 'B — Masculina (WaveNet)', gender: 'MASCULINA', category: 'WaveNet' },
  { id: 'es-US-Wavenet-C', label: 'C — Masculina (WaveNet)', gender: 'MASCULINA', category: 'WaveNet' },
  { id: 'es-US-Studio-B', label: 'B — Masculina expresiva (Studio)', gender: 'MASCULINA', category: 'Studio' },
] as const;

export const ALLOWED_VOICE_IDS: ReadonlySet<string> = new Set(
  ALLOWED_VOICES.map((v) => v.id),
);

// ── Lectura: lo que devuelve GET /organizations/:orgId/audio-config ───────────
export interface PublicAudioConfig {
  audioEncoding: AudioEncoding;
  pitch: number;
  speakingRate: number;
  voiceId: string;
  /** Catálogo embebido para que el frontend no lo hardcodee. */
  allowedVoices: readonly VoiceOption[];
  /** Rangos para sliders/validación en la UI. */
  limits: {
    pitchMin: number;
    pitchMax: number;
    rateMin: number;
    rateMax: number;
  };
  updatedAt: string | null;
}

// ── Escritura: cuerpo de PUT /organizations/:orgId/audio-config ───────────────
export interface SaveAudioConfigInput {
  audioEncoding?: AudioEncoding;
  pitch?: number;
  speakingRate?: number;
  voiceId?: string;
}

/**
 * Configuración ya resuelta y saneada que se inyecta en la llamada a TTS.
 * Nunca contiene valores fuera de rango ni una voz no permitida.
 */
export interface ResolvedAudioConfig {
  audioEncoding: AudioEncoding;
  pitch: number;
  speakingRate: number;
  voiceId: string;
  languageCode: string;
}

// ── Diagnóstico (botón "Validar Servicio Alive") ──────────────────────────────
export type AudioDiagnosisErrorCode =
  | 'AUTH' // credenciales de Google rechazadas
  | 'INVALID_VOICE' // la voz no existe o no soporta los parámetros
  | 'BAD_REQUEST' // pitch/rate/codec rechazados por el proveedor
  | 'TIMEOUT' // Google no respondió a tiempo
  | 'NO_AUDIO' // respondió 200 pero sin contenido de audio
  | 'UNKNOWN';

export interface AudioDiagnosisSuccess {
  success: true;
  status: 'alive';
  /** Latencia round-trip a Google Cloud TTS, en ms. */
  rtt_ms: number;
  /** Bytes del audio de prueba sintetizado (audio de ~1s diciendo "ok"). */
  audio_bytes: number;
  voiceId: string;
}

export interface AudioDiagnosisError {
  success: false;
  error_code: AudioDiagnosisErrorCode;
  error_message: string;
  rtt_ms?: number;
}

export type AudioDiagnosisResult = AudioDiagnosisSuccess | AudioDiagnosisError;
