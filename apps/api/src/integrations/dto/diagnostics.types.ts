/**
 * Tipos de respuesta de los diagnósticos de conectividad de integraciones.
 *
 * Estas formas son el contrato JSON que consume el panel "Salud de la Conexión"
 * del frontend (apps/web/app/actions/integrations.types.ts mantiene una copia
 * espejo). Se modelan como uniones discriminadas por `success` para que el
 * cliente pueda hacer narrowing sin ambigüedad.
 */

/** Códigos de error normalizados que el frontend usa para decidir el copy. */
export type DiagnosticErrorCode =
  | 'NO_PROVIDER' // la clínica no tiene proveedor LLM activo
  | 'NOT_CONFIGURED' // faltan credenciales de WhatsApp/Meta
  | 'INACTIVE' // canal configurado pero marcado como inactivo
  | 'TIMEOUT' // el proveedor no respondió a tiempo
  | 'AUTH' // token inválido / expirado (Meta code 190, Gemini 401/403)
  | 'BAD_REQUEST' // petición rechazada por el proveedor
  | 'INVALID_TOKEN_FORMAT' // el token traía caracteres ilegales para la cabecera
  | 'UNKNOWN'; // cualquier otro fallo no clasificado

export interface GeminiDiagnosisSuccess {
  success: true;
  status: 'alive';
  /** Latencia round-trip exacta a la API de Google, en milisegundos. */
  rtt_ms: number;
  /** Texto crudo devuelto por el modelo (idealmente "ok"). */
  model_response: string;
  model?: string;
}

export interface DiagnosisError {
  success: false;
  error_code: DiagnosticErrorCode;
  error_message: string;
  /** RTT hasta el momento del fallo, cuando aplica (p.ej. timeouts). */
  rtt_ms?: number;
}

export type GeminiDiagnosisResult = GeminiDiagnosisSuccess | DiagnosisError;

/**
 * Resultado del diagnóstico genérico del proveedor de IA activo
 * (GEMINI | CHATGPT | CLAUDE). A diferencia de GeminiDiagnosisSuccess,
 * incluye explícitamente el `provider` y el `model` configurados para
 * que la UI pueda mostrar qué servicio se probó realmente.
 */
export interface LlmDiagnosisSuccess {
  success: true;
  status: 'alive';
  provider: 'GEMINI' | 'CHATGPT' | 'CLAUDE';
  /** Modelo configurado en la organización (ej. gemini-2.5-flash). */
  model: string;
  /** Latencia round-trip a la API del proveedor, en ms. */
  rtt_ms: number;
  /** Texto crudo devuelto (idealmente "ok"). */
  model_response: string;
}

export interface LlmDiagnosisErrorEx extends DiagnosisError {
  /** Cuando aplica, también devolvemos qué proveedor/modelo se intentó. */
  provider?: 'GEMINI' | 'CHATGPT' | 'CLAUDE';
  model?: string;
}

export type LlmDiagnosisResult = LlmDiagnosisSuccess | LlmDiagnosisErrorEx;

export interface MetaDiagnosisSuccess {
  success: true;
  status: 'verified';
  phone_id: string;
  display_number: string | null;
  verified_name?: string | null;
  rtt_ms: number;
}

export type MetaDiagnosisResult = MetaDiagnosisSuccess | DiagnosisError;
