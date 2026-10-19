import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parsearConocimiento } from './conocimiento';
import type { ContenidoAyuda } from './tipos';

// ─────────────────────────────────────────────────────────────
// Carga docs/conocimiento/AGENIA.md desde el disco. SOLO SERVIDOR (usa fs).
//
// Se busca subiendo desde el directorio de trabajo: `next dev`/`next start`
// corren en apps/web y el archivo está en la raíz del repo (en la imagen de
// Docker, /app/docs/conocimiento; ver .dockerignore). AGENIA_CONOCIMIENTO_PATH
// fuerza otra ruta.
//
// Se vuelve a leer solo si el archivo cambió (fecha de modificación): en
// desarrollo, editar el .md y recargar la página ya muestra el cambio.
//
// `/* turbopackIgnore: true */`: la ruta se decide al ejecutar; sin la marca,
// el trazado de archivos del build incluiría todo apps/web en esta página.
// ─────────────────────────────────────────────────────────────

export const RUTA_CONOCIMIENTO = path.join('docs', 'conocimiento', 'AGENIA.md');

export function rutaDelConocimiento(): string {
    const forzada = process.env.AGENIA_CONOCIMIENTO_PATH;
    if (forzada) return forzada;
    let dir = /* turbopackIgnore: true */ process.cwd();
    for (let i = 0; i < 6; i++) {
        const candidata = path.join(/* turbopackIgnore: true */ dir, RUTA_CONOCIMIENTO);
        if (existsSync(/* turbopackIgnore: true */ candidata)) return candidata;
        const padre = path.dirname(dir);
        if (padre === dir) break;
        dir = padre;
    }
    throw new Error(`No se encontró ${RUTA_CONOCIMIENTO} subiendo desde ${process.cwd()}.`);
}

let enMemoria: { ruta: string; modificado: number; contenido: ContenidoAyuda } | null = null;

export function cargarConocimiento(): ContenidoAyuda {
    const ruta = rutaDelConocimiento();
    const modificado = statSync(/* turbopackIgnore: true */ ruta).mtimeMs;
    if (enMemoria && enMemoria.ruta === ruta && enMemoria.modificado === modificado) return enMemoria.contenido;
    try {
        const contenido = parsearConocimiento(readFileSync(/* turbopackIgnore: true */ ruta, 'utf8'));
        enMemoria = { ruta, modificado, contenido };
        return contenido;
    } catch (e) {
        throw new Error(`${RUTA_CONOCIMIENTO}, ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
}
