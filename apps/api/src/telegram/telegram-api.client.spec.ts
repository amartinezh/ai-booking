import { Logger } from '@nestjs/common';
import {
  TELEGRAM_MAX_TEXT,
  TelegramApiClient,
  splitTelegramText,
} from './telegram-api.client';

/**
 * Cliente de la Bot API. Tres garantías:
 *  1. Nunca lanza: todo fallo es `{ ok: false }`.
 *  2. Un 429 se reintenta UNA vez si la espera es razonable.
 *  3. El token (que va en la URL) no aparece en ningún log ni error.
 */
describe('TelegramApiClient', () => {
  const TOKEN = '123456789:AAHsecretoSecretoSecretoSecreto12345';
  let client: TelegramApiClient;
  let fetchMock: jest.Mock;
  let sleeps: number[];
  let logs: string[];
  const realFetch = global.fetch;

  const json = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as Response;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    sleeps = [];
    logs = [];
    client = new TelegramApiClient();
    (client as unknown as { sleep: (ms: number) => Promise<void> }).sleep =
      async (ms: number) => {
        sleeps.push(ms);
      };
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((m: unknown) => void logs.push(String(m)));
    }
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('getMe devuelve el bot', async () => {
    fetchMock.mockResolvedValue(
      json(200, { ok: true, result: { id: 42, is_bot: true, username: 'X' } }),
    );
    await expect(client.getMe(TOKEN)).resolves.toEqual({
      ok: true,
      result: { id: 42, is_bot: true, username: 'X' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${TOKEN}/getMe`,
    );
  });

  it('sendMessage manda texto PLANO (sin parse_mode) y sin vista previa', async () => {
    fetchMock.mockResolvedValue(
      json(200, { ok: true, result: { message_id: 9 } }),
    );
    await client.sendMessage(TOKEN, '777', '*Hola* _paciente_');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      chat_id: '777',
      text: '*Hola* _paciente_',
      link_preview_options: { is_disabled: true },
    });
    expect(body.parse_mode).toBeUndefined();
  });

  it('setWebhook pide solo mensajes y descarta lo acumulado', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: true }));
    await client.setWebhook(TOKEN, { url: 'https://x/y', secretToken: 's' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      url: 'https://x/y',
      secret_token: 's',
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
  });

  it('un error de Telegram vuelve como valor con su código', async () => {
    fetchMock.mockResolvedValue(
      json(403, {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      }),
    );
    await expect(client.sendMessage(TOKEN, '1', 'x')).resolves.toEqual({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
  });

  it('un fallo de red no lanza y no expone la URL', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(
        new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}`),
        {
          cause: { code: 'ENOTFOUND' },
        },
      ),
    );
    const res = await client.getMe(TOKEN);
    expect(res).toEqual({
      ok: false,
      errorCode: null,
      description: 'ENOTFOUND',
    });
  });

  it('un timeout se reporta como timeout', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    );
    await expect(client.getMe(TOKEN)).resolves.toMatchObject({
      ok: false,
      description: 'timeout',
    });
  });

  it('una respuesta que no es JSON no lanza', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);
    await expect(client.getMe(TOKEN)).resolves.toEqual({
      ok: false,
      errorCode: 502,
      description: 'HTTP 502',
    });
  });

  it('429 con espera corta: espera lo pedido y reintenta UNA vez', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(429, {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests: retry after 2',
          parameters: { retry_after: 2 },
        }),
      )
      .mockResolvedValueOnce(
        json(200, { ok: true, result: { message_id: 1 } }),
      );
    const res = await client.sendMessage(TOKEN, '1', 'x');
    expect(res.ok).toBe(true);
    expect(sleeps).toEqual([2000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 repetido: no reintenta más de una vez', async () => {
    const r429 = json(429, {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 1 },
    });
    fetchMock.mockResolvedValue(r429);
    const res = await client.sendMessage(TOKEN, '1', 'x');
    expect(res).toMatchObject({ ok: false, errorCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 con espera larga: no cuelga el turno, devuelve el error', async () => {
    fetchMock.mockResolvedValue(
      json(429, {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 60 },
      }),
    );
    const res = await client.sendMessage(TOKEN, '1', 'x');
    expect(res).toMatchObject({ ok: false, errorCode: 429 });
    expect(sleeps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('otros errores no se reintentan', async () => {
    fetchMock.mockResolvedValue(
      json(400, { ok: false, error_code: 400, description: 'Bad Request' }),
    );
    await client.sendMessage(TOKEN, '1', 'x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendVoice sube el OGG como multipart', async () => {
    fetchMock.mockResolvedValue(
      json(200, { ok: true, result: { message_id: 3 } }),
    );
    const res = await client.sendVoice(TOKEN, '77', Buffer.from('OggS'));
    expect(res).toEqual({ ok: true, result: { message_id: 3 } });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('chat_id')).toBe('77');
    const voice = form.get('voice') as Blob;
    expect(voice.type).toBe('audio/ogg');
    expect(voice.size).toBe(4);
  });

  describe('downloadFile', () => {
    it('resuelve la ruta con getFile y baja el archivo', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            ok: true,
            result: { file_path: 'voice/f.oga', file_size: 3 },
          }),
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response);
      const buf = await client.downloadFile(TOKEN, 'FILE');
      expect(buf).toEqual(Buffer.from([1, 2, 3]));
      expect(fetchMock.mock.calls[1][0]).toBe(
        `https://api.telegram.org/file/bot${TOKEN}/voice/f.oga`,
      );
    });

    it('un archivo de más de 20 MB no se baja', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          ok: true,
          result: { file_path: 'x', file_size: 25 * 1024 * 1024 },
        }),
      );
      await expect(client.downloadFile(TOKEN, 'F')).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('getFile fallido → null', async () => {
      fetchMock.mockResolvedValueOnce(
        json(400, {
          ok: false,
          error_code: 400,
          description: 'file not found',
        }),
      );
      await expect(client.downloadFile(TOKEN, 'F')).resolves.toBeNull();
    });

    it('descarga fallida → null, sin lanzar', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, { ok: true, result: { file_path: 'x' } }),
        )
        .mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(client.downloadFile(TOKEN, 'F')).resolves.toBeNull();
    });

    it('HTTP no-OK en la descarga → null', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, { ok: true, result: { file_path: 'x' } }),
        )
        .mockResolvedValueOnce({ ok: false, status: 404 } as Response);
      await expect(client.downloadFile(TOKEN, 'F')).resolves.toBeNull();
    });
  });

  it('el token NUNCA aparece en los logs', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError(`fetch failed for bot${TOKEN}`))
      .mockResolvedValueOnce(
        json(429, {
          ok: false,
          error_code: 429,
          parameters: { retry_after: 99 },
        }),
      )
      .mockResolvedValueOnce(
        json(400, { ok: false, error_code: 400, description: 'x' }),
      )
      .mockResolvedValueOnce(
        json(200, { ok: true, result: { file_path: 'p' } }),
      )
      .mockRejectedValueOnce(new TypeError(`fetch failed for bot${TOKEN}`));
    await client.getMe(TOKEN);
    await client.sendMessage(TOKEN, '1', 'x');
    await client.downloadFile(TOKEN, 'F');
    await client.downloadFile(TOKEN, 'F');
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain('AAHsecreto');
    }
  });
});

