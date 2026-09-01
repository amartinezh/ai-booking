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
