import fs from 'fs';
import path from 'path';

/**
 * Un archivo 'use server' solo puede exportar funciones async: si exporta otra
 * cosa (una constante, un objeto), Next lo acepta al compilar pero la acción
 * falla al USARSE («A "use server" file can only export async functions»).
 * Ni el build ni las pruebas de la acción lo notan. Pasó el 2026-10-22 con el
 * tope de intentos de «Cambiar mi clave»; esta prueba lo frena antes del deploy.
 */

const RAIZ = path.resolve(__dirname, '..');
const CARPETAS = ['app', 'lib'];

function archivos(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : archivos(p);
        return /\.tsx?$/.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name) ? [p] : [];
    });
}

/** ¿El archivo entero es de servidor? (la directiva va al principio, fuera de una función) */
const esUseServer = (codigo: string) =>
    /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]use server['"]/.test(codigo);

/** Exportaciones que Next no admite en un archivo 'use server'. */
function exportacionesInvalidas(codigo: string): string[] {
    return codigo
        .split('\n')
        .filter((l) => /^export\s/.test(l))
        .filter(
            (l) =>
                !/^export\s+(async\s+function|type\s|interface\s|default\s+async\s+function)/.test(l) &&
                !/^export\s+(const|let)\s+\w+\s*(:[^=]+)?=\s*async\b/.test(l),
        );
}

describe("archivos 'use server': solo exportan funciones async", () => {
    const deServidor = CARPETAS.flatMap((c) => archivos(path.join(RAIZ, c))).filter((f) =>
        esUseServer(fs.readFileSync(f, 'utf8')),
    );

    it('encuentra las acciones del servidor (la búsqueda no está rota)', () => {
        expect(deServidor.length).toBeGreaterThan(10);
        expect(deServidor.some((f) => f.endsWith(path.join('app', 'actions', 'cuenta.ts')))).toBe(true);
    });

    it('ninguno exporta constantes, objetos ni funciones síncronas', () => {
        const malos = deServidor.flatMap((f) =>
            exportacionesInvalidas(fs.readFileSync(f, 'utf8')).map((l) => `${path.relative(RAIZ, f)}: ${l.trim()}`),
        );
        expect(malos).toEqual([]);
    });

    it.each([
        ['export const TOPE = { MAX: 5 } as const;', true],
        ['export function sincrona() {}', true],
        ['export class Algo {}', true],
        ['export async function accion() {}', false],
        ['export type Resultado = { ok: true };', false],
        ['export const accion = async () => {};', false],
    ])('%s → inválida: %s', (linea, invalida) => {
        expect(exportacionesInvalidas(linea).length > 0).toBe(invalida);
    });

    it('reconoce la directiva aunque la precedan comentarios, y no la de dentro de una función', () => {
        expect(esUseServer("// comentario\n/* bloque */\n'use server';\nexport async function a() {}")).toBe(true);
        expect(esUseServer("import x from 'y';\nexport async function a() {\n    'use server';\n}")).toBe(false);
        // Un comentario que la menciona no es la directiva (app/actions/ai-config.types.ts).
        expect(esUseServer("// NO lleva `'use server'`, porque…\nexport const X = 1;")).toBe(false);
    });
});
