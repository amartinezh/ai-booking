import { LlmProvider } from '@agenia/database';

/**
 * Payload de entrada para `POST /ai-config`.
 * Se mantiene como interface pura (sin decoradores) para que TypeScript
 * con `emitDecoratorMetadata` + `isolatedModules` no pierda metadata
 * cuando se referencia desde un decorador @Body().
 */
export interface SaveAiConfigInput {
  activeProvider: LlmProvider;
  apiKey?: string;
  model?: string;
  openaiOrganizationId?: string;
}

/**
 * Vista "segura" devuelta al frontend: NUNCA expone el apiKey en claro.
 * Solo `hasApiKey` (boolean) y los últimos 4 caracteres para UX.
 */
export interface PublicAiConfig {
  activeProvider: LlmProvider;
  model: string | null;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  openaiOrganizationId: string | null;
  updatedAt: Date | null;
}
