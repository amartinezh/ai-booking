/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/session';

const formSchema = z.object({
    name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    isActive: z.boolean().default(true),
});

export async function getMedicalServicesList(query?: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const whereObj: any = { organizationId: session.organizationId };
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

export async function createMedicalService(prevState: any, formData: FormData) {
    try {
        const validatedFields = formSchema.safeParse({
            name: formData.get('name'),
            isActive: formData.get('isActive') === 'on',
        });

        if (!validatedFields.success) {
            return { success: false, error: 'Datos inválidos', issues: validatedFields.error.flatten().fieldErrors };
        }

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        await prisma.medicalService.create({
            data: {
                name: validatedFields.data.name,
                isActive: validatedFields.data.isActive,
                organizationId: session.organizationId
            },
        });

        revalidatePath('/dashboard/servicios');
        return { success: true };
    } catch (error) {
        console.error('Error creating Medical Service:', error);
        return { success: false, error: 'Ocurrió un error al crear el servicio médico' };
    }
}

export async function toggleMedicalServiceStatus(id: string, currentStatus: boolean) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        await prisma.medicalService.update({
            where: { id, organizationId: session.organizationId },
            data: { isActive: !currentStatus },
        });
        revalidatePath('/dashboard/servicios');
        return { success: true };
    } catch (error) {
        console.error('Error toggling Service status:', error);
        return { success: false, error: 'Error al cambiar el estado del servicio' };
    }
}

export async function deleteMedicalService(id: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const service = await prisma.medicalService.findFirst({
            where: { id, organizationId: session.organizationId },
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
