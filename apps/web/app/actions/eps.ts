'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { Prisma } from '@agenia/database';
import { actorDeSesion, registrarActividad, type ActorDeLaActividad } from '@/lib/actividad/registrar';
import { listarCambios } from '@/lib/actividad/catalogo';

/**
 * 🔐 2026-10-27: la pantalla de Aseguradoras es del administrador, pero estas
 * acciones aceptaban cualquier sesión de la clínica. Una EPS inactiva o borrada
 * cambia a quién puede agendar el asistente, así que ahora solo ORG_ADMIN, y cada
 * cambio queda en la Actividad de usuarios.
 */
async function administrador(): Promise<{ organizationId: string; quien: ActorDeLaActividad } | null> {
    const session = await getSession();
    if (session?.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    return { organizationId: session.organizationId, quien: actorDeSesion(session) };
}

const MSG_SIN_PERMISO = 'Solo el administrador de la clínica puede gestionar las EPS.';

const formSchema = z.object({
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
    nit: z.string().min(5, 'El NIT debe ser válido').optional().or(z.literal('')),
    isActive: z.boolean().default(true),
});

export async function getEpsList(query?: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const whereObj: Prisma.EpsWhereInput = { organizationId: session.organizationId };
        if (query) {
            whereObj.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { nit: { contains: query, mode: 'insensitive' } },
            ];
        }

        const data = await prisma.eps.findMany({
            where: whereObj,
            include: {
                _count: {
                    select: { patients: true, appointments: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return { success: true, data };
    } catch (error) {
        console.error('Error fetching EPS:', error);
        return { success: false, error: 'Error al obtener la lista de EPS' };
    }
}

export async function createEps(prevState: unknown, formData: FormData) {
    try {
        const validatedFields = formSchema.safeParse({
            name: formData.get('name'),
            nit: formData.get('nit'),
            isActive: formData.get('isActive') === 'on',
        });

        if (!validatedFields.success) {
            return { success: false, error: 'Datos inválidos', issues: validatedFields.error.flatten().fieldErrors };
        }

        const admin = await administrador();
        if (!admin) return { success: false, error: MSG_SIN_PERMISO };

        const creada = await prisma.eps.create({
            data: {
                name: validatedFields.data.name,
                nit: validatedFields.data.nit || null,
                isActive: validatedFields.data.isActive,
                organizationId: admin.organizationId
            },
        });
        await registrarActividad({
            action: 'EPS_CREATED',
            message: `EPS creada: ${creada.name}`,
            actor: admin.quien,
            organizationId: admin.organizationId,
            metadata: {
                detalle: [`«${creada.name}»`, creada.nit ? `NIT ${creada.nit}` : 'sin NIT', creada.isActive ? null : 'inactiva']
                    .filter(Boolean)
                    .join(' · '),
                eps: creada.id,
            },
        });

        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error creating EPS:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { success: false, error: 'Ya existe una EPS con ese nombre o NIT en esta clínica.' };
        }
        return { success: false, error: 'Ocurrió un error al crear la EPS' };
    }
}

export async function updateEps(id: string, prevState: unknown, formData: FormData) {
    try {
        const validatedFields = formSchema.safeParse({
            name: formData.get('name'),
            nit: formData.get('nit'),
            isActive: formData.get('isActive') === 'on',
        });

        if (!validatedFields.success) {
            return { success: false, error: 'Datos inválidos' };
        }

        const admin = await administrador();
        if (!admin) return { success: false, error: MSG_SIN_PERMISO };

        const antes = await prisma.eps.findFirst({
            where: { id, organizationId: admin.organizationId },
            select: { name: true, nit: true, isActive: true },
        });
        const despues = {
            name: validatedFields.data.name,
            nit: validatedFields.data.nit || null,
            isActive: validatedFields.data.isActive,
        };
        await prisma.eps.update({ where: { id, organizationId: admin.organizationId }, data: despues });
        const cambios = antes ? listarCambios(antes, despues, { name: 'nombre', nit: 'NIT', isActive: 'activa' }) : [];
        await registrarActividad({
            action: 'EPS_UPDATED',
            level: antes && antes.isActive !== despues.isActive ? 'WARNING' : 'EVENT',
            message: `EPS modificada: ${despues.name}`,
            actor: admin.quien,
            organizationId: admin.organizationId,
            metadata: { detalle: `«${despues.name}»: ${cambios.length ? cambios.join(' · ') : 'sin cambios'}`, eps: id },
        });

        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error updating EPS:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { success: false, error: 'Ya existe una EPS con ese nombre o NIT en esta clínica.' };
        }
        return { success: false, error: 'Ocurrió un error al actualizar' };
    }
}

export async function toggleEpsStatus(id: string, currentStatus: boolean) {
    try {
        const admin = await administrador();
        if (!admin) return { success: false, error: MSG_SIN_PERMISO };

        const eps = await prisma.eps.update({
            where: { id, organizationId: admin.organizationId },
            data: { isActive: !currentStatus },
            select: { name: true, isActive: true },
        });
        await registrarActividad({
            action: eps.isActive ? 'EPS_ACTIVATED' : 'EPS_DEACTIVATED',
            level: eps.isActive ? 'EVENT' : 'WARNING',
            message: `EPS ${eps.isActive ? 'activada' : 'inactivada'}: ${eps.name}`,
            actor: admin.quien,
            organizationId: admin.organizationId,
            metadata: { detalle: `«${eps.name}»`, eps: id },
        });
        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error toggling EPS status:', error);
        return { success: false, error: 'Error al cambiar el estado' };
    }
}

export async function deleteEps(id: string) {
    try {
        const admin = await administrador();
        if (!admin) return { success: false, error: MSG_SIN_PERMISO };

        // Validar si tiene pacientes o citas atadas
        const eps = await prisma.eps.findFirst({
            where: { id, organizationId: admin.organizationId },
            include: {
                _count: {
                    select: { patients: true, appointments: true },
                },
            },
        });

        if (!eps) return { success: false, error: 'EPS no encontrada' };

        if (eps._count.patients > 0 || eps._count.appointments > 0) {
            return {
                success: false,
                error: `No se puede eliminar. Tiene ${eps._count.patients} pacientes y/o ${eps._count.appointments} citas asociadas. Puede inactivarla.`
            };
        }

        await prisma.eps.delete({ where: { id } });
        await registrarActividad({
            action: 'EPS_DELETED',
            level: 'WARNING',
            message: `EPS eliminada: ${eps.name}`,
            actor: admin.quien,
            organizationId: admin.organizationId,
            metadata: { detalle: `«${eps.name}»${eps.nit ? ` · NIT ${eps.nit}` : ''}`, eps: id },
        });
        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error deleting EPS:', error);
        return { success: false, error: 'Error al eliminar la EPS' };
    }
}
