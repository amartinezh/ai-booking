'use server';

// Solo funciones async — los tipos viven en `./whatsapp-config.types.ts`.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import type {
    PublicWhatsappConfig,
    SaveWhatsappConfigInput,
} from './whatsapp-config.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

async function callBackend(method: 'GET' | 'POST', path: string, body?: unknown) {
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
    } catch (e: any) {
        console.error(`[whatsapp-config] ${method} ${path} fetch error:`, e?.message ?? e);
        throw new Error(`No se pudo contactar al backend (${e?.message ?? 'network'}).`);
    }

    if (!res.ok) {
        const err = await res.text();
        console.error(`[whatsapp-config] ${method} ${path} -> ${res.status}: ${err}`);
        throw new Error(`Backend ${res.status}: ${err}`);
    }
    return res.json();
}

export async function getMyWhatsappConfig(): Promise<PublicWhatsappConfig> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        throw new Error('Acceso denegado');
    }
    return callBackend('GET', '/whatsapp-config');
}

export async function updateMyWhatsappConfig(
    input: SaveWhatsappConfigInput,
): Promise<
    | { success: true; data: PublicWhatsappConfig }
    | { success: false; error: string }
> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        return { success: false, error: 'Acceso denegado' };
    }
    try {
        const data = await callBackend('POST', '/whatsapp-config', input);
        revalidatePath('/dashboard/configuracion');
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
