import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  AudioInput,
  ClinicalRecordDraft,
  DecryptedAiConfig,
  LLMProvider,
  SchedulingExtraction,
} from '../interfaces/llm-provider.interface';
import {
  CLINICAL_RECORD_PROMPT,
  SCHEDULING_EXTRACTION_PROMPT,
} from '../prompts/shared-prompts';

export class GeminiProvider implements LLMProvider {
  readonly name = 'GEMINI' as const;
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client: GoogleGenerativeAI;
  private readonly model: string;

  constructor(config: DecryptedAiConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini: apiKey vacío en AiProviderConfig.');
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-2.5-flash';
  }

  async generateClinicalRecord(audio: AudioInput): Promise<ClinicalRecordDraft> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: { responseMimeType: 'application/json' },
    });

    const result = await model.generateContent([
      CLINICAL_RECORD_PROMPT,
      { inlineData: { data: audio.base64, mimeType: audio.mimeType } },
    ]);
    return JSON.parse(result.response.text()) as ClinicalRecordDraft;
  }

  async extractSchedulingIntent(input: {
    text: string | null;
    audio?: AudioInput | null;
  }): Promise<SchedulingExtraction> {
    const model = this.client.getGenerativeModel({ model: this.model });

    const parts: any[] = [SCHEDULING_EXTRACTION_PROMPT];
    if (input.text) parts.push(`Texto del usuario: "${input.text}"`);
    if (input.audio) {
      parts.push({
        inlineData: { data: input.audio.base64, mimeType: input.audio.mimeType },
      });
    }

    const result = await model.generateContent(parts);
    const responseText = result.response
      .text()
      .trim()
      .replace(/```json/g, '')
      .replace(/```/g, '');
    const parsed = JSON.parse(responseText);
    return {
      cedula: parsed.cedula ?? null,
      nombre: parsed.nombre ?? null,
      eps: parsed.eps ?? null,
      especialidad: parsed.especialidad ?? null,
      doctor: parsed.doctor ?? null,
      isEscape: Boolean(parsed.isEscape),
      outOfContext: Boolean(parsed.outOfContext),
      ininteligible: Boolean(parsed.ininteligible),
      isFallback: false,
      isCancellation: Boolean(parsed.isCancellation),
      isRateLimited: false,
    };
  }

  async answerFAQ(systemPrompt: string, question: string): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const result = await model.generateContent([
      systemPrompt,
      `Pregunta: "${question}"`,
    ]);
    return result.response.text().trim();
  }
}
