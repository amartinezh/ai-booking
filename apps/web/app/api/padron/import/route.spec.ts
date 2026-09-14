/**
 * @jest-environment node
 *
 * next/server (NextRequest/NextResponse) exige el Request/Response/Headers
 * del Fetch API del entorno de ejecución real (Node), que jsdom —el entorno
 * global de este proyecto, pensado para probar componentes de React— no
 * implementa. Sin este override el módulo ni siquiera carga: revienta con
 * "ReferenceError: Request is not defined" antes de que corra una sola
 * prueba. Las Route Handlers de Next corren en Node/Edge, nunca en un
 * navegador, así que node es además el entorno correcto para probarlas.
 */
import { POST } from './route';
import { runImportPadronCsv } from '@/app/dashboard/padron/padron-service';

jest.mock('@/app/dashboard/padron/padron-service', () => ({
    runImportPadronCsv: jest.fn(),
}));

import type { NextRequest } from 'next/server';

/** Solo necesitamos `.json()`: es lo único que las tres rutas leen del request. */
const fakeRequest = (jsonBody: unknown | (() => Promise<unknown>)): NextRequest =>
    ({
        json: typeof jsonBody === 'function' ? jsonBody : async () => jsonBody,
    }) as unknown as NextRequest;

describe('POST /api/padron/import', () => {
    beforeEach(() => jest.clearAllMocks());

    it('delega con los cuatro campos del body, tal como llegan', async () => {
        (runImportPadronCsv as jest.Mock).mockResolvedValue({ success: true, created: 1 });

        await POST(
            fakeRequest({
                csvText: 'cedula\n123',
                epsId: 'eps-1',
                fileName: 'padron.csv',
                confirmDeactivation: true,
            }),
        );

        expect(runImportPadronCsv).toHaveBeenCalledWith('cedula\n123', 'eps-1', 'padron.csv', true);
    });

    it('confirmDeactivation solo es true si el body manda literalmente `true`', async () => {
        (runImportPadronCsv as jest.Mock).mockResolvedValue({ success: true });

        await POST(fakeRequest({ csvText: 'x', epsId: 'e', confirmDeactivation: 'true' }));

        // "true" (string) no es `true` (booleano): que alguien mande texto no
        // debe colar una confirmación de la guarda de desactivación masiva.
        expect(runImportPadronCsv).toHaveBeenCalledWith('x', 'e', 'padron.csv', false);
    });

    it('fileName ausente cae al nombre por defecto', async () => {
        (runImportPadronCsv as jest.Mock).mockResolvedValue({ success: true });

        await POST(fakeRequest({ csvText: 'x', epsId: 'e' }));

        expect(runImportPadronCsv).toHaveBeenCalledWith('x', 'e', 'padron.csv', false);
    });

    it('JSON inválido responde 400 sin invocar la lógica de negocio', async () => {
        const res = await POST(fakeRequest(() => Promise.reject(new SyntaxError('bad json'))));

        expect(res.status).toBe(400);
        expect(runImportPadronCsv).not.toHaveBeenCalled();
    });
});
