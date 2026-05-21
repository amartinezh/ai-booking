'use server';

// Server actions para los diagnósticos de conectividad de integraciones.
// Solo funciones async — los tipos viven en `./integrations.types.ts`.

import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import type {
    GeminiDiagnosisResult,
    MetaDiagnosisResult,
} from './integrations.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

async function callBackend(path: string) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    let res: Response;
    try {
        res = await fetch(`${INTERNAL_API_URL}${path}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            cache: 'no-store',
        });
    } catch (e: any) {
        console.error(`[integrations] GET ${path} fetch error:`, e?.message ?? e);
        throw new Error(`No se pudo contactar al backend (${e?.message ?? 'network'}).`);
    }

    if (!res.ok) {
        const err = await res.text();
        console.error(`[integrations] GET ${path} -> ${res.status}: ${err}`);
        throw new Error(`Backend ${res.status}: ${err}`);
    }
    return res.json();
}

export async function diagnoseGemini(): Promise<GeminiDiagnosisResult> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        return {
            success: false,
            error_code: 'AUTH',
            error_message: 'Acceso denegado.',
        };
    }
    try {
        return (await callBackend('/integrations/diagnose/gemini')) as GeminiDiagnosisResult;
    } catch (e: any) {
        return {
            success: false,
            error_code: 'UNKNOWN',
            error_message: e?.message ?? 'Error desconocido contactando al backend.',
        };
    }
}

export async function diagnoseMeta(): Promise<MetaDiagnosisResult> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        return {
            success: false,
            error_code: 'AUTH',
            error_message: 'Acceso denegado.',
        };
    }
    try {
        return (await callBackend('/integrations/diagnose/meta')) as MetaDiagnosisResult;
    } catch (e: any) {
        return {
            success: false,
            error_code: 'UNKNOWN',
            error_message: e?.message ?? 'Error desconocido contactando al backend.',
        };
    }
}
