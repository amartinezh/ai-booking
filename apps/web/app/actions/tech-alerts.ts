'use server';

// Solo funciones async — los tipos viven en `./tech-alerts.types.ts`.
// 🚨 Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md §3.8): el canal
// del SUPER_ADMIN con el equipo técnico. Cada acción comprueba el rol aquí Y la
// API lo vuelve a exigir (@Roles('SUPER_ADMIN')).

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import type {
    PublicTechAlertConfig,
    TechAlertActionResult,
    TechAlertLinkResult,
    TechAlertListResult,
    TechAlertSettings,
} from './tech-alerts.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

const RUTA = '/super-admin/alertas';

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
        console.error(`[tech-alerts] ${method} ${path} fetch error:`, msg);
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

    console.error(`[tech-alerts] ${method} ${path} -> ${res.status}`);
    return { ok: false, status: res.status, message: backendMessage(parsed, res.status) };
}

/** El mensaje legible de un error de la API (el filtro global de Nest lo anida). */
function backendMessage(parsed: unknown, status: number): string {
    const outer = (parsed as { message?: unknown } | null)?.message;
    const inner =
        typeof outer === 'object' && outer !== null
            ? (outer as { message?: unknown }).message
            : outer;
    if (typeof inner === 'string' && inner.trim()) return inner;
    if (Array.isArray(inner) && typeof inner[0] === 'string') return inner[0];
    return `El servidor respondió ${status}.`;
}

async function esSuperAdmin(): Promise<boolean> {
    const session = await getSession();
    return !!session && session.role === 'SUPER_ADMIN';
}

const DENEGADO = { success: false as const, error: 'Acceso denegado' };

async function accion<T>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
): Promise<TechAlertActionResult<T>> {
    if (!(await esSuperAdmin())) return DENEGADO;
    const res = await callBackend(method, path, body);
    if (!res.ok) return { success: false, error: res.message };
    revalidatePath(RUTA);
    return { success: true, data: res.body as T };
}

export async function getTechAlertConfig(): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    if (!(await esSuperAdmin())) return DENEGADO;
    const res = await callBackend('GET', '/tech-alerts/config');
    if (!res.ok) return { success: false, error: res.message };
    return { success: true, data: res.body as PublicTechAlertConfig };
}

export async function listTechAlerts(
    status?: string,
): Promise<TechAlertListResult> {
    if (!(await esSuperAdmin())) return { rows: [], total: 0 };
    const params = new URLSearchParams({ limit: '50' });
    if (status) params.set('status', status);
    const res = await callBackend('GET', `/tech-alerts?${params.toString()}`);
    return res.ok ? (res.body as TechAlertListResult) : { rows: [], total: 0 };
}

export async function connectTechAlertBot(
    botToken: string,
): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    const token = (botToken ?? '').trim();
    if (!token) return { success: false, error: 'Pegue el token que le dio @BotFather.' };
    return accion('POST', '/tech-alerts/connect', { botToken: token });
}

export async function disconnectTechAlertBot(): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    return accion('DELETE', '/tech-alerts/connect');
}

export async function startTechAlertLink(): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    return accion('POST', '/tech-alerts/link');
}

export async function findTechAlertLink(): Promise<TechAlertActionResult<TechAlertLinkResult>> {
    return accion('POST', '/tech-alerts/link/find');
}

export async function updateTechAlertSettings(
    settings: TechAlertSettings,
): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    return accion('PUT', '/tech-alerts/config', settings);
}

export async function muteTechAlerts(
    opcion: string,
): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    return accion('POST', '/tech-alerts/mute', { opcion });
}

export async function unmuteTechAlerts(): Promise<TechAlertActionResult<PublicTechAlertConfig>> {
    return accion('DELETE', '/tech-alerts/mute');
}

/** «Enviar mensaje de prueba». La API responde `{ ok, error? }`. */
export async function sendTechAlertTest(): Promise<TechAlertActionResult<{ ok: boolean; error?: string }>> {
    return accion('POST', '/tech-alerts/test');
}
