import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { AgentVersionInfo } from '@agenia/shared';

/**
 * 🏷️ Con qué versión corre este agente (2026-10-29).
 *
 * La HUELLA es el sha256 del archivo que se está ejecutando (`process.argv[1]`: el
 * bundle en el servidor del hospital), la misma que imprime `pnpm --filter
 * @agenia/mirror-agent bundle` al compilarlo. Identifica el archivo exacto, aunque
 * se haya compilado con cambios sin commit. El commit y la fecha los deja adentro
 * el compilador (`scripts/bundle.mjs`).
 *
 * Se manda en el handshake y en cada latido; el servidor anota cuando cambia y el
 * Espejo la muestra. Si algo falla, el agente arranca igual, sin versión.
 */

// Lo define esbuild al compilar el bundle (scripts/bundle.mjs). Sin bundle (pruebas,
// ts-node, `node dist/index.js`) no existe.
declare const __AGENIA_AGENT_BUILD__: string | undefined;

function compilacionEmbebida(): string | undefined {
  return typeof __AGENIA_AGENT_BUILD__ === 'string'
    ? __AGENIA_AGENT_BUILD__
    : undefined;
}

export function versionDelAgente(
  opts: {
    archivo?: string;
    compilacion?: string;
    leer?: (ruta: string) => Buffer;
  } = {},
): AgentVersionInfo | undefined {
  const archivo = 'archivo' in opts ? opts.archivo : process.argv[1];
  if (!archivo) return undefined;
  let sha256: string;
  try {
    const leer = opts.leer ?? ((ruta: string) => readFileSync(ruta));
    sha256 = createHash('sha256').update(leer(archivo)).digest('hex');
  } catch {
    return undefined;
  }

  const crudo =
    'compilacion' in opts ? opts.compilacion : compilacionEmbebida();
  let datos: Record<string, unknown> = {};
  if (crudo) {
    try {
      const o: unknown = JSON.parse(crudo);
      if (o && typeof o === 'object') datos = o as Record<string, unknown>;
    } catch {
      // Una compilación ilegible no impide reportar la huella.
    }
  }
  return {
    sha256: sha256.slice(0, 12),
    commit: typeof datos.commit === 'string' ? datos.commit : null,
    dirty: datos.dirty === true,
    builtAtIso: typeof datos.builtAtIso === 'string' ? datos.builtAtIso : null,
  };
}

/** Para el log de arranque: «huella b1142c02c319 · eed01b9 con cambios · compilado 2026-10-29T16:05:00Z». */
export function describirVersionDelAgente(
  v: AgentVersionInfo | undefined,
): string {
  if (!v) return 'sin versión (no se pudo leer el archivo del agente)';
  const partes = [`huella ${v.sha256}`];
  if (v.commit) partes.push(v.dirty ? `${v.commit} con cambios` : v.commit);
  if (v.builtAtIso) partes.push(`compilado ${v.builtAtIso}`);
  return partes.join(' · ');
}
