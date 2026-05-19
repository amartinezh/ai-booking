'use server';

// IMPORTANTE: Next.js 16 exige que los archivos `'use server'` SOLO exporten
// funciones async. Tipos y constantes viven en `./ai-config.types.ts`.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import type {
    PublicAiConfig,
    SaveAiConfigInput,
} from './ai-config.types';

// Resolución de URL hacia el backend NestJS:
//   1. INTERNAL_API_URL (override explícito).
//   2. NEXT_PUBLIC_API_URL (lo que docker-compose.prod.yml ya inyecta como
//      `http://api:3000`, red interna Docker).
//   3. http://localhost:3001 (dev local, donde la API arranca por defecto).
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
        // Falla de red: el contenedor api no responde, DNS interno caído, etc.
        // Logueamos para que aparezca en PM2/Docker logs aún en producción.
        console.error(`[ai-config] ${method} ${path} fetch error:`, e?.message ?? e);
        throw new Error(`No se pudo contactar al backend (${e?.message ?? 'network'}).`);
    }

    if (!res.ok) {
        const err = await res.text();
        console.error(`[ai-config] ${method} ${path} -> ${res.status}: ${err}`);
        throw new Error(`Backend ${res.status}: ${err}`);
    }
    return res.json();
}

export async function getMyAiConfig(): Promise<PublicAiConfig> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        throw new Error('Acceso denegado');
    }
    return callBackend('GET', '/ai-config');
}

export async function updateMyAiConfig(
    input: SaveAiConfigInput,
): Promise<{ success: true; data: PublicAiConfig } | { success: false; error: string }> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        return { success: false, error: 'Acceso denegado' };
    }
    try {
        const data = await callBackend('POST', '/ai-config', input);
        revalidatePath('/dashboard/configuracion');
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
