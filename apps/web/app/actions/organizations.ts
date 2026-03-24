'use server'

import { prisma } from '../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../lib/session';

export async function getOrganizations() {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    return prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createOrganization(data: { name: string; whatsappPhoneId?: string; logoUrl?: string }) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    
    try {
        await prisma.organization.create({
            data: {
                name: data.name,
                whatsappPhoneId: data.whatsappPhoneId || null,
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

export async function updateOrganization(id: string, data: { name: string; whatsappPhoneId?: string; logoUrl?: string }) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    
    try {
        await prisma.organization.update({
            where: { id },
            data: {
                name: data.name,
                whatsappPhoneId: data.whatsappPhoneId || null,
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
