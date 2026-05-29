import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  AudioInput,
  ClinicalRecordDraft,
  DecryptedAiConfig,
  LLMProvider,
  SchedulingExtraction,
  CatalogOption,
  normalizeIntent,
} from '../interfaces/llm-provider.interface';
import {
  CLINICAL_RECORD_PROMPT,
  SCHEDULING_EXTRACTION_PROMPT,
  buildCatalogMappingPrompt,
  parseCatalogMappingResponse,
} from '../prompts/shared-prompts';

// Modelos de respaldo, ordenados por disponibilidad: cuando el modelo
// configurado por la organización devuelve 503 (saturado) o 404 (retirado),
// se reintenta con el siguiente. Se priorizan los más livianos/disponibles.
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

export class GeminiProvider implements LLMProvider {
  readonly name = 'GEMINI' as const;
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client: GoogleGenerativeAI;
  private readonly model: string;
  // Cadena de modelos a intentar: el configurado primero, luego los de respaldo.
  private readonly modelCandidates: string[];

  constructor(config: DecryptedAiConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini: apiKey vacío en AiProviderConfig.');
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-2.0-flash';
    this.modelCandidates = [
      this.model,
      ...FALLBACK_MODELS.filter((m) => m !== this.model),
    ];
  }

  // Ejecuta `fn` con el modelo configurado y, si el modelo no está disponible
  // (503 saturado / 404 retirado), reintenta con los modelos de respaldo. Otros
  // errores (429 cuota, 400, red...) se propagan tal cual para que el llamador
  // los maneje. Si TODOS los modelos fallan por indisponibilidad, lanza el último.
  private async withModelFallback<T>(
    fn: (model: string) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (const model of this.modelCandidates) {
      try {
        return await fn(model);
      } catch (e: any) {
        if (e?.status === 503 || e?.status === 404) {
          this.logger.warn(
            `Modelo ${model} no disponible (${e.status}) — probando siguiente`,
          );
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async generateClinicalRecord(audio: AudioInput): Promise<ClinicalRecordDraft> {
    const result = await this.withModelFallback((modelName) => {
      const model = this.client.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' },
      });
      return model.generateContent([
        CLINICAL_RECORD_PROMPT,
        { inlineData: { data: audio.base64, mimeType: audio.mimeType } },
      ]);
    });
    return JSON.parse(result.response.text()) as ClinicalRecordDraft;
  }

  async extractSchedulingIntent(input: {
    text: string | null;
    audio?: AudioInput | null;
  }): Promise<SchedulingExtraction> {
    const parts: any[] = [SCHEDULING_EXTRACTION_PROMPT];
    if (input.text) parts.push(`Texto del usuario: "${input.text}"`);
    if (input.audio) {
      parts.push({
        inlineData: { data: input.audio.base64, mimeType: input.audio.mimeType },
      });
    }

    const result = await this.withModelFallback((modelName) => {
      const model = this.client.getGenerativeModel({ model: modelName });
      return model.generateContent(parts);
    });
    const responseText = result.response
      .text()
      .trim()
      .replace(/```json/g, '')
      .replace(/```/g, '');
    const parsed = JSON.parse(responseText);
    return {
      transcript: parsed.transcript ?? input.text ?? null,
      cedula: parsed.cedula ?? null,
      nombre: parsed.nombre ?? null,
      eps: parsed.eps ?? null,
      especialidad: parsed.especialidad ?? null,
      doctor: parsed.doctor ?? null,
      fechaSolicitada: parsed.fechaSolicitada ?? null,
      intent: normalizeIntent(parsed.intent),
      isEscape: Boolean(parsed.isEscape),
      outOfContext: Boolean(parsed.outOfContext),
      ininteligible: Boolean(parsed.ininteligible),
      isFallback: false,
      isCancellation: Boolean(parsed.isCancellation),
      isModification: Boolean(parsed.isModification),
      isRateLimited: false,
    };
  }

  async answerFAQ(systemPrompt: string, question: string): Promise<string> {
    const result = await this.withModelFallback((modelName) => {
      const model = this.client.getGenerativeModel({ model: modelName });
      return model.generateContent([systemPrompt, `Pregunta: "${question}"`]);
    });
    return result.response.text().trim();
  }

  async mapEntityToCatalog(input: {
    text: string;
    options: CatalogOption[];
    entityKind: string;
  }): Promise<{ id: string | null }> {
    if (!input.options?.length || !input.text?.trim()) return { id: null };
    const result = await this.withModelFallback((modelName) => {
      const model = this.client.getGenerativeModel({ model: modelName });
      return model.generateContent([
        buildCatalogMappingPrompt(input.entityKind, input.options),
        `Texto del paciente: "${input.text}"`,
      ]);
    });
    return parseCatalogMappingResponse(result.response.text());
  }
}