describe('splitTelegramText', () => {
  it('un texto corto queda igual', () => {
    expect(splitTelegramText('hola')).toEqual(['hola']);
  });

  it('respeta el tope de Telegram', () => {
    const text = 'palabra '.repeat(2000);
    const parts = splitTelegramText(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts)
      expect(p.length).toBeLessThanOrEqual(TELEGRAM_MAX_TEXT);
  });

  it('corta de preferencia en un salto de línea', () => {
    const a = 'A'.repeat(70);
    const b = 'B'.repeat(20);
    expect(splitTelegramText(`${a}\n${b}`, 80)).toEqual([a, b]);
  });

  it('si no hay salto, corta en un espacio (no parte un número)', () => {
    const text = `${'x'.repeat(70)} 1234567890`;
    expect(splitTelegramText(text, 75)).toEqual(['x'.repeat(70), '1234567890']);
  });

  it('sin salto ni espacio, corta al tope', () => {
    expect(splitTelegramText('a'.repeat(25), 10)).toEqual([
      'a'.repeat(10),
      'a'.repeat(10),
      'a'.repeat(5),
    ]);
  });

  it('no pierde contenido', () => {
    const text = Array.from(
      { length: 300 },
      (_, i) => `Opción ${i}: lunes 8:00 a. m.`,
    ).join('\n');
    const joined = splitTelegramText(text, 500).join('\n');
    expect(joined.replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });
});

/**
 * Lo que agregó el bot de alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md §3.1):
 * leer el código de vinculación sin webhook, avisar sin sonido de noche y
 * seguir al grupo cuando pasa a supergrupo.
 */
describe('TelegramApiClient — alertas técnicas', () => {
  const TOKEN = '123456789:AAHsecretoSecretoSecretoSecreto12345';
  let client: TelegramApiClient;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;
  const json = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response;
  const body = (i = 0) =>
    JSON.parse(fetchMock.mock.calls[i][1].body as string) as Record<
      string,
      unknown
    >;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new TelegramApiClient();
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation();
    }
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('getUpdates es un sondeo corto: no se queda esperando', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: [] }));
    await expect(client.getUpdates(TOKEN)).resolves.toEqual({
      ok: true,
      result: [],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${TOKEN}/getUpdates`,
    );
    expect(body()).toEqual({ timeout: 0, limit: 100 });
  });

  it('getUpdates pasa el offset (confirma lo leído) y los tipos pedidos', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: [] }));
    await client.getUpdates(TOKEN, {
      offset: 42,
      limit: 10,
      allowedUpdates: ['message'],
    });
    expect(body()).toEqual({
      timeout: 0,
      limit: 10,
      offset: 42,
      allowed_updates: ['message'],
    });
  });

  it('con webhook puesto, getUpdates es un 409 y no lanza', async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        ok: false,
        error_code: 409,
        description:
          "Conflict: can't use getUpdates method while webhook is active",
      }),
    );
    await expect(client.getUpdates(TOKEN)).resolves.toMatchObject({
      ok: false,
      errorCode: 409,
    });
  });

  it('sendMessage sin sonido usa disable_notification', async () => {
    fetchMock.mockResolvedValue(
      json(200, { ok: true, result: { message_id: 1 } }),
    );
    await client.sendMessage(TOKEN, '-100', 'hola', { silent: true });
    expect(body().disable_notification).toBe(true);
    await client.sendMessage(TOKEN, '-100', 'hola');
    expect(body(1)).not.toHaveProperty('disable_notification');
  });

  it('setWebhook del asistente de soporte pide también los toques de botones', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: true }));
    await client.setWebhook(TOKEN, {
      url: 'https://x/y',
      secretToken: 's',
      allowedUpdates: ['message', 'callback_query'],
    });
    expect(body().allowed_updates).toEqual(['message', 'callback_query']);
  });

  it('answerCallbackQuery responde el toque, con o sin aviso', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: true }));
    await client.answerCallbackQuery(TOKEN, 'cb1');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`,
    );
    expect(body()).toEqual({ callback_query_id: 'cb1' });
    await client.answerCallbackQuery(TOKEN, 'cb2', 'Listo');
    expect(body(1)).toEqual({ callback_query_id: 'cb2', text: 'Listo' });
  });

  it('setMyCommands publica el menú del bot', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: true }));
    await client.setMyCommands(TOKEN, [
      { command: 'salir', description: 'Cerrar' },
    ]);
    expect(body()).toEqual({
      commands: [{ command: 'salir', description: 'Cerrar' }],
    });
  });

  it('TELEGRAM_API_BASE apunta a otro servidor (solo pruebas de punta a punta)', async () => {
    const antes = process.env.TELEGRAM_API_BASE;
    process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:9999/';
    try {
      fetchMock.mockResolvedValue(
        json(200, { ok: true, result: { id: 1, is_bot: true } }),
      );
      await client.getMe(TOKEN);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `http://127.0.0.1:9999/bot${TOKEN}/getMe`,
      );
    } finally {
      if (antes === undefined) delete process.env.TELEGRAM_API_BASE;
      else process.env.TELEGRAM_API_BASE = antes;
    }
  });

  it('un grupo que pasó a supergrupo devuelve su id nuevo', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        ok: false,
        error_code: 400,
        description:
          'Bad Request: group chat was upgraded to a supergroup chat',
        parameters: { migrate_to_chat_id: -1001234567890 },
      }),
    );
    await expect(client.sendMessage(TOKEN, '-123', 'x')).resolves.toEqual({
      ok: false,
      errorCode: 400,
      description: 'Bad Request: group chat was upgraded to a supergroup chat',
      migrateToChatId: '-1001234567890',
    });
  });
});
