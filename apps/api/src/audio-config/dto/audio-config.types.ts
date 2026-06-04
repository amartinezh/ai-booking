import {
  AudioEncoding,
  VoiceProvider,
  VoiceGender,
} from '@antigravity/database';

/**
 * Contrato JSON del módulo de Configuración de Voz/Audio (TTS) por organización.
 *
 * Soporta inyección dinámica multi-tenant de proveedores de voz: cada clínica
 * elige `activeProvider` (GOOGLE o ELEVENLABS), el `gender` del asistente y los
 * parámetros/credenciales propios de cada motor. La API key de ElevenLabs jamás
 * viaja en claro hacia el frontend (ver `PublicAudioConfig.hasElevenLabsApiKey`).
 *
 * El frontend mantiene una copia espejo en
 * `apps/web/app/actions/audio-config.types.ts`. Mantener ambos sincronizados.
 */

export type { AudioEncoding, VoiceProvider, VoiceGender };

// ── Rangos válidos de Google Cloud TTS (única fuente de verdad) ───────────────
export const PITCH_MIN = -20.0;
export const PITCH_MAX = 20.0;
export const RATE_MIN = 0.25;
export const RATE_MAX = 4.0;

// ── Defaults seguros (heredan del comportamiento global previo) ───────────────
export const DEFAULT_ACTIVE_PROVIDER: VoiceProvider = 'GOOGLE';
export const DEFAULT_GENDER: VoiceGender = 'FEMENINO';
export const DEFAULT_AUDIO_ENCODING: AudioEncoding = 'OGG_OPUS';
export const DEFAULT_PITCH = 0.0;
export const DEFAULT_SPEAKING_RATE = 1.0;
export const DEFAULT_VOICE_ID = 'es-US-Neural2-A';
/** Idioma fijo del producto; las voces del catálogo Google son todas es-US. */
export const LANGUAGE_CODE = 'es-US';

/**
 * Voces ElevenLabs sugeridas por género (lógica de la PoC). El panel las
 * precarga al cambiar el género, pero el admin puede sobrescribir el `voiceId`
 * con cualquier otra voz de su cuenta de ElevenLabs.
 */
export const ELEVENLABS_VOICE_PRESETS: Readonly<Record<VoiceGender, string>> = {
  MASCULINO: 'o2vbTbO3g4GrKUg7rehy',
  FEMENINO: 'qHkrJuifPpn95wK3rm2A',
};

/**
 * Catálogo de voces Google permitidas. Lista blanca contra la que validamos en
 * el backend (una clínica no puede inyectar un `voiceId` arbitrario) y que
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
  {
    id: 'es-US-Neural2-A',
    label: 'A — Femenina (Neural2)',
    gender: 'FEMENINA',
    category: 'Neural2',
  },
  {
    id: 'es-US-Neural2-B',
    label: 'B — Masculina (Neural2)',
    gender: 'MASCULINA',
    category: 'Neural2',
  },
  {
    id: 'es-US-Neural2-C',
    label: 'C — Masculina (Neural2)',
    gender: 'MASCULINA',
    category: 'Neural2',
  },
  {
    id: 'es-US-Wavenet-A',
    label: 'A — Femenina (WaveNet)',
    gender: 'FEMENINA',
    category: 'WaveNet',
  },
  {
    id: 'es-US-Wavenet-B',
    label: 'B — Masculina (WaveNet)',
    gender: 'MASCULINA',
    category: 'WaveNet',
  },
  {
    id: 'es-US-Wavenet-C',
    label: 'C — Masculina (WaveNet)',
    gender: 'MASCULINA',
    category: 'WaveNet',
  },
  {
    id: 'es-US-Studio-B',
    label: 'B — Masculina expresiva (Studio)',
    gender: 'MASCULINA',
    category: 'Studio',
  },
] as const;

export const ALLOWED_VOICE_IDS: ReadonlySet<string> = new Set(
  ALLOWED_VOICES.map((v) => v.id),
);

// ── Lectura: lo que devuelve GET /organizations/:orgId/audio-config ───────────
// NUNCA incluye la API key de ElevenLabs en claro; solo si está configurada.
export interface PublicAudioConfig {
  activeProvider: VoiceProvider;
  gender: VoiceGender;
  audioEncoding: AudioEncoding;
  // Google (Plan B)
  googleVoiceId: string;
  googlePitch: number;
  googleSpeakingRate: number;
  // ElevenLabs (Studio Quality)
  elevenLabsVoiceId: string | null;
  /** `true` si hay API key guardada (encriptada). El valor jamás se expone. */
  hasElevenLabsApiKey: boolean;
  // Catálogos / ayudas embebidas para el frontend
  allowedVoices: readonly VoiceOption[];
  elevenLabsVoicePresets: Readonly<Record<VoiceGender, string>>;
  limits: {
    pitchMin: number;
    pitchMax: number;
    rateMin: number;
    rateMax: number;
  };
  updatedAt: string | null;
}

