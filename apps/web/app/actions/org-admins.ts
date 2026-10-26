'use server'

import { prisma } from '../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../lib/session';
import bcrypt from 'bcryptjs';
import { getErrorMessage } from '../../lib/error';
import { validarClaveAsignada } from '../../lib/cuenta/clave';
import { registrarActividad } from '../../lib/actividad/registrar';

export async function getOrgAdmins(organizationId: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    return prisma.user.findMany({ 
        where: { organizationId, role: 'ORG_ADMIN' },
        select: { id: true, email: true, createdAt: true, role: true },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * Alta de un administrador de clínica por el super administrador. Desde el
 * 2026-10-26 la clave es obligatoria y cumple la regla de «Cambiar mi clave»
 * (antes, vacía, quedaba `admin123`), y el alta queda en la bitácora de la clínica.
 */
export async function createOrgAdmin(organizationId: string, email: string, password?: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    const correo = (email ?? '').trim();
    if (!correo) return { success: false, error: 'Escriba el correo del administrador.' };
    const problema = validarClaveAsignada(password, correo);
    if (problema) return { success: false, error: problema };

    const hashedPassword = await bcrypt.hash(password as string, 10);
    
    try {
        const creado = await prisma.user.create({
            data: {
                email: correo,
                password: hashedPassword,
                role: 'ORG_ADMIN',
                organizationId
            }
        });
        await registrarActividad({
            action: 'USER_CREATED',
            message: `Administrador de clínica creado por el super administrador (${correo})`,
            actor: { userId: session.userId, email: session.email, role: session.role },
            organizationId,
            metadata: {
                detalle: `Cuenta ${correo} como Administrador`,
                objetivo: { userId: creado.id, email: correo, role: 'ORG_ADMIN' },
            },
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
        const borrado = await prisma.user.delete({
            where: { id: userId, organizationId, role: 'ORG_ADMIN' }
        });
        await registrarActividad({
            action: 'USER_DELETED',
            level: 'WARNING',
            message: `Administrador de clínica eliminado por el super administrador (${borrado.email})`,
            actor: { userId: session.userId, email: session.email, role: session.role },
            organizationId,
            metadata: {
                detalle: `Cuenta ${borrado.email} (Administrador)`,
                objetivo: { userId: borrado.id, email: borrado.email, role: borrado.role },
            },
        });
        revalidatePath(`/super-admin/organizations/${organizationId}/admins`);
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: getErrorMessage(e) };
    }
}
