import { Logger } from '@nestjs/common';
import {
  AudioInput,
  ClinicalRecordDraft,
  DecryptedAiConfig,
  LLMProvider,
  SchedulingExtraction,
  CatalogOption,
  VocabularyHints,
  normalizeIntent,
} from '../interfaces/llm-provider.interface';
import {
  CLINICAL_RECORD_PROMPT,
  SCHEDULING_EXTRACTION_PROMPT,
  buildCatalogMappingPrompt,
  buildVocabularyAnchor,
  parseCatalogMappingResponse,
} from '../prompts/shared-prompts';

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const AUDIO_TRANSCRIPTIONS_URL =
  'https://api.openai.com/v1/audio/transcriptions';

/**
 * Construye el `prompt` para Whisper (anclaje de vocabulario). Whisper acepta
 * un prompt corto que sesga la transcripción hacia el vocabulario provisto.
 * Devuelve string vacío cuando no hay vocabulario.
 */
function buildWhisperBiasingPrompt(hints?: VocabularyHints): string {
  const eps = (hints?.eps ?? []).filter((s) => s && s.trim());
  const services = (hints?.services ?? []).filter((s) => s && s.trim());
  const letters = (hints?.letterOptions ?? [])
    .filter((s) => s && s.trim())
    .map((s) => s.trim().toUpperCase());
  if (eps.length === 0 && services.length === 0 && letters.length === 0)
    return '';
  const segs: string[] = [];
  if (letters.length > 0)
    segs.push(`Selección por letra: ${letters.join(', ')}.`);
  if (eps.length > 0) segs.push(`EPS: ${eps.join(', ')}.`);
  if (services.length > 0) segs.push(`Servicios: ${services.join(', ')}.`);
  return `Vocabulario de la clínica (en español, Colombia). ${segs.join(' ')}`;
}

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

  async generateClinicalRecord(
    audio: AudioInput,
  ): Promise<ClinicalRecordDraft> {
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
    vocabularyHints?: VocabularyHints;
  }): Promise<SchedulingExtraction> {
    let userContent = '';
    // Transcripción literal: la de Whisper si fue audio, o el propio texto.
    // Es la señal que permite que la voz recorra el mismo camino determinista
    // que el texto en los pasos de menú (ver SchedulingExtraction.transcript).
    let transcript: string | null = input.text ?? null;
    if (input.text) userContent += `Texto del usuario: "${input.text}"\n`;
    if (input.audio) {
      // Anclaje de vocabulario también para Whisper (Capa 1): el parámetro
      // `prompt` sesga la transcripción hacia el vocabulario del catálogo del
      // tenant. Reduce "Sura"→"Assura" en origen, antes de la extracción.
      transcript = await this.transcribe(input.audio, input.vocabularyHints);
      userContent += `Transcripción del audio: "${transcript}"`;
    }

    // Anclaje de vocabulario en el mensaje system del chat completion: aunque
    // Whisper ya transcribió, la extracción de `eps`/`especialidad` necesita
    // saber qué nombres son válidos para mapear typos/variantes.
    const vocabAnchor = buildVocabularyAnchor(input.vocabularyHints);
    const systemContent = vocabAnchor
      ? `${SCHEDULING_EXTRACTION_PROMPT}\n\n${vocabAnchor}`
      : SCHEDULING_EXTRACTION_PROMPT;

    const json = await this.chat({
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent || '(sin contenido)' },
      ],
    });
    const parsed = JSON.parse(json);
    return {
      transcript: transcript ?? parsed.transcript ?? null,
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
    return this.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Pregunta: "${question}"` },
      ],
    });
  }

  async mapEntityToCatalog(input: {
    text: string;
    options: CatalogOption[];
    entityKind: string;
  }): Promise<{ id: string | null }> {
    if (!input.options?.length || !input.text?.trim()) return { id: null };
    const raw = await this.chat({
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildCatalogMappingPrompt(input.entityKind, input.options),
        },
        { role: 'user', content: `Texto del paciente: "${input.text}"` },
      ],
    });
    return parseCatalogMappingResponse(raw);
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

  private async transcribe(
    audio: AudioInput,
    vocabularyHints?: VocabularyHints,
  ): Promise<string> {
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

    // Whisper acepta un `prompt` (hasta ~224 tokens) que sesga la transcripción
    // hacia el vocabulario indicado. Lo construimos a partir del catálogo del
    // tenant cuando el caller lo provee (audio de chatbot en pasos de menú).
    const whisperPrompt = buildWhisperBiasingPrompt(vocabularyHints);
    if (whisperPrompt) form.append('prompt', whisperPrompt);

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
