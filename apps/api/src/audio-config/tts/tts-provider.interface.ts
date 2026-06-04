import { AudioEncoding, VoiceProvider } from '@agenia/database';
import { AudioDiagnosisErrorCode } from '../dto/audio-config.types';

/**
 * Contrato común (patrón Strategy) de los proveedores de Text-to-Speech.
 *
 * `TtsFactoryService` resuelve la configuración dinámica por organización y
 * decide qué estrategia ejecutar; cada proveedor es STATELESS respecto al
 * tenant: recibe sus parámetros/credenciales por argumento (nunca lee la BD ni
 * el `.env`), de modo que la misma instancia singleton sirve a todas las
 * clínicas sin riesgo de cross-tenant leak.
 *
 * Implementaciones:
 *  - `GoogleTtsService`     — Google Cloud TTS (Plan B siempre disponible).
 *  - `ElevenLabsTtsService` — ElevenLabs (Studio Quality).
 */

/** Proveedores de TTS reconocidos (alineado con el enum Prisma `VoiceProvider`). */
export type TtsProviderName = VoiceProvider;

/** Parámetros de síntesis de Google Cloud TTS (resueltos por organización). */
export interface GoogleTtsParams {
  voiceId: string;
  pitch: number;
  speakingRate: number;
  audioEncoding: AudioEncoding;
  languageCode: string;
}

/** Credenciales/voz de ElevenLabs (resueltas por organización, ya desencriptadas). */
export interface ElevenLabsTtsParams {
  apiKey: string;
  voiceId: string;
}

/**
 * Resultado estructurado de una síntesis. Discriminado por `ok` para que tanto
 * el camino de producción (factory → Buffer | null + fallback) como el de
 * diagnóstico (botón "Alive" → códigos + latencia) compartan la misma lógica.
 */
export type TtsResult =
  | { ok: true; audio: Buffer; bytes: number; rtt_ms: number }
  | {
      ok: false;
      code: AudioDiagnosisErrorCode;
      message: string;
      rtt_ms: number;
    };

/** Estrategia de síntesis de voz, parametrizada por su tipo de credenciales. */
export interface TtsProvider<P> {
  /** Identifica al proveedor — usado para logs, telemetría y fallback. */
  readonly name: TtsProviderName;

  /**
   * Sintetiza `text` con los `params` dados y devuelve un audio **OGG/Opus**
   * (compatible con la subida a WhatsApp) o un error clasificado. Nunca lanza:
   * cualquier fallo se mapea a `{ ok: false, code, message }`.
   */
  generate(text: string, params: P): Promise<TtsResult>;
}
