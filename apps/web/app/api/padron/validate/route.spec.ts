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
import { runValidatePadronCsv } from '@/app/dashboard/padron/padron-service';

jest.mock('@/app/dashboard/padron/padron-service', () => ({
    runValidatePadronCsv: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────
// Este endpoint es una Route Handler y NO una Server Action a propósito: el
// csvText del padrón real pesa varios MB, y el codificador de argumentos de
// las Server Actions (React Flight) cuenta cada carácter de un string como
// un "slot" contra un límite interno de 1.000.000 — revienta con "Maximum
// array nesting exceeded" antes de que el código de la función se ejecute
// (pasó en producción con el archivo real de Sura, 2026-09-14). Un Route
// Handler lee el body con `request.json()`, sin ese límite.
//
// Estas pruebas cubren solo la FRONTERA de la ruta (parseo del body,
// coerción de tipos, delegación); la lógica de negocio vive y se prueba
// donde ya vivía: padron-service.ts.
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server';

/** Solo necesitamos `.json()`: es lo único que las tres rutas leen del request. */
const fakeRequest = (jsonBody: unknown | (() => Promise<unknown>)): NextRequest =>
    ({
        json: typeof jsonBody === 'function' ? jsonBody : async () => jsonBody,
    }) as unknown as NextRequest;

describe('POST /api/padron/validate', () => {
    beforeEach(() => jest.clearAllMocks());

    it('delega en runValidatePadronCsv con csvText y epsId del body', async () => {
        (runValidatePadronCsv as jest.Mock).mockResolvedValue({ success: true, report: { ok: true } });

        const res = await POST(fakeRequest({ csvText: 'cedula\n123', epsId: 'eps-1' }));
        const json = await res.json();

        expect(runValidatePadronCsv).toHaveBeenCalledWith('cedula\n123', 'eps-1');
        expect(json).toEqual({ success: true, report: { ok: true } });
    });

    it('acepta un csvText de varios MB sin límite propio — la razón de ser de esta ruta', async () => {
        // No es un valor arbitrario: 2.000.000 de caracteres ya supera el
        // límite de 1.000.000 "slots" del codificador de Server Actions que
        // esta ruta existe para esquivar.
        const csvGigante = 'a'.repeat(2_000_000);
        (runValidatePadronCsv as jest.Mock).mockResolvedValue({ success: true, report: { ok: false } });

        await POST(fakeRequest({ csvText: csvGigante, epsId: 'eps-1' }));

        expect(runValidatePadronCsv).toHaveBeenCalledWith(csvGigante, 'eps-1');
    });

    it('coacciona a cadena vacía cuando csvText o epsId faltan o no son string', async () => {
        (runValidatePadronCsv as jest.Mock).mockResolvedValue({ success: false, error: 'x' });

        await POST(fakeRequest({ csvText: 123, epsId: null }));

        expect(runValidatePadronCsv).toHaveBeenCalledWith('', '');
    });

    it('body vacío/null no revienta: se trata como objeto vacío', async () => {
        (runValidatePadronCsv as jest.Mock).mockResolvedValue({ success: false, error: 'x' });

        await POST(fakeRequest(null));

        expect(runValidatePadronCsv).toHaveBeenCalledWith('', '');
    });

    it('JSON inválido responde 400 sin invocar la lógica de negocio', async () => {
        const res = await POST(
            fakeRequest(() => Promise.reject(new SyntaxError('Unexpected token'))),
        );

        expect(res.status).toBe(400);
        expect(runValidatePadronCsv).not.toHaveBeenCalled();
        const json = await res.json();
        expect(json.success).toBe(false);
    });
});
