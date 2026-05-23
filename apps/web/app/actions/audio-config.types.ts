// Espejo de apps/api/src/audio-config/dto/audio-config.types.ts
// Mantener sincronizado con el backend.

export type AudioEncoding = 'OGG_OPUS' | 'MP3' | 'LINEAR16';

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
    audioEncoding: AudioEncoding;
    pitch: number;
    speakingRate: number;
    voiceId: string;
    allowedVoices: VoiceOption[];
    limits: AudioConfigLimits;
    updatedAt: string | null;
}

export interface SaveAudioConfigInput {
    audioEncoding?: AudioEncoding;
    pitch?: number;
    speakingRate?: number;
    voiceId?: string;
}

export type AudioDiagnosisErrorCode =
    | 'AUTH'
    | 'INVALID_VOICE'
    | 'BAD_REQUEST'
    | 'TIMEOUT'
    | 'NO_AUDIO'
    | 'UNKNOWN';

export interface AudioDiagnosisSuccess {
    success: true;
    status: 'alive';
    rtt_ms: number;
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
