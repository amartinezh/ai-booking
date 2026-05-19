'use server'

import { prisma } from '../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../lib/session';

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
