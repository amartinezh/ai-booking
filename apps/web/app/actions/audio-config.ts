'use server';

// Server actions para la Configuración de Voz/Audio (TTS) por clínica.
// Solo funciones async — los tipos viven en `./audio-config.types.ts`.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import type {
    AudioDiagnosisResult,
    PublicAudioConfig,
    SaveAudioConfigInput,
} from './audio-config.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

async function callBackend(
    method: 'GET' | 'PUT',
    path: string,
    body?: unknown,
) {
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
        console.error(`[audio-config] ${method} ${path} fetch error:`, e?.message ?? e);
        throw new Error(`No se pudo contactar al backend (${e?.message ?? 'network'}).`);
    }

    if (!res.ok) {
        const err = await res.text();
        console.error(`[audio-config] ${method} ${path} -> ${res.status}: ${err}`);
        throw new Error(`Backend ${res.status}: ${err}`);
    }
    return res.json();
}

/** Resuelve y valida que la sesión sea un ORG_ADMIN con organización. */
async function requireOrgAdmin(): Promise<string> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
        throw new Error('Acceso denegado');
    }
    return session.organizationId;
}

export async function getMyAudioConfig(): Promise<PublicAudioConfig> {
    const orgId = await requireOrgAdmin();
    return callBackend('GET', `/organizations/${orgId}/audio-config`);
}

export async function updateMyAudioConfig(
    input: SaveAudioConfigInput,
): Promise<
    | { success: true; data: PublicAudioConfig }
    | { success: false; error: string }
> {
    let orgId: string;
    try {
        orgId = await requireOrgAdmin();
    } catch (e: any) {
        return { success: false, error: e.message };
    }
    try {
        const data = await callBackend(
            'PUT',
            `/organizations/${orgId}/audio-config`,
            input,
        );
        revalidatePath('/dashboard/configuracion');
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function diagnoseAudio(): Promise<AudioDiagnosisResult> {
    let orgId: string;
    try {
        orgId = await requireOrgAdmin();
    } catch {
        return {
            success: false,
            error_code: 'AUTH',
            error_message: 'Acceso denegado.',
        };
    }
    try {
        return (await callBackend(
            'GET',
            `/organizations/${orgId}/audio-config/diagnose`,
        )) as AudioDiagnosisResult;
    } catch (e: any) {
        return {
            success: false,
            error_code: 'UNKNOWN',
            error_message: e?.message ?? 'Error desconocido contactando al backend.',
        };
    }
}
