'use server'

import { cookies } from 'next/headers';
import { prisma } from '../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../lib/session';

// El backend NestJS expone las acciones críticas (purge / quick-stats).
// Reutilizamos la misma resolución de URL que el dashboard de Global Stats.
const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

async function authedHeaders() {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    return {
        'Content-Type': 'application/json',
        ...(token ? { Cookie: `auth_token=${token}` } : {}),
    };
}

export async function getOrganizations() {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    // Incluimos whatsappConfig para que el super-admin pueda ver el estado
    // del canal por clínica (read-only). Las credenciales reales las
    // configura el ORG_ADMIN desde su panel.
    const rows = await prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            whatsappConfig: {
                select: {
                    phoneNumberId: true,
                    displayPhoneNumber: true,
                    isActive: true,
                },
            },
        },
    });
    return rows;
}

export async function createOrganization(data: { name: string; logoUrl?: string }) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    try {
        await prisma.organization.create({
            data: {
                name: data.name,
                logoUrl: data.logoUrl || null,
            }
        });
        revalidatePath('/super-admin/organizations');
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function updateOrganization(id: string, data: { name: string; logoUrl?: string }) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    try {
        await prisma.organization.update({
            where: { id },
            data: {
                name: data.name,
                logoUrl: data.logoUrl || null,
            }
        });
        revalidatePath('/super-admin/organizations');
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function toggleOrganizationStatus(id: string, isActive: boolean) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    await prisma.organization.update({
        where: { id },
        data: { isActive }
    });
    revalidatePath('/super-admin/organizations');
    return { success: true };
}

// ─────────────────────────────────────────────────────────────
// 📊 RESUMEN RÁPIDO (quick-stats) — delega en el backend NestJS.
// ─────────────────────────────────────────────────────────────
export interface OrgQuickStats {
    organizationId: string;
    organizationName: string;
    metrics: {
        totalDoctors: number;
        totalPatients: number;
        totalSchedulers: number;
        totalScheduledAppointments: number;
        closedAppointmentsWithRecord: number;
        closedAppointmentsWithoutRecord: number;
        aiMessagesProcessed: number;
    };
}

export async function getOrganizationQuickStats(
    id: string,
): Promise<{ success: true; data: OrgQuickStats } | { success: false; error: string }> {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') return { success: false, error: 'Acceso denegado' };

    try {
        const headers = await authedHeaders();
        const res = await fetch(`${INTERNAL_API_URL}/organizations/${id}/quick-stats`, {
            headers,
            cache: 'no-store',
        });
        if (!res.ok) {
            const text = await res.text();
            return { success: false, error: `Backend ${res.status}: ${text}` };
        }
        const data = (await res.json()) as OrgQuickStats;
        return { success: true, data };
    } catch (e: any) {
        console.error('getOrganizationQuickStats error:', e);
        return { success: false, error: e?.message ?? 'Error de red al consultar estadísticas' };
    }
}

// ─────────────────────────────────────────────────────────────
// 🧨 PURGA (hard delete irreversible) — delega en el backend NestJS,
// que valida la clave de purga y ejecuta la transacción + auditoría.
// ─────────────────────────────────────────────────────────────
export async function purgeOrganization(
    id: string,
    purgePassword: string,
): Promise<{ success: true; purged: Record<string, number>; organizationName: string } | { success: false; error: string }> {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') return { success: false, error: 'Acceso denegado' };

    try {
        const headers = await authedHeaders();
        const res = await fetch(`${INTERNAL_API_URL}/organizations/${id}/purge`, {
            method: 'POST',
            headers,
            cache: 'no-store',
            body: JSON.stringify({ purgePassword }),
        });

        if (res.status === 401 || res.status === 403) {
            return { success: false, error: 'Clave de purga incorrecta o sesión no autorizada.' };
        }
        if (!res.ok) {
            const text = await res.text();
            return { success: false, error: `Backend ${res.status}: ${text}` };
        }

        const data = await res.json();
        revalidatePath('/super-admin/organizations');
        return { success: true, purged: data.purged ?? {}, organizationName: data.organizationName ?? '' };
    } catch (e: any) {
        console.error('purgeOrganization error:', e);
        return { success: false, error: e?.message ?? 'Error de red al ejecutar la purga' };
    }
}
