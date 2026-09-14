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
import { runGetPadronFullErrorReport } from '@/app/dashboard/padron/padron-service';

jest.mock('@/app/dashboard/padron/padron-service', () => ({
    runGetPadronFullErrorReport: jest.fn(),
}));

import type { NextRequest } from 'next/server';

/** Solo necesitamos `.json()`: es lo único que las tres rutas leen del request. */
const fakeRequest = (jsonBody: unknown | (() => Promise<unknown>)): NextRequest =>
    ({
        json: typeof jsonBody === 'function' ? jsonBody : async () => jsonBody,
    }) as unknown as NextRequest;

describe('POST /api/padron/error-report', () => {
    beforeEach(() => jest.clearAllMocks());

    it('delega en runGetPadronFullErrorReport con el csvText del body', async () => {
        (runGetPadronFullErrorReport as jest.Mock).mockResolvedValue({ success: true, csv: 'linea,columna,mensaje' });

        const res = await POST(fakeRequest({ csvText: 'cedula\nabc' }));
        const json = await res.json();

        expect(runGetPadronFullErrorReport).toHaveBeenCalledWith('cedula\nabc');
        expect(json).toEqual({ success: true, csv: 'linea,columna,mensaje' });
    });

    it('JSON inválido responde 400 sin invocar la lógica de negocio', async () => {
        const res = await POST(fakeRequest(() => Promise.reject(new SyntaxError('bad json'))));

        expect(res.status).toBe(400);
        expect(runGetPadronFullErrorReport).not.toHaveBeenCalled();
    });
});
