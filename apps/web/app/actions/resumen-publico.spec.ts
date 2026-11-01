/**
 * @jest-environment node
 */
const set = jest.fn();
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ set, get: () => undefined })),
    headers: jest.fn(async () => new Map([['x-forwarded-for', '190.0.0.1, 10.0.0.1'], ['user-agent', 'Android']])),
}));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { salirDelResumenAction, verificarFechaResumenAction } from './resumen-publico';

// La verificación de la fecha: la decide la API; aquí se fija que el acceso
// queda en una cookie solo para ESE enlace y que la IP del visitante viaja.
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('verificarFechaResumenAction', () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;
    const responde = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });

    beforeEach(() => {
        set.mockClear();
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterAll(() => {
        global.fetch = realFetch;
    });

    it('fecha correcta: guarda el acceso en una cookie solo para este enlace', async () => {
        fetchMock.mockResolvedValue(responde({ ok: true, acceso: 'link-1.123.firma', expiraIso: '2026-11-01T15:00:00.000Z' }));
        await expect(verificarFechaResumenAction(TOKEN, '1963-05-17')).resolves.toEqual({ success: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/public\/attention-summaries\/verify$/);
        expect(JSON.parse(init.body)).toEqual({ token: TOKEN, fechaNacimiento: '1963-05-17' });
        expect(init.headers['X-AgenIA-IP']).toBe('190.0.0.1');
        expect(set).toHaveBeenCalledWith(
            'resumen_acceso',
            'link-1.123.firma',
            expect.objectContaining({ httpOnly: true, path: `/resumen/${TOKEN}`, sameSite: 'lax' }),
        );
    });

    it('equivocada o bloqueada: lo dice y no guarda nada', async () => {
        fetchMock.mockResolvedValue(responde({ ok: false, estado: 'FECHA_INCORRECTA', intentosRestantes: 3 }));
        await expect(verificarFechaResumenAction(TOKEN, '1963-05-18')).resolves.toEqual({
            success: false,
            estado: 'FECHA_INCORRECTA',
            intentosRestantes: 3,
        });
        expect(set).not.toHaveBeenCalled();
    });

    it('un token o una fecha mal formados no llegan a la API', async () => {
        await expect(verificarFechaResumenAction('../x', '1963-05-17')).resolves.toEqual({ success: false, estado: 'NO_DISPONIBLE' });
        await expect(verificarFechaResumenAction(TOKEN, '17/05/1963')).resolves.toMatchObject({ success: false, estado: 'FECHA_INCORRECTA' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('la API caída: error de conexión', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(verificarFechaResumenAction(TOKEN, '1963-05-17')).resolves.toEqual({ success: false, estado: 'ERROR' });
    });

    it('salir borra la cookie de ese enlace', async () => {
        await salirDelResumenAction(TOKEN);
        expect(set).toHaveBeenCalledWith('resumen_acceso', '', { path: `/resumen/${TOKEN}`, maxAge: 0 });
    });
});
