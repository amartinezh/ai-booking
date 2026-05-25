// Espejo de apps/api/src/audio-config/dto/audio-config.types.ts
// Mantener sincronizado con el backend.

export type AudioEncoding = 'OGG_OPUS' | 'MP3' | 'LINEAR16';
export type VoiceProvider = 'GOOGLE' | 'ELEVENLABS';
export type VoiceGender = 'MASCULINO' | 'FEMENINO';

export interface VoiceOption {
    id: string;
    label: string;
    gender: 'FEMENINA' | 'MASCULINA';
    category: 'Neural2' | 'WaveNet' | 'Studio';
}

export interface AudioConfigLimits {
    pitchMin: number;
    pitchMax: number;
    rateMin: number;
    rateMax: number;
}

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
    // Catálogos / ayudas embebidas
    allowedVoices: VoiceOption[];
    elevenLabsVoicePresets: Record<VoiceGender, string>;
    limits: AudioConfigLimits;
    updatedAt: string | null;
}

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

export type AudioDiagnosisErrorCode =
    | 'AUTH'
    | 'PLAN_REQUIRED'
    | 'QUOTA_EXCEEDED'
    | 'INVALID_VOICE'
    | 'BAD_REQUEST'
    | 'TIMEOUT'
    | 'NO_AUDIO'
    | 'NOT_CONFIGURED'
    | 'UNKNOWN';

export interface AudioDiagnosisSuccess {
    success: true;
    status: 'alive';
    provider: VoiceProvider;
    rtt_ms: number;
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
