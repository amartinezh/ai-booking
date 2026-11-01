/**
 * @jest-environment node
 */
let cookie: string | undefined;
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => (cookie ? { value: cookie } : undefined) })),
    headers: jest.fn(async () => new Map()),
}));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { GET } from './route';

// El documento del paciente: sin acceso vuelve a la página (que pide la fecha);
// con acceso, reenvía el archivo de la API sin caché.
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
const pedir = (q: string, token = TOKEN) =>
    GET(new Request(`http://localhost/resumen/${token}/documento?${q}`), { params: Promise.resolve({ token }) });

describe('GET /resumen/[token]/documento', () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;
    beforeEach(() => {
        cookie = undefined;
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterAll(() => {
        global.fetch = realFetch;
    });

    it('sin acceso: de vuelta a la página, sin llamar a la API', async () => {
        const r = await pedir('doc=resumen&formato=pdf');
        expect(r.status).toBe(303);
        expect(r.headers.get('location')).toBe(`/resumen/${TOKEN}`);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('pedido inválido o token raro', async () => {
        cookie = 'acceso';
        expect((await pedir('doc=../x&formato=pdf')).status).toBe(400);
        expect((await pedir('doc=resumen&formato=png&hoja=0')).status).toBe(400);
        expect((await pedir('doc=resumen', 'corto')).status).toBe(404);
    });

    it('con acceso: el archivo, descargable y sin caché', async () => {
        cookie = 'link-1.123.firma';
        fetchMock.mockResolvedValue(
            new Response(Buffer.from('%PDF-1.7'), {
                status: 200,
                headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="Resumen_01-11-2026.pdf"' },
            }),
        );
        const r = await pedir('doc=resumen&formato=pdf&descargar=1');
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toBe('application/pdf');
        expect(r.headers.get('content-disposition')).toBe('attachment; filename="Resumen_01-11-2026.pdf"');
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            token: TOKEN,
            acceso: 'link-1.123.firma',
            documento: 'resumen',
            formato: 'pdf',
            hoja: 1,
        });
    });

    it('acceso vencido (la API lo rechaza): de vuelta a la página', async () => {
        cookie = 'vencido';
        fetchMock.mockResolvedValue(new Response('no', { status: 404 }));
        expect((await pedir('doc=resumen&formato=pdf')).status).toBe(303);
    });
});
