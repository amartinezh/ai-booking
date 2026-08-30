'use server';

// Solo funciones async — los tipos viven en `./whatsapp-templates.types.ts`.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import type {
    WhatsappTemplateDto,
    WhatsappTemplateKind,
    SaveWhatsappTemplateInput,
} from './whatsapp-templates.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

async function callBackend(
    method: 'GET' | 'POST' | 'DELETE',
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
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[whatsapp-templates] ${method} ${path} fetch error:`, msg);
        throw new Error(`No se pudo contactar al backend (${msg || 'network'}).`);
    }

    if (!res.ok) {
        const err = await res.text();
        console.error(`[whatsapp-templates] ${method} ${path} -> ${res.status}: ${err}`);
        throw new Error(`Backend ${res.status}: ${err}`);
    }
    return res.json();
}

export async function getMyWhatsappTemplates(): Promise<WhatsappTemplateDto[]> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        throw new Error('Acceso denegado');
    }
    return callBackend('GET', '/whatsapp-config/templates');
}

export async function saveMyWhatsappTemplate(
    input: SaveWhatsappTemplateInput,
): Promise<{ success: true; data: WhatsappTemplateDto } | { success: false; error: string }> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        return { success: false, error: 'Acceso denegado' };
    }
    try {
        const data = await callBackend('POST', '/whatsapp-config/templates', input);
        revalidatePath('/dashboard/configuracion');
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function deleteMyWhatsappTemplate(
    kind: WhatsappTemplateKind,
): Promise<{ success: true } | { success: false; error: string }> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') {
        return { success: false, error: 'Acceso denegado' };
    }
    try {
        await callBackend('DELETE', `/whatsapp-config/templates/${kind}`);
        revalidatePath('/dashboard/configuracion');
        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}
