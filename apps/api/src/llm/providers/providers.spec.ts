import { GeminiProvider } from './gemini.provider';
import { ChatGptProvider } from './chatgpt.provider';
import { ClaudeProvider } from './claude.provider';

/**
 * Los tres proveedores de IA detrás del chatbot. El motor hace failover entre
 * ellos a mitad de una conversación, así que lo que importa aquí no es cómo
 * habla cada API sino que los tres **devuelvan exactamente la misma forma**:
 * si uno omite `isCancellation`, el paciente que pide cancelar con ese
 * proveedor activo se queda sin cancelar y nadie ve un error.
 *
 * También se fija el trato del audio: Gemini lo manda nativo, ChatGPT lo pasa
 * antes por Whisper, y Claude no lo soporta — que sea una limitación
 * documentada y no un fallo silencioso.
 */

const CAMPOS_EXTRACCION = [
  'transcript',
  'cedula',
  'nombre',
  'eps',
  'especialidad',
  'doctor',
  'fechaSolicitada',
  'intent',
  'isEscape',
  'outOfContext',
  'ininteligible',
  'isFallback',
  'isCancellation',
  'isModification',
  'isEmergency',
  'isRateLimited',
];

const RESPUESTA_LLM = JSON.stringify({
  transcript: 'quiero cancelar mi cita',
  cedula: '1088123456',
  nombre: 'Ana',
  eps: 'Sura',
  especialidad: 'Medicina General',
  doctor: null,
  fechaSolicitada: 'mañana',
  intent: 'agendar',
  isCancellation: true,
  isEmergency: false,
});

