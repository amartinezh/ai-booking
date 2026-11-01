/**
 * @jest-environment node
 */
jest.mock('@/lib/resumen/acceso', () => ({ adminDelResumen: jest.fn() }));
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => ({ value: 'jwt-de-prueba' }) })),
    headers: jest.fn(async () => new Map()),
}));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { adminDelResumen } from '@/lib/resumen/acceso';
import { GET } from './route';

// El documento para el administrador: solo él, y la API recibe su sesión.
const ID = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
const pedir = (q: string) => GET(new Request(`http://localhost/dashboard/espejo/resumen-atencion/documento?${q}`));

describe('GET documento del resumen (panel)', () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;
    beforeEach(() => {
        (adminDelResumen as jest.Mock).mockResolvedValue({ organizationId: 'org-1', userId: 'u-1', role: 'ORG_ADMIN' });
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterAll(() => {
        global.fetch = realFetch;
    });

    it('🔒 sin permiso no llama a la API', async () => {
        (adminDelResumen as jest.Mock).mockResolvedValue(null);
        expect((await pedir(`id=${ID}&doc=resumen&formato=pdf`)).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('pedido inválido', async () => {
        expect((await pedir('id=x&doc=resumen&formato=pdf')).status).toBe(400);
        expect((await pedir(`id=${ID}&doc=../../x&formato=pdf`)).status).toBe(400);
    });

    it('reenvía la imagen de la API con la sesión; un resumen borrado dice que se borró', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(Buffer.from([0x89, 0x50]), { status: 200, headers: { 'content-type': 'image/png' } }),
        );
        const r = await pedir(`id=${ID}&doc=formula-77&formato=png&hoja=2`);
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toBe('image/png');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(new RegExp(`/attention-summaries/${ID}/documents/formula-77\\?formato=png&hoja=2$`));
        expect(init.headers).toEqual({ Cookie: 'auth_token=jwt-de-prueba' });

        fetchMock.mockResolvedValueOnce(new Response('gone', { status: 410 }));
        const borrado = await pedir(`id=${ID}&doc=resumen&formato=pdf`);
        expect(borrado.status).toBe(410);
        expect(await borrado.text()).toContain('ya se borró');
    });
});
