/**
 * 👣 ACTIVIDAD DE USUARIOS — la forma común de un evento y cómo se mezclan.
 *
 * Cada fuente (`fuentes.ts`) devuelve sus eventos más recientes ya ordenados; aquí
 * se mezclan en una sola línea de tiempo, de lo más nuevo a lo más viejo, y se
 * corta la página. La página siguiente arranca donde terminó esta (un «cursor»
 * con la hora y la clave del último evento mostrado), no con un número de página:
 * así no se repiten ni se saltan eventos aunque entren otros nuevos mientras se
 * mira la lista. Puro, para probarlo sin base.
 */
import type { Categoria } from './catalogo';

export interface ActorDelEvento {
    userId: string | null;
    email: string | null;
    role: string | null;
}

export interface EventoDeActividad {
    /** `<fuente>:<id>`: única en toda la línea de tiempo y desempate a igual hora. */
    clave: string;
    /** Instante del evento (ISO, UTC). */
    at: string;
    categoria: Categoria;
    /** Código técnico (USER_LOGIN, RASTREO_BUSQUEDA…), para filtrar y buscar. */
    accion: string;
    /** Qué hizo, en palabras («Ingresó al panel»). */
    titulo: string;
    /** El complemento («Desde Chrome en Windows», «Archivo sura.csv: 1.200 filas»). */
    detalle: string | null;
    /** Algo que merece atención: un ingreso fallido, una cuenta borrada. */
    aviso: boolean;
    organizationId: string | null;
    organizationName?: string | null;
    actor: ActorDelEvento;
    ip: string | null;
    navegador: string | null;
    /** Datos técnicos para el detalle (sin claves ni datos completos de pacientes). */
    extra: Record<string, unknown> | null;
}

export interface Cursor {
    at: string;
    clave: string;
}

/** ¿El evento va antes que el otro en la línea de tiempo (más nuevo, o igual hora y clave mayor)? */
export function vaAntes(a: Pick<EventoDeActividad, 'at' | 'clave'>, b: Pick<EventoDeActividad, 'at' | 'clave'>): boolean {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    if (ta !== tb) return ta > tb;
    return a.clave > b.clave;
}

/**
 * Mezcla las listas de las fuentes y corta la página.
 *
 * Cada fuente trae sus eventos con hora <= la del cursor (incluida la igual, por
 * si dos eventos comparten el milisegundo); aquí se descartan los que ya se
 * mostraron —los de la misma hora con clave >= la del cursor— y se ordena todo.
 * `hayMas` es verdad si quedó al menos un evento por fuera de la página.
 */
export function mezclarPagina(
    listas: EventoDeActividad[][],
    limite: number,
    cursor: Cursor | null,
): { eventos: EventoDeActividad[]; siguiente: Cursor | null } {
    const vistos = new Set<string>();
    const todos: EventoDeActividad[] = [];
    for (const lista of listas) {
        for (const e of lista) {
            if (vistos.has(e.clave)) continue;
            if (cursor && !vaAntes(cursor, e)) continue;
            vistos.add(e.clave);
            todos.push(e);
        }
    }
    todos.sort((a, b) => (vaAntes(a, b) ? -1 : vaAntes(b, a) ? 1 : 0));
    const eventos = todos.slice(0, limite);
    const ultimo = eventos[eventos.length - 1];
    const siguiente = todos.length > limite && ultimo ? { at: ultimo.at, clave: ultimo.clave } : null;
    return { eventos, siguiente };
}

/** El cursor viaja en la URL de la acción como texto opaco. */
export function codificarCursor(c: Cursor): string {
    return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodificarCursor(texto: unknown): Cursor | null {
    if (typeof texto !== 'string' || !texto || texto.length > 500) return null;
    try {
        const c = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8')) as Partial<Cursor>;
        if (typeof c?.at !== 'string' || typeof c?.clave !== 'string') return null;
        if (Number.isNaN(Date.parse(c.at))) return null;
        return { at: new Date(c.at).toISOString(), clave: c.clave.slice(0, 200) };
    } catch {
        return null;
    }
}
