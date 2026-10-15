'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { Prisma } from '@agenia/database';
import { SYNC_AUDIT_DIRECTION } from '@agenia/shared';

/**
 * 🩺 Crear, activar/inactivar y borrar servicios: solo ORG_ADMIN (la misma
 * regla que la pantalla). «Activo» ya no es solo el menú del asistente: decide
 * con qué citas trabaja AgenIA (recordatorios, respuestas, cancelar, cambiar la
 * fecha), así que una acción de servidor abierta a cualquier sesión de la clínica
 * no podía seguir así.
 */
async function tenantAdmin(): Promise<{ organizationId: string; actor: string } | null> {
    const session = await getSession();
    if (session?.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    return { organizationId: session.organizationId, actor: session.email ?? session.userId };
}

const formSchema = z.object({
    name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    isActive: z.boolean().default(true),
});

export async function getMedicalServicesList(query?: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const whereObj: Prisma.MedicalServiceWhereInput = { organizationId: session.organizationId };
        if (query) {
            whereObj.name = { contains: query, mode: 'insensitive' };
        }

        const data = await prisma.medicalService.findMany({
            where: whereObj,
            include: {
                _count: {
                    select: { doctors: true, slots: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return { success: true, data };
    } catch (error) {
        console.error('Error fetching Medical Services:', error);
        return { success: false, error: 'Error al obtener la lista de servicios médicos' };
    }
}

export async function createMedicalService(prevState: unknown, formData: FormData) {
    try {
        const validatedFields = formSchema.safeParse({
            name: formData.get('name'),
            isActive: formData.get('isActive') === 'on',
        });

        if (!validatedFields.success) {
            return { success: false, error: 'Datos inválidos', issues: validatedFields.error.flatten().fieldErrors };
        }

        const admin = await tenantAdmin();
        if (!admin) return { success: false, error: 'Sin permisos.' };

        await prisma.medicalService.create({
            data: {
                name: validatedFields.data.name,
                isActive: validatedFields.data.isActive,
                organizationId: admin.organizationId
            },
        });

        revalidatePath('/dashboard/servicios');
        return { success: true };
    } catch (error) {
        console.error('Error creating Medical Service:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { success: false, error: 'Ya existe un servicio con ese nombre en esta clínica.' };
        }
        return { success: false, error: 'Ocurrió un error al crear el servicio médico' };
    }
}

export async function toggleMedicalServiceStatus(id: string, currentStatus: boolean) {
    try {
        const admin = await tenantAdmin();
        if (!admin) return { success: false, error: 'Sin permisos.' };

        const servicio = await prisma.medicalService.update({
            where: { id, organizationId: admin.organizationId },
            data: { isActive: !currentStatus },
            select: { name: true, isActive: true },
        });
        // Con espejo, que quede quién cambió con qué citas trabaja AgenIA.
        const espejo = await prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId: admin.organizationId },
            select: { enabled: true },
        });
        if (espejo?.enabled) {
            await prisma.syncAudit.create({
                data: {
                    organizationId: admin.organizationId,
                    direction: SYNC_AUDIT_DIRECTION.CONFIG,
                    entityType: 'MedicalService',
                    entityId: id,
                    op: 'SERVICE_ACTIVE_CHANGE',
                    outcome: 'OK',
                    detail:
                        `«${servicio.name}» ${servicio.isActive ? 'ACTIVADO' : 'INACTIVADO'} por ${admin.actor}: ` +
                        `AgenIA ${servicio.isActive ? 'trabaja' : 'deja de trabajar'} con sus citas ` +
                        '(recordatorios, respuestas del asistente, cancelar y cambiar la fecha).',
                },
            });
        }
        revalidatePath('/dashboard/servicios');
        return { success: true };
    } catch (error) {
        console.error('Error toggling Service status:', error);
        return { success: false, error: 'Error al cambiar el estado del servicio' };
    }
}

export async function deleteMedicalService(id: string) {
    try {
        const admin = await tenantAdmin();
        if (!admin) return { success: false, error: 'Sin permisos.' };

        const service = await prisma.medicalService.findFirst({
            where: { id, organizationId: admin.organizationId },
            include: {
                _count: {
                    select: { doctors: true, slots: true },
                },
            },
        });

        if (!service) return { success: false, error: 'Servicio no encontrado' };

        if (service._count.doctors > 0 || service._count.slots > 0) {
            return {
                success: false,
                error: `No se puede eliminar. Tiene ${service._count.doctors} médicos asignados y/o ${service._count.slots} slots de agenda. Por favor inactívelo.`
            };
        }

        await prisma.medicalService.delete({ where: { id } });
        revalidatePath('/dashboard/servicios');
        return { success: true };
    } catch (error) {
        console.error('Error deleting Service:', error);
        return { success: false, error: 'Error al eliminar el servicio' };
    }
}
