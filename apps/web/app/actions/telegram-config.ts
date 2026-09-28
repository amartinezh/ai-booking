'use server';

// Solo funciones async — los tipos viven en `./telegram-config.types.ts`.
// Canal de Telegram desde el panel (docs/PLAN_TELEGRAM.md §4.4).

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import type {
    PublicTelegramConfig,
    TelegramActionResult,
    TelegramCardState,
    TelegramWebhookStatus,
} from './telegram-config.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

/** Respuesta del backend: el cuerpo ya leído, o el motivo del fallo. */
type BackendResponse =
    | { ok: true; body: unknown }
    | { ok: false; status: number; message: string };

/**
 * Llama a la API reenviando la cookie de sesión. Nunca lanza: devuelve el
 * status para que quien llama distinga «Telegram apagado en el servidor»
 * (404) de un error de verdad.
 */
async function callBackend(
    method: 'GET' | 'POST' | 'DELETE',
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
        console.error(`[telegram-config] ${method} ${path} fetch error:`, msg);
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

    console.error(`[telegram-config] ${method} ${path} -> ${res.status}`);
    return { ok: false, status: res.status, message: backendMessage(parsed, res.status) };
}

/**
 * El mensaje legible de un error de la API. El filtro global de Nest lo anida
 * (`{ message: { message: '…' } }`); los mensajes de conectar están escritos
 * para la clínica («Telegram rechazó el token…») y se muestran tal cual.
 */
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

async function esAdmin(): Promise<boolean> {
    const session = await getSession();
    return !!session && session.role === 'ORG_ADMIN';
}

export async function getMyTelegramConfig(): Promise<TelegramCardState> {
    if (!(await esAdmin())) throw new Error('Acceso denegado');
    const res = await callBackend('GET', '/telegram-config');
    if (res.ok) return { enabled: true, config: res.body as PublicTelegramConfig };
    // Con TELEGRAM_ENABLED apagado la ruta no existe: la tarjeta lo explica.
    if (res.status === 404) return { enabled: false };
    throw new Error(res.message);
}

export async function connectMyTelegram(
    botToken: string,
): Promise<TelegramActionResult<PublicTelegramConfig>> {
    if (!(await esAdmin())) return { success: false, error: 'Acceso denegado' };
    const token = (botToken ?? '').trim();
    if (!token) return { success: false, error: 'Pegue el token que le dio @BotFather.' };
    const res = await callBackend('POST', '/telegram-config', { botToken: token });
    if (!res.ok) return { success: false, error: res.message };
    revalidatePath('/dashboard/configuracion');
    return { success: true, data: res.body as PublicTelegramConfig };
}

export async function verifyMyTelegram(): Promise<TelegramActionResult<TelegramWebhookStatus>> {
    if (!(await esAdmin())) return { success: false, error: 'Acceso denegado' };
    const res = await callBackend('POST', '/telegram-config/verify');
    if (!res.ok) return { success: false, error: res.message };
    revalidatePath('/dashboard/configuracion');
    return { success: true, data: res.body as TelegramWebhookStatus };
}

export async function disconnectMyTelegram(): Promise<TelegramActionResult<PublicTelegramConfig>> {
    if (!(await esAdmin())) return { success: false, error: 'Acceso denegado' };
    const res = await callBackend('DELETE', '/telegram-config');
    if (!res.ok) return { success: false, error: res.message };
    revalidatePath('/dashboard/configuracion');
    return { success: true, data: res.body as PublicTelegramConfig };
}
