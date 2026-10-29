/**
 * 🏷️ Versión del agente del hospital (2026-10-29).
 *
 * El agente se actualiza a mano: alguien copia el archivo nuevo en el servidor del
 * hospital y reinicia el servicio. Hasta hoy el servidor de AgenIA no sabía qué
 * versión corría, solo la hora del último latido, así que no había cómo confirmar
 * que una actualización había quedado instalada.
 *
 * El agente se identifica en el handshake y en cada latido con la HUELLA de su
 * archivo (sha256, la que se publica al compilarlo), el commit con que se compiló y
 * la fecha. El servidor anota un renglón en la bitácora del espejo (`SyncAudit`,
 * dirección `AGENT`, operación `VERSION`) solo cuando la versión cambia, y el Espejo
 * muestra la que corre y desde cuándo. No necesita columnas nuevas.
 */
import type { AgentVersionInfo } from './mirror-protocol';

/** Operación del renglón en la bitácora del espejo. */
export const OP_VERSION_AGENTE = 'VERSION';
/** Tipo de entidad del renglón (no es una cita ni un cupo: es el agente). */
export const ENTIDAD_AGENTE = 'AGENT';
/** Caracteres de la huella que se guardan y se muestran (como un commit corto). */
export const LARGO_HUELLA = 12;

/** Un renglón de la bitácora: la versión y la huella de la que había antes. */
export interface RenglonVersionAgente extends AgentVersionInfo {
  commit: string | null;
  dirty: boolean;
  builtAtIso: string | null;
  anterior: string | null;
}

/**
 * Limpia lo que manda el agente (viene de la red) antes de guardarlo. `null` si no
 * trae una huella válida: sin huella no hay versión que comparar.
 */
export function normalizarVersionAgente(
  v: unknown,
): Omit<RenglonVersionAgente, 'anterior'> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const sha = typeof o.sha256 === 'string' ? o.sha256.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{12,64}$/.test(sha)) return null;
  const commitCrudo = typeof o.commit === 'string' ? o.commit.trim() : '';
  const commit = /^[0-9a-f]{7,40}$/i.test(commitCrudo)
    ? commitCrudo.toLowerCase().slice(0, LARGO_HUELLA)
    : null;
  const ms =
    typeof o.builtAtIso === 'string' ? Date.parse(o.builtAtIso) : Number.NaN;
  return {
    sha256: sha.slice(0, LARGO_HUELLA),
    commit,
    dirty: o.dirty === true,
    builtAtIso: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
  };
}

/** El texto que se guarda en `SyncAudit.detail`. */
export function detalleVersionAgente(
  v: Omit<RenglonVersionAgente, 'anterior'>,
  anterior: string | null,
): string {
  return JSON.stringify({ ...v, anterior });
}

/** Lee un renglón de la bitácora. `null` si no es de versión o está dañado. */
export function leerVersionAgente(
  detail: string | null | undefined,
): RenglonVersionAgente | null {
  if (!detail) return null;
  let o: unknown;
  try {
    o = JSON.parse(detail);
  } catch {
    return null;
  }
  const v = normalizarVersionAgente(o);
  if (!v) return null;
  const anterior = (o as Record<string, unknown>).anterior;
  return {
    ...v,
    anterior:
      typeof anterior === 'string' && /^[0-9a-f]{12,64}$/.test(anterior)
        ? anterior.slice(0, LARGO_HUELLA)
        : null,
  };
}

/** «eed01b9», «eed01b9 con cambios sin commit» o `null` si no se sabe. */
export function describirCompilacion(v: {
  commit?: string | null;
  dirty?: boolean;
}): string | null {
  if (!v.commit) return null;
  return v.dirty ? `${v.commit} con cambios sin commit` : v.commit;
}
