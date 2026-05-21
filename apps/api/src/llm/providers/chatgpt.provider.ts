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

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const AUDIO_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export class ChatGptProvider implements LLMProvider {
  readonly name = 'CHATGPT' as const;
  private readonly logger = new Logger(ChatGptProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly orgHeader?: string;

  constructor(config: DecryptedAiConfig) {
    if (!config.apiKey) {
      throw new Error('ChatGPT: apiKey vacío en AiProviderConfig.');
    }
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.orgHeader = config.organizationId;
  }

  async generateClinicalRecord(audio: AudioInput): Promise<ClinicalRecordDraft> {
    // OpenAI no acepta audio nativo en chat.completions; primero transcribe.
    const transcript = await this.transcribe(audio);
    const json = await this.chat({
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CLINICAL_RECORD_PROMPT },
        { role: 'user', content: `Transcripción del médico:\n${transcript}` },
      ],
    });
    return JSON.parse(json) as ClinicalRecordDraft;
  }

  async extractSchedulingIntent(input: {
    text: string | null;
    audio?: AudioInput | null;
  }): Promise<SchedulingExtraction> {
    let userContent = '';
    if (input.text) userContent += `Texto del usuario: "${input.text}"\n`;
    if (input.audio) {
      const transcript = await this.transcribe(input.audio);
      userContent += `Transcripción del audio: "${transcript}"`;
    }

    const json = await this.chat({
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SCHEDULING_EXTRACTION_PROMPT },
        { role: 'user', content: userContent || '(sin contenido)' },
      ],
    });
    const parsed = JSON.parse(json);
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
    return this.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Pregunta: "${question}"` },
      ],
    });
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private async chat(body: Record<string, unknown>): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.orgHeader) headers['OpenAI-Organization'] = this.orgHeader;

    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, ...body }),
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`OpenAI ${res.status}: ${errText}`) as Error & {
        status: number;
      };
      err.status = res.status;
      throw err;
    }
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content ?? '';
  }

  private async transcribe(audio: AudioInput): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.orgHeader) headers['OpenAI-Organization'] = this.orgHeader;

    const form = new FormData();
    const blob = new Blob([Buffer.from(audio.base64, 'base64')], {
      type: audio.mimeType,
    });
    const ext = audio.mimeType.split('/')[1] || 'webm';
    form.append('file', blob, `dictation.${ext}`);
    form.append('model', 'whisper-1');

    const res = await fetch(AUDIO_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Whisper ${res.status}: ${errText}`);
    }
    const json: any = await res.json();
    return json?.text ?? '';
  }
}
