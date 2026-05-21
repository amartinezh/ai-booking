import { Logger } from '@nestjs/common';
import {
  AudioInput,
  ClinicalRecordDraft,
  DecryptedAiConfig,
  LLMProvider,
  SchedulingExtraction,
  normalizeIntent,
} from '../interfaces/llm-provider.interface';
import {
  CLINICAL_RECORD_PROMPT,
  SCHEDULING_EXTRACTION_PROMPT,
} from '../prompts/shared-prompts';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'CLAUDE' as const;
  private readonly logger = new Logger(ClaudeProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: DecryptedAiConfig) {
    if (!config.apiKey) {
      throw new Error('Claude: apiKey vacío en AiProviderConfig.');
    }
    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-sonnet-4-6';
  }

  async generateClinicalRecord(audio: AudioInput): Promise<ClinicalRecordDraft> {
    // La Messages API de Anthropic no acepta audio nativo. Se documenta como
    // limitación del proveedor: para dictado se recomienda Gemini o ChatGPT.
    // Mantenemos el contrato y devolvemos una estructura vacía con un log claro.
    this.logger.warn(
      'Claude no soporta entrada de audio nativa para dictado clínico. ' +
        'Usa Gemini o ChatGPT para esta función. Devolviendo borrador vacío.',
    );
    void audio;
    return {
      vitalSigns: null,
      chiefComplaint: null,
      currentIllness: null,
      physicalExam: null,
      evolutionNotes: null,
      diagnoses: [],
      prescriptions: [],
    };
  }

  async extractSchedulingIntent(input: {
    text: string | null;
    audio?: AudioInput | null;
  }): Promise<SchedulingExtraction> {
    // Audio no soportado en Claude vía Messages API; ignoramos audio.
    const userText = input.text
      ? `Texto del usuario: "${input.text}"`
      : '(sin texto)';

    const raw = await this.message({
      system: SCHEDULING_EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: userText }],
      max_tokens: 512,
    });
    const cleaned = raw.trim().replace(/```json/g, '').replace(/```/g, '');
    const parsed = JSON.parse(cleaned);
    return {
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
      isRateLimited: false,
    };
  }

  async answerFAQ(systemPrompt: string, question: string): Promise<string> {
    const text = await this.message({
      system: systemPrompt,
      messages: [{ role: 'user', content: `Pregunta: "${question}"` }],
      max_tokens: 1024,
    });
    return text.trim();
  }

  // ── HTTP helper ───────────────────────────────────────────────────────────

  private async message(body: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    max_tokens: number;
  }): Promise<string> {
    const res = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, ...body }),
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Anthropic ${res.status}: ${errText}`) as Error & {
        status: number;
      };
      err.status = res.status;
      throw err;
    }
    const json: any = await res.json();
    // content es un array de bloques { type: "text", text: "..." }
    const parts = Array.isArray(json?.content) ? json.content : [];
    return parts
      .filter((p: any) => p?.type === 'text')
      .map((p: any) => p.text)
      .join('');
  }
}
