import { GeminiProvider } from './gemini.provider';
import { ChatGptProvider } from './chatgpt.provider';
import { ClaudeProvider } from './claude.provider';
import type { PeticionConversacion } from '../interfaces/llm-provider.interface';

/**
 * `conversar`, la llamada del asistente de soporte del personal
 * (docs/PLAN_BOT_SOPORTE.md, Fase 2). Lo que se fija en los tres proveedores:
 *  · la parte fija del sistema (instrucciones y manual) va primero (caché);
 *  · los turnos conservan su lado;
 *  · se pide JSON cuando se pide;
 *  · vuelven el texto, el modelo y los tokens (con los de la caché);
 *  · un error del proveedor se lanza con su estado, para el respaldo.
 */
const PETICION: PeticionConversacion = {
  sistema: { fijo: 'INSTRUCCIONES + MANUAL', variable: 'QUIÉN + FICHA' },
  turnos: [
    { rol: 'usuario', texto: 'hola' },
    { rol: 'asistente', texto: '¿En qué te ayudo?' },
    { rol: 'usuario', texto: '¿cómo copio la agenda?' },
  ],
  json: true,
  maxTokens: 900,
  timeoutMs: 5_000,
};

describe('conversar', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const respuesta = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;
  const cuerpo = () =>
    JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<
      string,
      unknown
    >;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('Claude', () => {
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-sonnet-4-6' });

    it('marca la parte fija para la caché, conserva los turnos y suma los tokens de la caché', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, {
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'text', text: '{"tipo":' },
            { type: 'thinking', thinking: 'x' },
            { type: 'text', text: '"respuesta"}' },
          ],
          usage: {
            input_tokens: 50,
            output_tokens: 80,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 30_000,
          },
        }),
      );
      await expect(p.conversar(PETICION)).resolves.toEqual({
        texto: '{"tipo":"respuesta"}',
        modelo: 'claude-sonnet-4-6',
        tokensEntrada: 30_050,
        tokensSalida: 80,
        tokensCache: 30_000,
      });
      const b = cuerpo();
      expect(b.system).toEqual([
        {
          type: 'text',
          text: 'INSTRUCCIONES + MANUAL',
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: 'QUIÉN + FICHA' },
      ]);
      expect(b.messages).toEqual([
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: '¿En qué te ayudo?' },
        { role: 'user', content: '¿cómo copio la agenda?' },
      ]);
      expect(b.max_tokens).toBe(900);
      expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('sin usage ni modelo en la respuesta, nulos y el modelo configurado', async () => {
      fetchMock.mockResolvedValue(respuesta(200, { content: 'raro' }));
      await expect(
        p.conversar({ ...PETICION, maxTokens: undefined }),
      ).resolves.toEqual({
        texto: '',
        modelo: 'claude-sonnet-4-6',
        tokensEntrada: null,
        tokensSalida: null,
        tokensCache: null,
      });
      expect(cuerpo().max_tokens).toBe(1024);
    });

    it('un error lleva su estado', async () => {
      fetchMock.mockResolvedValue(respuesta(529, { error: 'overloaded' }));
      await expect(p.conversar(PETICION)).rejects.toMatchObject({
        status: 529,
        message: expect.stringContaining('Anthropic 529'),
      });
    });
  });

  describe('ChatGPT', () => {
    const p = new ChatGptProvider({
      apiKey: 'k',
      model: 'gpt-4o-mini',
      organizationId: 'org-openai',
    });

    it('sistema con la parte fija primero, JSON, tokens y caché', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, {
          model: 'gpt-4o-mini-2024',
          choices: [{ message: { content: '{"tipo":"saludo"}' } }],
          usage: {
            prompt_tokens: 31_000,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 30_720 },
          },
        }),
      );
      await expect(p.conversar(PETICION)).resolves.toEqual({
        texto: '{"tipo":"saludo"}',
        modelo: 'gpt-4o-mini-2024',
        tokensEntrada: 31_000,
        tokensSalida: 40,
        tokensCache: 30_720,
      });
      const b = cuerpo();
      expect(b.messages).toEqual([
        { role: 'system', content: 'INSTRUCCIONES + MANUAL\n\nQUIÉN + FICHA' },
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: '¿En qué te ayudo?' },
        { role: 'user', content: '¿cómo copio la agenda?' },
      ]);
      expect(b.response_format).toEqual({ type: 'json_object' });
      expect(b.max_tokens).toBe(900);
      expect(fetchMock.mock.calls[0][1].headers['OpenAI-Organization']).toBe(
        'org-openai',
      );
    });

    it('sin JSON ni tope, no los pide; sin usage, nulos', async () => {
      fetchMock.mockResolvedValue(respuesta(200, {}));
      await expect(
        p.conversar({ ...PETICION, json: false, maxTokens: undefined }),
      ).resolves.toEqual({
        texto: '',
        modelo: 'gpt-4o-mini',
        tokensEntrada: null,
        tokensSalida: null,
        tokensCache: null,
      });
      expect(cuerpo()).not.toHaveProperty('response_format');
      expect(cuerpo()).not.toHaveProperty('max_tokens');
    });

    it('un error lleva su estado', async () => {
      fetchMock.mockResolvedValue(respuesta(429, { error: 'quota' }));
      await expect(p.conversar(PETICION)).rejects.toMatchObject({
        status: 429,
      });
    });
  });

  describe('Gemini', () => {
    const build = () => {
      const p = new GeminiProvider({
        apiKey: 'k',
        model: 'gemini-2.5-flash',
      } as never);
      const generateContent = jest.fn(async () => ({
        response: {
          text: () => '{"tipo":"respuesta"}',
          usageMetadata: {
            promptTokenCount: 30_100,
            candidatesTokenCount: 70,
            cachedContentTokenCount: 29_000,
          },
        },
      }));
      const getGenerativeModel = jest.fn(() => ({ generateContent }));
      (p as unknown as { client: unknown }).client = { getGenerativeModel };
      return { p, generateContent, getGenerativeModel };
    };

    it('instrucciones de sistema con la parte fija primero, JSON, turnos user/model y tokens', async () => {
      const { p, generateContent, getGenerativeModel } = build();
      await expect(p.conversar(PETICION)).resolves.toEqual({
        texto: '{"tipo":"respuesta"}',
        modelo: 'gemini-2.5-flash',
        tokensEntrada: 30_100,
        tokensSalida: 70,
        tokensCache: 29_000,
      });
      expect(getGenerativeModel).toHaveBeenCalledWith(
        {
          model: 'gemini-2.5-flash',
          systemInstruction: 'INSTRUCCIONES + MANUAL\n\nQUIÉN + FICHA',
          generationConfig: { responseMimeType: 'application/json' },
        },
        { timeout: 5_000 },
      );
      expect(generateContent).toHaveBeenCalledWith({
        contents: [
          { role: 'user', parts: [{ text: 'hola' }] },
          { role: 'model', parts: [{ text: '¿En qué te ayudo?' }] },
          { role: 'user', parts: [{ text: '¿cómo copio la agenda?' }] },
        ],
      });
    });

    it('si el modelo configurado no está, responde el de respaldo y lo dice', async () => {
      const { p, generateContent } = build();
      generateContent.mockRejectedValueOnce(
        Object.assign(new Error('saturado'), { status: 503 }),
      );
      const r = await p.conversar({
        ...PETICION,
        json: false,
        timeoutMs: undefined,
      });
      expect(r.modelo).not.toBe('gemini-2.5-flash');
    });

    it('sin JSON no pide JSON; sin usage, nulos', async () => {
      const { p, generateContent, getGenerativeModel } = build();
      generateContent.mockResolvedValueOnce({
        response: { text: () => 'hola', usageMetadata: undefined },
      } as never);
      await expect(
        p.conversar({ ...PETICION, json: false }),
      ).resolves.toMatchObject({
        texto: 'hola',
        tokensEntrada: null,
        tokensSalida: null,
        tokensCache: null,
      });
      expect(getGenerativeModel.mock.calls[0][0]).not.toHaveProperty(
        'generationConfig',
      );
    });
  });
});