// ── Escritura: cuerpo de PUT /organizations/:orgId/audio-config ───────────────
// Campos opcionales = patch parcial. `elevenLabsApiKey` llega en claro y se
// encripta antes de persistir; si se omite o llega vacío, NO se modifica.
export interface SaveAudioConfigInput {
  activeProvider?: VoiceProvider;
  gender?: VoiceGender;
  audioEncoding?: AudioEncoding;
  googleVoiceId?: string;
  googlePitch?: number;
  googleSpeakingRate?: number;
  elevenLabsVoiceId?: string | null;
  elevenLabsApiKey?: string;
}

/**
 * Configuración ya resuelta y saneada que se inyecta en la síntesis. Uso
 * INTERNO del backend: contiene la API key de ElevenLabs DESENCRIPTADA, por lo
 * que jamás debe serializarse hacia el cliente.
 */
export interface ResolvedAudioConfig {
  activeProvider: VoiceProvider;
  gender: VoiceGender;
  audioEncoding: AudioEncoding;
  google: {
    voiceId: string;
    pitch: number;
    speakingRate: number;
    audioEncoding: AudioEncoding;
    languageCode: string;
  };
  elevenLabs: {
    /** API key en claro (desencriptada) o `null` si la clínica no la configuró. */
    apiKey: string | null;
    voiceId: string | null;
  };
}

// ── Diagnóstico (botón "Validar Servicio Alive") ──────────────────────────────
export type AudioDiagnosisErrorCode =
  | 'AUTH' // credenciales rechazadas
  | 'PLAN_REQUIRED' // voz/feature de ElevenLabs exige plan de pago (402)
  | 'QUOTA_EXCEEDED' // créditos agotados / rate limit (429)
  | 'INVALID_VOICE' // la voz no existe o no soporta los parámetros
  | 'BAD_REQUEST' // parámetros rechazados por el proveedor
  | 'TIMEOUT' // el proveedor no respondió a tiempo
  | 'NO_AUDIO' // respondió 200 pero sin contenido de audio
  | 'NOT_CONFIGURED' // falta credencial/voz para el proveedor activo
  | 'UNKNOWN';

export interface AudioDiagnosisSuccess {
  success: true;
  status: 'alive';
  /** Proveedor realmente probado. */
  provider: VoiceProvider;
  /** Latencia round-trip al proveedor, en ms. */
  rtt_ms: number;
  /** Bytes del audio de prueba sintetizado. */
  audio_bytes: number;
  voiceId: string;
}

export interface AudioDiagnosisError {
  success: false;
  provider?: VoiceProvider;
  error_code: AudioDiagnosisErrorCode;
  error_message: string;
  rtt_ms?: number;
}

export type AudioDiagnosisResult = AudioDiagnosisSuccess | AudioDiagnosisError;
