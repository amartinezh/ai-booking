// Espejo de los tipos de respuesta del backend
// (apps/api/src/integrations/dto/diagnostics.types.ts).
// Se mantienen como tipos puros para poder importarlos desde Client Components.

export type DiagnosticErrorCode =
    | 'NO_PROVIDER'
    | 'NOT_CONFIGURED'
    | 'INACTIVE'
    | 'TIMEOUT'
    | 'AUTH'
    | 'BAD_REQUEST'
    | 'INVALID_TOKEN_FORMAT'
    | 'UNKNOWN';

export interface GeminiDiagnosisSuccess {
    success: true;
    status: 'alive';
    rtt_ms: number;
    model_response: string;
    model?: string;
}

export interface DiagnosisError {
    success: false;
    error_code: DiagnosticErrorCode;
    error_message: string;
    rtt_ms?: number;
}

export type GeminiDiagnosisResult = GeminiDiagnosisSuccess | DiagnosisError;

/**
 * Resultado del diagnóstico genérico del proveedor de IA activo.
 * Incluye explícitamente `provider` y `model` para que la UI muestre
 * qué servicio se probó (Gemini / OpenAI / Claude).
 */
export interface LlmDiagnosisSuccess {
    success: true;
    status: 'alive';
    provider: 'GEMINI' | 'CHATGPT' | 'CLAUDE';
    model: string;
    rtt_ms: number;
    model_response: string;
}

export interface LlmDiagnosisErrorEx extends DiagnosisError {
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
