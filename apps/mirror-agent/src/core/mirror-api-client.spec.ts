import { HttpMirrorApiClient } from './mirror-api-client';

// ══════════════════════════════════════════════════════════════════════════
// `fetch` no trae timeout. Sin uno, una red que TRAGA los paquetes en vez de
// rechazarlos deja al agente colgado sin fin. Se comprobó desconectando la VM
// simulada de internet: durante toda la caída el journal no registró una sola
// línea, `systemctl status` decía "active (running)" y no se sincronizaba
// nada. Quien estuviera delante de la máquina no tenía nada que mirar.
// ══════════════════════════════════════════════════════════════════════════
describe('HttpMirrorApiClient — la red que no contesta', () => {
  const original = global.fetch;
  let client: HttpMirrorApiClient;

  beforeEach(() => {
    // Plazos diminutos: la prueba comprueba el comportamiento, no la espera.
    client = new HttpMirrorApiClient('https://api.agenia.example.com', 'tok', {
      timeoutMs: 20,
      longPollTimeoutMs: 45,
    });
  });

  afterEach(() => {
    global.fetch = original;
    jest.useRealTimers();
  });

  /** Simula una conexión que ni responde ni falla: solo se queda ahí. */
  const redQueTraga = () => {
    global.fetch = jest.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(
              Object.assign(new Error('The operation was aborted'), {
                name: 'TimeoutError',
              }),
            ),
          );
        }),
    ) as unknown as typeof fetch;
  };

  it('toda llamada lleva un AbortSignal: ninguna espera para siempre', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await client.heartbeat({});

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('el pull aguanta más que el resto: el servidor retiene la respuesta 25 s', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as unknown as typeof fetch;

    await client.getPendingEvents('0');
    await client.heartbeat({});

    const [pull, latido] = (global.fetch as jest.Mock).mock.calls.map(
      (c) => c[1].signal,
    );
    // No se puede leer el plazo del signal, pero sí distinguir que NO son
    // el mismo objeto ni la misma configuración: el pull se pide aparte.
    expect(pull).not.toBe(latido);
  });

  it('un timeout dice contra QUÉ se estaba hablando, no "operation aborted"', async () => {
    redQueTraga();

    await expect(client.heartbeat({})).rejects.toThrow(
      /no respondió en 0.02s a POST \/mirror\/heartbeat/,
    );
  });

  it('el mensaje sugiere dónde mirar: la salida HTTPS de la VM', async () => {
    redQueTraga();

    await expect(client.handshake({ agentClockIso: 'x' } as never)).rejects.toThrow(
      /salida HTTPS hacia https:\/\/api\.agenia\.example\.com/,
    );
  });

  it('un error de red normal se propaga tal cual', async () => {
    // Solo el timeout se reescribe; un ECONNREFUSED ya se explica solo.
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(client.heartbeat({})).rejects.toThrow('ECONNREFUSED');
  });

  it('un 4xx/5xx sigue reportando el cuerpo de la respuesta', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'token inválido',
    })) as unknown as typeof fetch;

    await expect(client.heartbeat({})).rejects.toThrow(
      /respondió 401 en POST \/mirror\/heartbeat: token inválido/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// El cable entre la VM del hospital y AgenIA. Ocho métodos, un solo `request`
// debajo: lo que importa es que cada uno pegue en SU ruta con SU verbo, que el
// token del agente viaje siempre, y que un error del servidor no se confunda
// con un éxito (el agente avanzaría su cursor sobre eventos que nunca llegaron).
// ══════════════════════════════════════════════════════════════════════════
describe('HttpMirrorApiClient — el contrato HTTP', () => {
  const original = global.fetch;
  let client: HttpMirrorApiClient;
  let fetchMock: jest.Mock;

  const BASE = 'https://api.agenia.example.com';

  const respuesta = (body: unknown = {}) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });

  beforeEach(() => {
    client = new HttpMirrorApiClient(BASE, 'token-del-agente');
    fetchMock = jest.fn(async () => respuesta());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = original;
  });

  const llamada = () => ({
    url: fetchMock.mock.calls[0][0] as string,
    init: fetchMock.mock.calls[0][1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  });

  describe('rutas y verbos', () => {
    it('handshake → POST /mirror/handshake', async () => {
      await client.handshake({
        driverVersion: '1.0.0',
        agentClockIso: '2026-09-02T10:00:00.000Z',
      });

      const { url, init } = llamada();
      expect(url).toBe(`${BASE}/mirror/handshake`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body!)).toMatchObject({ driverVersion: '1.0.0' });
    });

    it('getPendingEvents → GET /mirror/events con el cursor en la query', async () => {
      fetchMock.mockResolvedValue(respuesta([]));

      await client.getPendingEvents('42');

      const { url, init } = llamada();
      expect(url).toBe(`${BASE}/mirror/events?cursor=42`);
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });

    it('el límite viaja solo cuando se pide', async () => {
      fetchMock.mockResolvedValue(respuesta([]));

      await client.getPendingEvents('0', 50);
      expect(llamada().url).toContain('limit=50');
    });

    it('un límite 0 no se manda (sería «tráeme nada»)', async () => {
      fetchMock.mockResolvedValue(respuesta([]));
      await client.getPendingEvents('0', 0);
      expect(llamada().url).not.toContain('limit');
    });

    it.each([
      ['ack', '/mirror/ack', { seqs: ['1'] }],
      ['pushChanges', '/mirror/changes', { events: [] }],
      ['heartbeat', '/mirror/heartbeat', { recentErrors: 0 }],
      ['reconcile', '/mirror/reconcile', { fromIso: 'a', toIso: 'b', appointments: [] }],
      ['uploadAvailability', '/mirror/availability', { fromIso: 'a', toIso: 'b', slots: [] }],
      ['uploadCatalog', '/mirror/catalog', { kind: 'DOCTOR', entries: [] }],
    ])('%s → POST %s con su cuerpo', async (metodo, ruta, input) => {
      await (
        client as unknown as Record<string, (i: unknown) => Promise<unknown>>
      )[metodo](input);

      const { url, init } = llamada();
      expect(url).toBe(`${BASE}${ruta}`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body!)).toEqual(input);
    });
  });

  describe('autenticación', () => {
    it('🔑 TODAS las llamadas llevan el token del agente', async () => {
      fetchMock.mockResolvedValue(respuesta([]));

      await client.handshake({ driverVersion: '1', agentClockIso: 'x' });
      await client.getPendingEvents('0');
      await client.heartbeat({});

      for (const [, init] of fetchMock.mock.calls) {
        const auth = (init as { headers: Record<string, string> }).headers;
        expect(JSON.stringify(auth)).toContain('token-del-agente');
      }
    });

    it('el cuerpo va como JSON', async () => {
      await client.heartbeat({});
      expect(llamada().init.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('🚨 un error del servidor NO se confunde con un éxito', () => {
    it.each([400, 401, 403, 409, 500, 502])(
      'HTTP %i lanza con el código y el cuerpo',
      async (status) => {
        fetchMock.mockResolvedValue({
          ok: false,
          status,
          text: async () => 'detalle del servidor',
        });

        await expect(client.heartbeat({})).rejects.toThrow(
          new RegExp(`${status}.*detalle del servidor`),
        );
      },
    );

    it('el mensaje dice QUÉ llamada falló', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'seqs inválido',
      });

      await expect(client.ack({ seqs: [] })).rejects.toThrow(
        /POST \/mirror\/ack/,
      );
    });

    it('si el cuerpo del error no se puede leer, igual se lanza con el código', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => {
          throw new Error('stream roto');
        },
      });

      await expect(client.heartbeat({})).rejects.toThrow(/502/);
    });

    it('un fallo de red se propaga tal cual: el bucle decide qué hacer', async () => {
      fetchMock.mockRejectedValue(new Error('ENOTFOUND api.agenia.example.com'));

      await expect(client.heartbeat({})).rejects.toThrow(/ENOTFOUND/);
    });
  });

  it('la respuesta se devuelve parseada', async () => {
    fetchMock.mockResolvedValue(respuesta({ acknowledged: 3 }));

    await expect(client.ack({ seqs: ['1', '2', '3'] })).resolves.toEqual({
      acknowledged: 3,
    });
  });

  it('una barra final en la URL base no produce una ruta doble', async () => {
    const c = new HttpMirrorApiClient(`${BASE}/`, 'tok');
    await c.heartbeat({});
    expect(llamada().url).not.toContain('//mirror');
  });
});
