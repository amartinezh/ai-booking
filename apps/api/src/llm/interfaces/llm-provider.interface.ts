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

/** Opción de catálogo (servicio o EPS) que se ofrece al LLM para mapear. */
export interface CatalogOption {
  id: string;
  name: string;
}

/**
 * Intención principal detectada por el LLM en un turno conversacional.
 * - `agendar_cita`   → el paciente quiere reservar/gestionar una cita.
 * - `consulta_faq`   → duda general (horarios, servicios, ubicación, etc.).
 * - `insulto_abuso`  → lenguaje ofensivo/abusivo → guardrail.
 * - `otro`           → no clasificable / fallback (se trata como agendamiento).
 */
export type SchedulingIntent =
  | 'agendar_cita'
  | 'consulta_faq'
  | 'insulto_abuso'
  | 'otro';

/**
 * Normaliza el valor `intent` recibido del LLM a uno de los valores válidos.
 * Fail-open: cualquier valor desconocido/ausente cae en `'otro'`, que el
 * orquestador trata como agendamiento (no bloquea al paciente).
 */
export function normalizeIntent(value: unknown): SchedulingIntent {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'agendar_cita' || v === 'consulta_faq' || v === 'insulto_abuso') {
    return v;
  }
  return 'otro';
}

export interface SchedulingExtraction {
  cedula: string | null;
  nombre: string | null;
  eps: string | null;
  especialidad: string | null;
  doctor: string | null;
  /**
   * Fecha/franja solicitada en lenguaje natural (ej: "mañana", "el lunes",
   * "2026-05-25"). Es una PISTA: el agendamiento sigue ofreciendo cupos reales.
   * `null` si el paciente no menciona ninguna preferencia temporal.
   */
  fechaSolicitada: string | null;
  /** Clasificación de intención principal del turno (Tarea C). */
  intent: SchedulingIntent;
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

  /**
   * Mapeo semántico: dada la frase del paciente y el catálogo real de la
   * clínica (servicios o EPS), devuelve el `id` de la opción que coincide
   * semánticamente, o `null` si es ambiguo / no coincide (evita falsos
   * positivos). El llamador DEBE validar que el `id` pertenezca al catálogo.
   */
  mapEntityToCatalog(input: {
    text: string;
    options: CatalogOption[];
    /** Etiqueta para el prompt, p.ej. "servicio médico" o "EPS o aseguradora". */
    entityKind: string;
  }): Promise<{ id: string | null }>;
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
