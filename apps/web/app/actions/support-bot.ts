'use server';

// Solo funciones async — los tipos viven en `./support-bot.types.ts`.
// 🛟 Asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md): la tarjeta de
// Soporte del personal de la clínica y la configuración del super admin. Cada
// acción comprueba el rol aquí Y la API lo vuelve a exigir (@Roles).

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import type {
    AjustesAsistente,
    CodigoAsistente,
    ConfigAsistente,
    EstadoAsistente,
    ResultadoAsistente,
    ResultadoConfigAsistente,
} from './support-bot.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

/** El personal de la clínica (S2): ni el paciente ni el super admin usan la tarjeta. */
const ROLES_DEL_PERSONAL = ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'];
const RUTA_ADMIN = '/super-admin/soporte-bot';

type BackendResponse =
    | { ok: true; body: unknown }
    | { ok: false; status: number; message: string };

/** Llama a la API reenviando la cookie de sesión. Nunca lanza. */
async function callBackend(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
): Promise<BackendResponse> {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    let res: Response;
    try {
        res = await fetch(`${INTERNAL_API_URL}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store',
        });
    } catch (e) {
        const msg = getErrorMessage(e);
        console.error(`[support-bot] ${method} ${path} fetch error:`, msg);
        return { ok: false, status: 0, message: `No se pudo contactar al servidor (${msg}).` };
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    if (res.ok) return { ok: true, body: parsed };

    if (res.status !== 404) console.error(`[support-bot] ${method} ${path} -> ${res.status}`);
    return { ok: false, status: res.status, message: backendMessage(parsed, res.status) };
}

/** El mensaje legible de un error de la API (el filtro global de Nest lo anida). */
function backendMessage(parsed: unknown, status: number): string {
    const outer = (parsed as { message?: unknown } | null)?.message;
    // Un arreglo también es un objeto: los errores de validación llegan como lista.
    const inner =
        typeof outer === 'object' && outer !== null && !Array.isArray(outer)
            ? (outer as { message?: unknown }).message
            : outer;
    if (typeof inner === 'string' && inner.trim()) return inner;
    if (Array.isArray(inner) && typeof inner[0] === 'string') return inner[0];
    return `El servidor respondió ${status}.`;
}

async function esPersonal(): Promise<boolean> {
    const session = await getSession();
    return !!session && ROLES_DEL_PERSONAL.includes(session.role);
}

async function esSuperAdmin(): Promise<boolean> {
    return (await getSession())?.role === 'SUPER_ADMIN';
}

// ───────────────────────────────────────────────────────────────────────────
// La tarjeta de Soporte (personal de la clínica)
// ───────────────────────────────────────────────────────────────────────────

/**
 * El estado del asistente para quien mira la tarjeta. `null` = no se muestra la
 * tarjeta: el asistente no existe en este servidor (404), el rol no lo usa o la
 * API no respondió (Soporte sigue funcionando sin ella).
 */
export async function getMiAsistente(): Promise<EstadoAsistente | null> {
    if (!(await esPersonal())) return null;
    const res = await callBackend('GET', '/support-bot/me');
    return res.ok ? (res.body as EstadoAsistente) : null;
}

/** Genera el código de la conversación (anula el anterior). */
export async function generarCodigoAsistente(): Promise<ResultadoAsistente<CodigoAsistente>> {
    if (!(await esPersonal())) return { ok: false, error: 'Acceso denegado' };
    const res = await callBackend('POST', '/support-bot/me/code');
    return res.ok ? { ok: true, data: res.body as CodigoAsistente } : { ok: false, error: res.message };
}

export async function cerrarConversacionAsistente(): Promise<ResultadoAsistente<EstadoAsistente>> {
    if (!(await esPersonal())) return { ok: false, error: 'Acceso denegado' };
    const res = await callBackend('POST', '/support-bot/me/close');
    return res.ok ? { ok: true, data: res.body as EstadoAsistente } : { ok: false, error: res.message };
}

export async function cambiarAvisosAsistente(activos: boolean): Promise<ResultadoAsistente<EstadoAsistente>> {
    if (!(await esPersonal())) return { ok: false, error: 'Acceso denegado' };
    const res = await callBackend('PUT', '/support-bot/me/notices', { activos });
    return res.ok ? { ok: true, data: res.body as EstadoAsistente } : { ok: false, error: res.message };
}

// ───────────────────────────────────────────────────────────────────────────
// La configuración (super admin)
// ───────────────────────────────────────────────────────────────────────────

function aConfig(res: BackendResponse): ResultadoConfigAsistente {
    if (res.ok) return { ok: true, config: res.body as ConfigAsistente };
    return {
        ok: false,
        apagado: res.status === 404,
        error:
            res.status === 404
                ? 'El asistente de soporte no está habilitado en este servidor (SUPPORT_BOT_ENABLED).'
                : res.message,
    };
}

export async function getConfigAsistente(): Promise<ResultadoConfigAsistente> {
    if (!(await esSuperAdmin())) return { ok: false, apagado: false, error: 'Acceso denegado' };
    return aConfig(await callBackend('GET', '/support-bot/admin/config'));
}

export async function conectarAsistente(botToken: string): Promise<ResultadoConfigAsistente> {
    if (!(await esSuperAdmin())) return { ok: false, apagado: false, error: 'Acceso denegado' };
    const r = aConfig(await callBackend('POST', '/support-bot/admin/connect', { botToken }));
    revalidatePath(RUTA_ADMIN);
    return r;
}

export async function desconectarAsistente(): Promise<ResultadoConfigAsistente> {
    if (!(await esSuperAdmin())) return { ok: false, apagado: false, error: 'Acceso denegado' };
    const r = aConfig(await callBackend('DELETE', '/support-bot/admin/connect'));
    revalidatePath(RUTA_ADMIN);
    return r;
}

export async function guardarAjustesAsistente(ajustes: AjustesAsistente): Promise<ResultadoConfigAsistente> {
    if (!(await esSuperAdmin())) return { ok: false, apagado: false, error: 'Acceso denegado' };
    const r = aConfig(await callBackend('PUT', '/support-bot/admin/config', ajustes));
    revalidatePath(RUTA_ADMIN);
    return r;
}

/** Código del super admin para probar el asistente como una clínica. */
export async function codigoDePruebaAsistente(
    organizationId: string,
): Promise<ResultadoAsistente<CodigoAsistente>> {
    if (!(await esSuperAdmin())) return { ok: false, error: 'Acceso denegado' };
    const res = await callBackend('POST', '/support-bot/admin/test-code', { organizationId });
    return res.ok ? { ok: true, data: res.body as CodigoAsistente } : { ok: false, error: res.message };
}