// ══════════════════════════════════════════════════════════════════════════
describe('GeminiProvider', () => {
  let generateContent: jest.Mock;

  const build = (config: Record<string, unknown> = { apiKey: 'k' }) => {
    const p = new GeminiProvider(config as never);
    generateContent = jest.fn(async () => ({
      response: { text: () => RESPUESTA_LLM },
    }));
    (p as unknown as { client: unknown }).client = {
      getGenerativeModel: jest.fn(() => ({ generateContent })),
    };
    jest.spyOn(p['logger'], 'warn').mockImplementation(() => undefined);
    return p;
  };

  it('sin apiKey no se construye: mejor fallar al crear que en el turno', () => {
    expect(() => new GeminiProvider({} as never)).toThrow(/apiKey/);
  });

  it('la extracción devuelve TODOS los campos del contrato', async () => {
    const r = await build().extractSchedulingIntent({ text: 'hola' });
    expect(Object.keys(r).sort()).toEqual([...CAMPOS_EXTRACCION].sort());
  });

  it('los booleanos ausentes salen en false, nunca en undefined', async () => {
    generateContent = jest.fn();
    const p = build();
    (p as unknown as { client: unknown }).client = {
      getGenerativeModel: () => ({
        generateContent: async () => ({ response: { text: () => '{}' } }),
      }),
    };

    const r = await p.extractSchedulingIntent({ text: 'hola' });
    expect(r.isEscape).toBe(false);
    expect(r.isCancellation).toBe(false);
    expect(r.isEmergency).toBe(false);
    expect(r.isFallback).toBe(false);
  });

  it('los bloques ```json de la respuesta se limpian antes de parsear', async () => {
    const p = build();
    (p as unknown as { client: unknown }).client = {
      getGenerativeModel: () => ({
        generateContent: async () => ({
          response: { text: () => '```json\n{"cedula":"123"}\n```' },
        }),
      }),
    };

    await expect(
      p.extractSchedulingIntent({ text: 'x' }),
    ).resolves.toMatchObject({ cedula: '123' });
  });

  it('con audio se ancla el idioma: sin eso transcribía en danés', async () => {
    const p = build();
    await p.extractSchedulingIntent({
      text: null,
      audio: { base64: 'AAA', mimeType: 'audio/ogg' },
    });

    const partes = generateContent.mock.calls[0][0] as unknown[];
    const textos = partes.filter((x) => typeof x === 'string').join('\n');
    expect(textos).toContain('ESPAÑOL');
    expect(textos).toContain('NUNCA traduzcas');
    expect(partes.some((x) => (x as { inlineData?: unknown }).inlineData)).toBe(
      true,
    );
  });

  it('el anclaje de vocabulario del tenant viaja en el prompt', async () => {
    const p = build();
    await p.extractSchedulingIntent({
      text: 'quiero con asura',
      vocabularyHints: { eps: ['Sura'] },
    });

    const partes = generateContent.mock.calls[0][0] as string[];
    expect(partes.join('\n')).toContain('Sura');
  });

  it('sin vocabulario no se agrega un bloque vacío al prompt', async () => {
    const p = build();
    await p.extractSchedulingIntent({ text: 'hola' });

    const partes = generateContent.mock.calls[0][0] as string[];
    expect(partes.every((x) => typeof x !== 'string' || x.trim())).toBe(true);
  });

  describe('failover de modelo', () => {
    const conFallos = (errores: unknown[]) => {
      const p = new GeminiProvider({
        apiKey: 'k',
        model: 'mi-modelo',
      } as never);
      jest.spyOn(p['logger'], 'warn').mockImplementation(() => undefined);
      let i = 0;
      const usados: string[] = [];
      (p as unknown as { client: unknown }).client = {
        getGenerativeModel: ({ model }: { model: string }) => {
          usados.push(model);
          return {
            generateContent: async () => {
              const e = errores[i++];
              if (e) throw Object.assign(new Error('fallo del modelo'), e);
              return { response: { text: () => '{}' } };
            },
          };
        },
      };
      return { p, usados };
    };

    it('un 503 del modelo configurado reintenta con el siguiente', async () => {
      const { p, usados } = conFallos([{ status: 503 }]);

      await p.answerFAQ('s', 'q');

      expect(usados[0]).toBe('mi-modelo');
      expect(usados[1]).toBe('gemini-2.0-flash');
    });

    it('un 404 (modelo retirado) también hace fallback', async () => {
      const { p, usados } = conFallos([{ status: 404 }]);
      await p.answerFAQ('s', 'q');
      expect(usados).toHaveLength(2);
    });

    it('🚫 un 429 (cuota) NO hace fallback: reintentar no arregla una cuota', async () => {
      const { p, usados } = conFallos([{ status: 429, message: 'quota' }]);

      await expect(p.answerFAQ('s', 'q')).rejects.toMatchObject({
        status: 429,
      });
      expect(usados).toHaveLength(1);
    });

    it('si TODOS los modelos están caídos, lanza el último error', async () => {
      const { p } = conFallos([
        { status: 503 },
        { status: 503 },
        { status: 503 },
        { status: 503, message: 'el último' },
      ]);

      await expect(p.answerFAQ('s', 'q')).rejects.toMatchObject({
        message: 'el último',
      });
    });

    it('el modelo configurado no se repite en la cadena de respaldo', async () => {
      const { p, usados } = conFallos([{ status: 503 }, { status: 503 }]);
      const provider = new GeminiProvider({
        apiKey: 'k',
        model: 'gemini-2.0-flash',
      } as never);
      void p;
      void usados;
      expect(
        (provider as unknown as { modelCandidates: string[] }).modelCandidates,
      ).toEqual([
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
      ]);
    });
  });

  describe('mapEntityToCatalog', () => {
    it('sin opciones o sin texto devuelve null sin llamar al modelo', async () => {
      const p = build();
      await expect(
        p.mapEntityToCatalog({
          text: 'x',
          options: [],
          entityKind: 'servicios',
        }),
      ).resolves.toEqual({ id: null });
      await expect(
        p.mapEntityToCatalog({
          text: '   ',
          options: [{ id: '1', name: 'A' }],
          entityKind: 'servicios',
        }),
      ).resolves.toEqual({ id: null });
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('el catálogo real viaja en el prompt y la respuesta se parsea', async () => {
      const p = build();
      (p as unknown as { client: unknown }).client = {
        getGenerativeModel: () => ({
          generateContent: async () => ({
            response: { text: () => '{"id":"svc-1"}' },
          }),
        }),
      };

      await expect(
        p.mapEntityToCatalog({
          text: 'consulta externa',
          options: [{ id: 'svc-1', name: 'Consulta Externa' }],
          entityKind: 'servicios',
        }),
      ).resolves.toEqual({ id: 'svc-1' });
    });
  });

  it('la historia clínica se pide con el audio nativo y responseMimeType JSON', async () => {
    const getGenerativeModel = jest.fn(() => ({
      generateContent: async () => ({
        response: { text: () => '{"chiefComplaint":"dolor"}' },
      }),
    }));
    const p = new GeminiProvider({ apiKey: 'k' } as never);
    (p as unknown as { client: unknown }).client = { getGenerativeModel };

    await expect(
      p.generateClinicalRecord({ base64: 'AAA', mimeType: 'audio/webm' }),
    ).resolves.toMatchObject({ chiefComplaint: 'dolor' });

    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: { responseMimeType: 'application/json' },
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('ChatGptProvider', () => {
  let fetchMock: jest.Mock;

  const respuestaChat = (contenido: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: contenido } }] }),
  });
  const respuestaWhisper = (texto: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ text: texto }),
  });

  const build = (config: Record<string, unknown> = { apiKey: 'sk-1' }) =>
    new ChatGptProvider(config as never);

  beforeEach(() => {
    fetchMock = jest.fn(async () => respuestaChat(RESPUESTA_LLM));
    global.fetch = fetchMock as never;
  });

  it('sin apiKey no se construye', () => {
    expect(() => new ChatGptProvider({} as never)).toThrow(/apiKey/);
  });

  it('la extracción devuelve la MISMA forma que Gemini', async () => {
    const r = await build().extractSchedulingIntent({ text: 'hola' });
    expect(Object.keys(r).sort()).toEqual([...CAMPOS_EXTRACCION].sort());
    expect(r.isCancellation).toBe(true);
  });

  it('pide JSON estricto: sin eso el modelo devuelve prosa', async () => {
    await build().extractSchedulingIntent({ text: 'hola' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('el modelo por defecto es el ligero, y el configurado manda', async () => {
    await build().answerFAQ('s', 'q');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      'gpt-4o-mini',
    );

    fetchMock.mockClear();
    await build({ apiKey: 'sk-1', model: 'gpt-4o' }).answerFAQ('s', 'q');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-4o');
  });

  it('la cabecera de organización de OpenAI solo va si está configurada', async () => {
    await build().answerFAQ('s', 'q');
    expect(
      fetchMock.mock.calls[0][1].headers['OpenAI-Organization'],
    ).toBeUndefined();

    fetchMock.mockClear();
    await build({ apiKey: 'sk-1', organizationId: 'org-openai' }).answerFAQ(
      's',
      'q',
    );
    expect(fetchMock.mock.calls[0][1].headers['OpenAI-Organization']).toBe(
      'org-openai',
    );
  });

  it('🎙️ el audio pasa ANTES por Whisper y su texto se adopta como transcript', async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaWhisper('quiero una cita'))
      .mockResolvedValueOnce(respuestaChat('{"cedula":"123"}'));

    const r = await build().extractSchedulingIntent({
      text: null,
      audio: { base64: 'AAA', mimeType: 'audio/ogg' },
    });

    expect(fetchMock.mock.calls[0][0]).toContain('/audio/transcriptions');
    expect(r.transcript).toBe('quiero una cita');
  });

  it('el vocabulario del tenant sesga a Whisper por su parámetro `prompt`', async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaWhisper('sura'))
      .mockResolvedValueOnce(respuestaChat('{}'));

    await build().extractSchedulingIntent({
      text: null,
      audio: { base64: 'AAA', mimeType: 'audio/ogg' },
      vocabularyHints: { eps: ['Sura'], letterOptions: ['a', 'b'] },
    });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    const prompt = form.get('prompt') as string;
    expect(prompt).toContain('Sura');
    expect(prompt).toContain('A, B');
    expect(form.get('model')).toBe('whisper-1');
  });

  it('sin vocabulario no se manda un prompt vacío a Whisper', async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaWhisper('hola'))
      .mockResolvedValueOnce(respuestaChat('{}'));

    await build().extractSchedulingIntent({
      text: null,
      audio: { base64: 'AAA', mimeType: 'audio/ogg' },
    });

    expect(
      (fetchMock.mock.calls[0][1].body as FormData).get('prompt'),
    ).toBeNull();
  });

  it('un error HTTP conserva el status para que el caller decida el failover', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limit',
    });

    await expect(build().answerFAQ('s', 'q')).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('OpenAI 429'),
    });
  });

  it('un error de Whisper dice que fue de Whisper, no del chat', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => 'audio demasiado grande',
    });

    await expect(
      build().extractSchedulingIntent({
        text: null,
        audio: { base64: 'AAA', mimeType: 'audio/ogg' },
      }),
    ).rejects.toThrow(/Whisper 413/);
  });

  it('una respuesta sin contenido devuelve cadena vacía, no undefined', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(build().answerFAQ('s', 'q')).resolves.toBe('');
  });

  it('mapEntityToCatalog corta en seco sin opciones', async () => {
    await expect(
      build().mapEntityToCatalog({ text: 'x', options: [], entityKind: 'e' }),
    ).resolves.toEqual({ id: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la historia clínica transcribe y luego pide el JSON estructurado', async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaWhisper('el paciente refiere dolor'))
      .mockResolvedValueOnce(respuestaChat('{"chiefComplaint":"dolor"}'));

    await expect(
      build().generateClinicalRecord({ base64: 'AAA', mimeType: 'audio/webm' }),
    ).resolves.toMatchObject({ chiefComplaint: 'dolor' });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.messages[1].content).toContain('el paciente refiere dolor');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('ClaudeProvider', () => {
  let fetchMock: jest.Mock;

  const respuesta = (texto: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: texto }] }),
  });

  const build = (config: Record<string, unknown> = { apiKey: 'sk-ant' }) => {
    const p = new ClaudeProvider(config as never);
    jest.spyOn(p['logger'], 'warn').mockImplementation(() => undefined);
    return p;
  };

  beforeEach(() => {
    fetchMock = jest.fn(async () => respuesta(RESPUESTA_LLM));
    global.fetch = fetchMock as never;
  });

  it('sin apiKey no se construye', () => {
    expect(() => new ClaudeProvider({} as never)).toThrow(/apiKey/);
  });

  it('la extracción devuelve la MISMA forma que los otros dos', async () => {
    const r = await build().extractSchedulingIntent({ text: 'hola' });
    expect(Object.keys(r).sort()).toEqual([...CAMPOS_EXTRACCION].sort());
  });

  it('manda la versión de la API y la key en las cabeceras que Anthropic exige', async () => {
    await build().answerFAQ('s', 'q');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('concatena todos los bloques de texto de la respuesta', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'parte 1 ' },
          { type: 'thinking', text: 'ignorar' },
          { type: 'text', text: 'parte 2' },
        ],
      }),
    });

    await expect(build().answerFAQ('s', 'q')).resolves.toBe('parte 1 parte 2');
  });

  it('una respuesta sin bloques devuelve cadena vacía', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(build().answerFAQ('s', 'q')).resolves.toBe('');
  });

  it('un error HTTP conserva el status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => 'overloaded',
    });

    await expect(build().answerFAQ('s', 'q')).rejects.toMatchObject({
      status: 529,
    });
  });

  it('📌 el audio NO se soporta: devuelve un borrador vacío y lo DICE en el log', async () => {
    // Es una limitación del proveedor, no un fallo: lo importante es que no
    // devuelva basura ni finja que transcribió algo.
    const p = build();
    const r = await p.generateClinicalRecord({
      base64: 'AAA',
      mimeType: 'audio/webm',
    });

    expect(r).toEqual({
      vitalSigns: null,
      chiefComplaint: null,
      currentIllness: null,
      physicalExam: null,
      evolutionNotes: null,
      diagnoses: [],
      prescriptions: [],
    });
    expect(p['logger'].warn).toHaveBeenCalledWith(
      expect.stringContaining('no soporta entrada de audio'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con audio en la extracción, se ignora el audio pero se sigue respondiendo', async () => {
    const r = await build().extractSchedulingIntent({
      text: null,
      audio: { base64: 'AAA', mimeType: 'audio/ogg' },
    });

    expect(r).toBeDefined();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe('(sin texto)');
  });

  it('el anclaje de vocabulario se agrega al system prompt', async () => {
    await build().extractSchedulingIntent({
      text: 'asura',
      vocabularyHints: { eps: ['Sura'] },
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).system).toContain(
      'Sura',
    );
  });

  it('mapEntityToCatalog corta en seco sin opciones o sin texto', async () => {
    const p = build();
    await expect(
      p.mapEntityToCatalog({ text: 'x', options: [], entityKind: 'e' }),
    ).resolves.toEqual({ id: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
