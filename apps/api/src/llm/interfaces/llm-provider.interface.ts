/**
 * Contrato común para todos los proveedores de LLM soportados por la plataforma.
 *
 * El `LlmFactoryService` resuelve la implementación correcta por `organizationId`
 * (Gemini, ChatGPT, Claude) y devuelve una instancia que respeta este contrato.
 *
 * Cada método es el mínimo necesario para los flujos de Antigravity:
 *  - `generateClinicalRecord` — usado por ClinicalAiService (dictado médico).
 *  - `extractSchedulingIntent` — usado por ChatbotService (NLU sobre WhatsApp).
 *  - `answerFAQ` — usado por ChatbotService (RAG con base de conocimiento).
 *  - `getAvailableServices` — usado por el panel de "Integración de IA" para
 *    listar los modelos válidos por proveedor.
 */

export interface AudioInput {
  base64: string;
  mimeType: string;
}

export interface SchedulingExtraction {
  cedula: string | null;
  nombre: string | null;
  eps: string | null;
  especialidad: string | null;
  doctor: string | null;
  isEscape: boolean;
  outOfContext: boolean;
  ininteligible: boolean;
  isFallback: boolean;
  isCancellation: boolean;
  isRateLimited: boolean;
}

export interface ClinicalRecordDraft {
  vitalSigns: {
    bloodPressure: string | null;
    heartRate: number | null;
    temperature: number | null;
    oxygenSat: number | null;
    weight: number | null;
    height: number | null;
  } | null;
  chiefComplaint: string | null;
  currentIllness: string | null;
  physicalExam: string | null;
  evolutionNotes: string | null;
  diagnoses: Array<{ description: string; isMain: boolean }>;
  prescriptions: Array<{
    medication: string;
    dose: string;
    frequency: string;
    duration: string;
    notes: string;
  }>;
}

export interface LLMProvider {
  /** Identifica al proveedor — útil para logs y telemetría. */
  readonly name: 'GEMINI' | 'CHATGPT' | 'CLAUDE';

  /**
   * Procesa audio médico dictado y devuelve la estructura completa de la HCE.
   */
  generateClinicalRecord(audio: AudioInput): Promise<ClinicalRecordDraft>;

  /**
   * Extrae intent + entidades de un mensaje de WhatsApp (texto y/o audio).
   * Devuelve la estructura que el ChatbotService usa para enrutar la conversación.
   */
  extractSchedulingIntent(input: {
    text: string | null;
    audio?: AudioInput | null;
  }): Promise<SchedulingExtraction>;

  /**
   * Responde una pregunta FAQ usando un system prompt + base de conocimiento.
   * El llamador arma el prompt; el provider solo lo ejecuta.
   */
  answerFAQ(systemPrompt: string, question: string): Promise<string>;
}

/**
 * Catálogo público de modelos válidos por proveedor.
 * Usado por la UI para poblar el `<select>` de modelo.
 */
export const PROVIDER_MODELS = {
  GEMINI: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash'],
  CHATGPT: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  CLAUDE: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'],
} as const;

/** Forma decodificada (en claro) de `AiProviderConfig.encryptedApiConfig`. */
export interface DecryptedAiConfig {
  apiKey: string;
  model: string;
  // Específico de OpenAI; opcional para los demás.
  organizationId?: string;
}
