import { GoogleTtsService } from './google-tts.service';
import { ElevenLabsTtsService } from './elevenlabs-tts.service';
import type { TtsResult } from './tts-provider.interface';

/**
 * Los dos proveedores de voz, en su frontera con el mundo exterior.
 *
 * Ninguno puede lanzar: el contrato `TtsResult` obliga a devolver
 * `{ok:false, code}` siempre, porque quien los llama (el chatbot, a mitad de
 * una conversación con un paciente) usa ese código para decidir si cae al Plan
 * B o manda solo texto. Una excepción escapada ahí deja al paciente sin
 * respuesta.
 */
describe('GoogleTtsService', () => {
  let service: GoogleTtsService;
  let synthesizeSpeech: jest.Mock;

  const PARAMS = {
    languageCode: 'es-US',
    voiceId: 'es-US-Neural2-A',
    audioEncoding: 'OGG_OPUS',
    pitch: 0,
    speakingRate: 1,
  } as never;

  beforeEach(() => {
    service = new GoogleTtsService();
    synthesizeSpeech = jest.fn(async () => [
      { audioContent: new Uint8Array([1, 2, 3]) },
    ]);
    (service as unknown as { ttsClient: unknown }).ttsClient = {
      synthesizeSpeech,
    };
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('devuelve el audio con su tamaño y su latencia', async () => {
    const r = await service.generate('hola', PARAMS);

    expect(r).toMatchObject({ ok: true, bytes: 3 });
    expect((r as { audio: Buffer }).audio).toEqual(Buffer.from([1, 2, 3]));
    expect(r.rtt_ms).toBeGreaterThanOrEqual(0);
  });

  it('los parámetros de la clínica viajan tal cual a Google', async () => {
    await service.generate('hola', PARAMS);

    expect(synthesizeSpeech).toHaveBeenCalledWith({
      input: { text: 'hola' },
      voice: { languageCode: 'es-US', name: 'es-US-Neural2-A' },
      audioConfig: {
        audioEncoding: 'OGG_OPUS',
        pitch: 0,
        speakingRate: 1,
      },
    });
  });

  it('una respuesta 200 sin audio se reporta como NO_AUDIO, no como éxito', async () => {
    synthesizeSpeech.mockResolvedValue([{ audioContent: null }]);

    await expect(service.generate('hola', PARAMS)).resolves.toMatchObject({
      ok: false,
      code: 'NO_AUDIO',
    });
  });

  describe('clasificación de errores', () => {
    const conError = (error: unknown) => {
      synthesizeSpeech.mockRejectedValue(error);
      return service.generate('hola', PARAMS);
    };

    it.each([
      ['deadline exceeded', 'TIMEOUT'],
      ['request timeout', 'TIMEOUT'],
      ['PERMISSION_DENIED', 'AUTH'],
      ['could not load credentials', 'AUTH'],
      ['UNAUTHENTICATED', 'AUTH'],
      ['403 forbidden', 'AUTH'],
      ['voice not found', 'INVALID_VOICE'],
      ['the voice does not exist', 'INVALID_VOICE'],
      ['invalid pitch', 'BAD_REQUEST'],
      ['400 bad request', 'BAD_REQUEST'],
      ['el planeta explotó', 'UNKNOWN'],
    ])('«%s» → %s', async (mensaje, codigo) => {
      await expect(conError(new Error(mensaje))).resolves.toMatchObject({
        ok: false,
        code: codigo,
      });
    });

    it('un TimeoutError se clasifica aunque el mensaje no lo diga', async () => {
      const e = new Error('se acabó');
      e.name = 'TimeoutError';
      await expect(conError(e)).resolves.toMatchObject({ code: 'TIMEOUT' });
    });

    it('el campo `details` de gRPC también se lee', async () => {
      await expect(
        conError({ details: 'PERMISSION_DENIED por el proyecto' }),
      ).resolves.toMatchObject({ code: 'AUTH' });
    });

    it('🛡️ NUNCA lanza: siempre devuelve un TtsResult', async () => {
      await expect(conError('un string pelado')).resolves.toMatchObject({
        ok: false,
      });
      await expect(conError(null)).resolves.toMatchObject({ ok: false });
    });

    it('una llamada que se cuelga se corta por timeout', async () => {
      synthesizeSpeech.mockImplementation(() => new Promise(() => undefined));
      jest.useFakeTimers();

      const pendiente = service.generate('hola', PARAMS);
      jest.advanceTimersByTime(8001);
      const r = await pendiente;

      jest.useRealTimers();
      expect(r).toMatchObject({ ok: false, code: 'TIMEOUT' });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('ElevenLabsTtsService', () => {
  let service: ElevenLabsTtsService;
  let fetchMock: jest.Mock;

  const PARAMS = { apiKey: 'sk-11labs', voiceId: 'voz-1' };
  /** `TtsResult` es una unión: en las ramas de fallo se estrecha con esto. */
  const fallo = (r: TtsResult) => {
    expect(r.ok).toBe(false);
    return r as Extract<TtsResult, { ok: false }>;
  };

  const respuestaOk = (bytes = [1, 2, 3]) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  });

  beforeEach(() => {
    service = new ElevenLabsTtsService();
    fetchMock = jest.fn(async () => respuestaOk());
    global.fetch = fetchMock as never;
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('devuelve el audio en OGG/Opus, el formato que WhatsApp acepta', async () => {
    const r = await service.generate('hola', PARAMS);

    expect(r).toMatchObject({ ok: true, bytes: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/voz-1?output_format=opus_48000_64');
    expect(init.headers.Accept).toBe('audio/ogg');
    expect(init.headers['xi-api-key']).toBe('sk-11labs');
  });

  it('usa el modelo multilingüe: la clínica atiende en español', async () => {
    await service.generate('hola', PARAMS);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model_id).toBe('eleven_multilingual_v2');
  });

  it.each([
    ['sin key', { apiKey: '', voiceId: 'v1' }],
    ['sin voz', { apiKey: 'k', voiceId: '' }],
  ])('%s → NOT_CONFIGURED sin salir a la red', async (_e, params) => {
    await expect(service.generate('hola', params)).resolves.toMatchObject({
      ok: false,
      code: 'NOT_CONFIGURED',
      rtt_ms: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🧹 los surrogates sueltos se limpian: ElevenLabs los rechaza con 400', async () => {
    // Un emoji partido a la mitad por un recorte de texto es el caso real.
    await service.generate('hola \uD83D mundo \uDE00', PARAMS);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('hola  mundo ');
    expect(/[\uD800-\uDFFF]/.test(body.text)).toBe(false);
  });

  it('un emoji COMPLETO sí se conserva', async () => {
    await service.generate('cita 🩺 confirmada', PARAMS);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('🩺');
  });

  describe('clasificación por código HTTP', () => {
    const conStatus = (status: number, cuerpo = 'detalle del error') => {
      fetchMock.mockResolvedValue({
        ok: false,
        status,
        text: async () => cuerpo,
      });
      return service.generate('hola', PARAMS);
    };

    it.each([
      [401, 'AUTH'],
      [403, 'AUTH'],
      [402, 'PLAN_REQUIRED'],
      [429, 'QUOTA_EXCEEDED'],
      [400, 'BAD_REQUEST'],
      [422, 'BAD_REQUEST'],
      [404, 'INVALID_VOICE'],
      [500, 'UNKNOWN'],
    ])('HTTP %i → %s', async (status, codigo) => {
      await expect(conStatus(status)).resolves.toMatchObject({
        ok: false,
        code: codigo,
      });
    });

    it('el mensaje conserva el cuerpo del error, recortado', async () => {
      const r = fallo(await conStatus(402, 'x'.repeat(2000)));
      expect(r.message).toContain('402');
      expect(r.message.length).toBeLessThan(600);
    });

    it('si el cuerpo del error no se puede leer, no enmascara el error real', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('stream roto');
        },
      });

      const r = fallo(await service.generate('hola', PARAMS));
      expect(r.message).toContain('ilegible');
      expect(r.code).toBe('UNKNOWN');
    });
  });

  it('un 200 con cuerpo vacío se reporta como NO_AUDIO', async () => {
    fetchMock.mockResolvedValue(respuestaOk([]));

    await expect(service.generate('hola', PARAMS)).resolves.toMatchObject({
      ok: false,
      code: 'NO_AUDIO',
    });
  });

  it('un abort por timeout se reporta como TIMEOUT con el plazo', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);

    const r = fallo(await service.generate('hola', PARAMS));
    expect(r.code).toBe('TIMEOUT');
    expect(r.message).toContain('12000ms');
  });

  it('un fallo de red se reporta como UNKNOWN, nunca se propaga', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND api.elevenlabs.io'));

    await expect(service.generate('hola', PARAMS)).resolves.toMatchObject({
      ok: false,
      code: 'UNKNOWN',
      message: expect.stringContaining('ENOTFOUND'),
    });
  });

  it('el temporizador se limpia siempre, también en el camino feliz', async () => {
    const spy = jest.spyOn(global, 'clearTimeout');
    await service.generate('hola', PARAMS);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
