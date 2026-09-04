'use server'

import { prisma } from '../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../lib/session';
import bcrypt from 'bcryptjs';
import { getErrorMessage } from '../../lib/error';

export async function getOrgAdmins(organizationId: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    return prisma.user.findMany({ 
        where: { organizationId, role: 'ORG_ADMIN' },
        select: { id: true, email: true, createdAt: true, role: true },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createOrgAdmin(organizationId: string, email: string, password?: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    const hashedPassword = await bcrypt.hash(password || 'admin123', 10);
    
    try {
        await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                role: 'ORG_ADMIN',
                organizationId
            }
        });
        revalidatePath(`/super-admin/organizations/${organizationId}/admins`);
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Es posible que este correo ya exista. ' + getErrorMessage(e) };
    }
}

export async function deleteOrgAdmin(organizationId: string, userId: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    
    try {
        await prisma.user.delete({
            where: { id: userId, organizationId, role: 'ORG_ADMIN' }
        });
        revalidatePath(`/super-admin/organizations/${organizationId}/admins`);
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: getErrorMessage(e) };
    }
}
