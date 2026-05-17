// Módulo "cliente-safe": tipos y constantes que pueden compartirse entre
// server actions y componentes del cliente. NO lleva `'use server'`, porque
// en Next.js 16 los archivos `'use server'` solo pueden exportar funciones async.

export type LlmProvider = 'GEMINI' | 'CHATGPT' | 'CLAUDE' | 'NONE';

export interface PublicAiConfig {
    activeProvider: LlmProvider;
    model: string | null;
    hasApiKey: boolean;
    apiKeyLast4: string | null;
    openaiOrganizationId: string | null;
    updatedAt: string | null;
}

export interface SaveAiConfigInput {
    activeProvider: LlmProvider;
    apiKey?: string;
    model?: string;
    openaiOrganizationId?: string;
}

/**
 * Catálogo público (estático) de modelos por proveedor. Idéntico al expuesto
 * por el backend `/ai-config/catalog`, replicado aquí para evitar un round-trip
 * extra al renderizar la página.
 */
export const PROVIDER_MODELS: Record<Exclude<LlmProvider, 'NONE'>, string[]> = {
    GEMINI: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash'],
    CHATGPT: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    CLAUDE: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'],
};
