import {
  conReintentoAMeta,
  esErrorPasajeroDeMeta,
  ESPERAS_REINTENTO_META_MS,
} from './meta-reintento';

/**
 * 🔁 2026-11-09: Meta respondió con su página de error (HTML, 5xx) y tres
 * mensajes a pacientes se perdieron sin reintento.
 */
const respuesta = (status: number, data: unknown = {}) => ({
  response: { status, data },
  message: `Request failed with status code ${status}`,
});
const deMeta = (status: number, code: number) =>
  respuesta(status, { error: { code, message: 'x' } });

describe('esErrorPasajeroDeMeta', () => {
  it.each([
    [
      'la página de error de Meta (HTML, 502)',
      respuesta(502, '<!DOCTYPE html>'),
    ],
    ['un 500', respuesta(500)],
    ['un 503', respuesta(503)],
    ['demasiadas peticiones (429)', respuesta(429)],
    ['servicio no disponible (131016)', deMeta(400, 131016)],
    ['algo salió mal (131000)', deMeta(400, 131000)],
    ['servidor no disponible (133004)', deMeta(400, 133004)],
    ['límite de envío del número (130429)', deMeta(400, 130429)],
    ['límite de peticiones (80007)', deMeta(400, 80007)],
    ['DNS sin resolver', { code: 'ENOTFOUND' }],
    ['conexión rechazada', { code: 'ECONNREFUSED' }],
    ['DNS por un momento', { code: 'EAI_AGAIN' }],
  ])('%s → se reintenta', (_n, error) => {
    expect(esErrorPasajeroDeMeta(error)).toBe(true);
  });

  it.each([
    ['token vencido (190)', deMeta(401, 190)],
    ['parámetro inválido (100)', deMeta(400, 100)],
    ['ventana de 24 h cerrada (131047)', deMeta(400, 131047)],
    ['número que no es de WhatsApp (131026)', deMeta(400, 131026)],
    ['un 400 sin código', respuesta(400)],
    ['tiempo agotado (Meta pudo recibirlo)', { code: 'ECONNABORTED' }],
    ['conexión cortada a mitad (Meta pudo recibirlo)', { code: 'ECONNRESET' }],
    ['un error cualquiera', new Error('x')],
    ['nada', null],
  ])('%s → no se reintenta', (_n, error) => {
    expect(esErrorPasajeroDeMeta(error)).toBe(false);
  });
});

describe('conReintentoAMeta', () => {
  const sinEsperar = jest.fn(async () => undefined);
  beforeEach(() => sinEsperar.mockClear());

  it('con un error pasajero, reintenta y devuelve lo que salió', async () => {
    const enviar = jest
      .fn()
      .mockRejectedValueOnce(respuesta(502, '<!DOCTYPE html>'))
      .mockResolvedValueOnce({ messages: [{ id: 'wamid.1' }] });
    const alReintentar = jest.fn();

    await expect(
      conReintentoAMeta(enviar, { dormir: sinEsperar, alReintentar }),
    ).resolves.toEqual({ messages: [{ id: 'wamid.1' }] });

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(sinEsperar).toHaveBeenCalledWith(1_000);
    expect(alReintentar).toHaveBeenCalledWith(1, expect.anything(), 1_000);
  });

  it('dos reintentos como mucho (a 1 s y a 3 s); luego lanza el último error', async () => {
    const enviar = jest.fn().mockRejectedValue(respuesta(503));

    await expect(
      conReintentoAMeta(enviar, { dormir: sinEsperar }),
    ).rejects.toMatchObject({ response: { status: 503 } });

    expect(enviar).toHaveBeenCalledTimes(3);
    expect(sinEsperar.mock.calls.map((c) => c[0])).toEqual([
      ...ESPERAS_REINTENTO_META_MS,
    ]);
    expect(ESPERAS_REINTENTO_META_MS).toEqual([1_000, 3_000]);
  });

  it('un error definitivo no se reintenta', async () => {
    const enviar = jest.fn().mockRejectedValue(deMeta(401, 190));

    await expect(
      conReintentoAMeta(enviar, { dormir: sinEsperar }),
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(sinEsperar).not.toHaveBeenCalled();
  });

  it('si sale a la primera, no espera nada', async () => {
    const enviar = jest.fn().mockResolvedValue('ok');
    await expect(
      conReintentoAMeta(enviar, { dormir: sinEsperar }),
    ).resolves.toBe('ok');
    expect(sinEsperar).not.toHaveBeenCalled();
  });

  it('sin esperas configuradas, no reintenta', async () => {
    const enviar = jest.fn().mockRejectedValue(respuesta(503));
    await expect(
      conReintentoAMeta(enviar, { esperas: [] }),
    ).rejects.toBeTruthy();
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
