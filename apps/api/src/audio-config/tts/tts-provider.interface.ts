/**
 * Contrato común (patrón Strategy) para todos los proveedores de Text-to-Speech
 * soportados por el "Gestor de Audios" del chatbot.
 *
 * `TtsFactoryService` resuelve la implementación correcta a partir del feature
 * flag `ACTIVE_TTS_PROVIDER` y devuelve una instancia que respeta este contrato.
 *
 * Implementaciones actuales:
 *  - `GoogleTtsService`     — producción multi-tenant (config por organización).
 *  - `ElevenLabsTtsService` — Prueba de Concepto (voz "Studio Quality" hardcoded).
 */

/** Proveedores de TTS reconocidos por la plataforma. */
export type TtsProviderName = 'GOOGLE' | 'ELEVENLABS';

/** Proveedor por defecto: producción. Cualquier valor inválido cae aquí. */
export const DEFAULT_TTS_PROVIDER: TtsProviderName = 'GOOGLE';

/**
 * Normaliza el valor del flag `ACTIVE_TTS_PROVIDER` a un proveedor válido.
 * Fail-safe: cualquier valor desconocido/ausente cae en `'GOOGLE'` (producción),
 * de modo que una variable mal escrita nunca activa accidentalmente la PoC.
 */
export function normalizeTtsProvider(value: unknown): TtsProviderName {
  return String(value ?? '').trim().toUpperCase() === 'ELEVENLABS'
    ? 'ELEVENLABS'
    : 'GOOGLE';
}

/** Entrada de síntesis. El texto llega ya saneado (sin markdown ni emojis). */
export interface TtsSynthesisInput {
  /** Organización dueña de la conversación (Google la usa para resolver voz/pitch). */
  organizationId: string;
  /** Texto limpio listo para sintetizar. */
  text: string;
}

/**
 * Estrategia de síntesis de voz. Cada proveedor decide internamente de dónde
 * saca su configuración (Google: `OrganizationAudioConfig`; ElevenLabs: env PoC).
 */
export interface TtsProvider {
  /** Identifica al proveedor — útil para logs, telemetría y decisiones de fallback. */
  readonly name: TtsProviderName;

  /**
   * Sintetiza `text` y devuelve un `Buffer` de audio **OGG/Opus** listo para
   * subir a WhatsApp como nota de voz, o `null` si la síntesis falla (en cuyo
   * caso el proveedor ya dejó registrado el detalle técnico del error).
   */
  synthesize(input: TtsSynthesisInput): Promise<Buffer | null>;
}
