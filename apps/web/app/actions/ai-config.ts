'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';

export type LlmProvider = 'GEMINI' | 'CHATGPT' | 'CLAUDE' | 'NONE';

export interface PublicAiConfig {
    activeProvider: LlmProvider;
    model: string | null;
    hasApiKey: boolean;
    apiKeyLast4: string | null;
    openaiOrganizationId: string | null;
    updatedAt: string | null;
}

export interface SaveAiConfigInput {
    activeProvider: LlmProvider;
    apiKey?: string;
    model?: string;
    openaiOrganizationId?: string;
}

/**
 * Catálogo público (estático) de modelos por proveedor. Idéntico al expuesto
 * por el backend `/ai-config/catalog`, replicado aquí para evitar un round-trip
 * extra al renderizar la página.
 */
export const PROVIDER_MODELS: Record<Exclude<LlmProvider, 'NONE'>, string[]> = {
    GEMINI: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash'],
    CHATGPT: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    CLAUDE: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'],
};

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3001';

async function callBackend(method: 'GET' | 'POST', path: string, body?: unknown) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    const res = await fetch(`${INTERNAL_API_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Cookie: `auth_token=${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
    });

    if (!res.ok) {
        const err = await res.text();
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
