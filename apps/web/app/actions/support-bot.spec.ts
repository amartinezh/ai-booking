/**
 * @jest-environment node
 */
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => ({ value: 'jwt-de-prueba' }) })),
}));

import { getSession } from '@/lib/session';
import {
    cambiarAvisosAsistente,
    cerrarConversacionAsistente,
    codigoDePruebaAsistente,
    conectarAsistente,
    desconectarAsistente,
    generarCodigoAsistente,
    getConfigAsistente,
    getMiAsistente,
    guardarAjustesAsistente,
} from './support-bot';

const mockSession = getSession as jest.Mock;

/**
 * Las acciones del asistente de soporte (docs/PLAN_BOT_SOPORTE.md): cada una
 * revisa el rol antes de llamar a la API, reenvía la sesión y traduce el 404 de
 * un servidor sin SUPPORT_BOT_ENABLED a «no hay tarjeta» / «apagado».
 */
describe('acciones del asistente de soporte', () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;
    const respuesta = (status: number, body: unknown) =>
        ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;

    beforeEach(() => {
        fetchMock = jest.fn(async () => respuesta(200, { disponible: true }));
        global.fetch = fetchMock as unknown as typeof fetch;
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        global.fetch = realFetch;
        jest.restoreAllMocks();
    });

    const llamada = (i = 0) => {
        const [url, init] = fetchMock.mock.calls[i];
        return { url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, cookie: init.headers.Cookie };
    };

    describe('la tarjeta (personal de la clínica)', () => {
        it.each(['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'])('%s ve su estado', async (role) => {
            mockSession.mockResolvedValue({ role });
            await expect(getMiAsistente()).resolves.toEqual({ disponible: true });
            expect(llamada()).toMatchObject({ method: 'GET', cookie: 'auth_token=jwt-de-prueba' });
            expect(llamada().url).toMatch(/\/support-bot\/me$/);
        });

        it.each([['PATIENT'], ['SUPER_ADMIN'], [null]])('🔒 %s no tiene tarjeta (ni llama a la API)', async (role) => {
            mockSession.mockResolvedValue(role ? { role } : null);
            await expect(getMiAsistente()).resolves.toBeNull();
            await expect(generarCodigoAsistente()).resolves.toEqual({ ok: false, error: 'Acceso denegado' });
            await expect(cerrarConversacionAsistente()).resolves.toMatchObject({ ok: false });
            await expect(cambiarAvisosAsistente(true)).resolves.toMatchObject({ ok: false });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('sin el asistente en el servidor (404) o con la API caída, no hay tarjeta', async () => {
            mockSession.mockResolvedValue({ role: 'DOCTOR' });
            fetchMock.mockResolvedValue(respuesta(404, { message: 'Cannot GET' }));
            await expect(getMiAsistente()).resolves.toBeNull();
            fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
            await expect(getMiAsistente()).resolves.toBeNull();
        });

        it('genera el código, cierra y cambia los avisos', async () => {
            mockSession.mockResolvedValue({ role: 'BOOKING_AGENT' });
            fetchMock.mockResolvedValue(respuesta(201, { codigo: '482913' }));
            await expect(generarCodigoAsistente()).resolves.toEqual({ ok: true, data: { codigo: '482913' } });
            expect(llamada()).toMatchObject({ method: 'POST' });
            expect(llamada().url).toMatch(/\/support-bot\/me\/code$/);

            await cerrarConversacionAsistente();
            expect(llamada(1).url).toMatch(/\/support-bot\/me\/close$/);

            await cambiarAvisosAsistente(false);
            expect(llamada(2)).toMatchObject({ method: 'PUT', body: { activos: false } });
        });

        it('un error de la API llega legible (también anidado por el filtro de Nest)', async () => {
            mockSession.mockResolvedValue({ role: 'BOOKING_AGENT' });
            fetchMock.mockResolvedValue(respuesta(409, { message: 'El asistente de soporte no está disponible.' }));
            await expect(generarCodigoAsistente()).resolves.toEqual({
                ok: false,
                error: 'El asistente de soporte no está disponible.',
            });
            fetchMock.mockResolvedValue(respuesta(403, { message: { message: 'Tu usuario no tiene acceso.' } }));
            await expect(cerrarConversacionAsistente()).resolves.toEqual({ ok: false, error: 'Tu usuario no tiene acceso.' });
            fetchMock.mockResolvedValue(respuesta(400, { message: ['primero', 'segundo'] }));
            await expect(cambiarAvisosAsistente(true)).resolves.toEqual({ ok: false, error: 'primero' });
            fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'no es json' } as Response);
            await expect(generarCodigoAsistente()).resolves.toEqual({ ok: false, error: 'El servidor respondió 500.' });
        });
    });

    describe('la configuración (super admin)', () => {
        beforeEach(() => mockSession.mockResolvedValue({ role: 'SUPER_ADMIN' }));

        it('🔒 nadie más la toca', async () => {
            mockSession.mockResolvedValue({ role: 'ORG_ADMIN' });
            await expect(getConfigAsistente()).resolves.toEqual({ ok: false, apagado: false, error: 'Acceso denegado' });
            await expect(conectarAsistente('t')).resolves.toMatchObject({ ok: false });
            await expect(desconectarAsistente()).resolves.toMatchObject({ ok: false });
            await expect(guardarAjustesAsistente({ enabled: true })).resolves.toMatchObject({ ok: false });
            await expect(codigoDePruebaAsistente('org')).resolves.toMatchObject({ ok: false });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('lee, conecta, desconecta, guarda y genera el código de prueba', async () => {
            fetchMock.mockResolvedValue(respuesta(200, { conectado: true }));
            await expect(getConfigAsistente()).resolves.toEqual({ ok: true, config: { conectado: true } });
            await conectarAsistente('123:abc');
            expect(llamada(1)).toMatchObject({ method: 'POST', body: { botToken: '123:abc' } });
            await desconectarAsistente();
            expect(llamada(2)).toMatchObject({ method: 'DELETE' });
            await guardarAjustesAsistente({ enabled: true, teamFromHour: 8 });
            expect(llamada(3)).toMatchObject({ method: 'PUT', body: { enabled: true, teamFromHour: 8 } });
            fetchMock.mockResolvedValue(respuesta(201, { codigo: '111222' }));
            await expect(codigoDePruebaAsistente('org-1')).resolves.toEqual({ ok: true, data: { codigo: '111222' } });
            expect(llamada(4)).toMatchObject({ body: { organizationId: 'org-1' } });
        });

        it('un 404 quiere decir que SUPPORT_BOT_ENABLED no está encendido', async () => {
            fetchMock.mockResolvedValue(respuesta(404, {}));
            await expect(getConfigAsistente()).resolves.toEqual({
                ok: false,
                apagado: true,
                error: expect.stringContaining('SUPPORT_BOT_ENABLED'),
            });
            fetchMock.mockResolvedValue(respuesta(400, { message: 'Conecte primero el bot.' }));
            await expect(guardarAjustesAsistente({ enabled: true })).resolves.toEqual({
                ok: false,
                apagado: false,
                error: 'Conecte primero el bot.',
            });
            fetchMock.mockResolvedValue(respuesta(400, { message: 'no' }));
            await expect(codigoDePruebaAsistente('x')).resolves.toEqual({ ok: false, error: 'no' });
        });
    });
});
