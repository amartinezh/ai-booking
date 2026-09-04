/**
 * `catch (e)` tipa `e` como `unknown` bajo `strict`. Antes del fix de lint,
 * el código capturaba como `catch (e: any)` y leía `e.message` a ciegas —
 * silencioso si lo lanzado no era un `Error` (`throw 'texto'`, un rechazo
 * con forma rara, `undefined`). Este helper obliga a pasar por `unknown` y
 * da un mensaje razonable en cualquier caso.
 *
 * Espejo de `apps/api/src/common/error-message.util.ts` (no se comparte vía
 * `@agenia/shared` porque `web` y `api` son apps independientes).
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        // JSON.stringify devuelve `undefined` (no un string) para valores
        // como `undefined`/funciones/símbolos, pese a que su tipo declarado
        // en TS dice `string` — de ahí el `??`.
        return JSON.stringify(error) ?? String(error);
    } catch {
        return String(error);
    }
}
