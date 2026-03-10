/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const formSchema = z.object({
    name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    isActive: z.boolean().default(true),
});

export async function getMedicalServicesList(query?: string) {
    try {
        const data = await prisma.medicalService.findMany({
            where: query
                ? { name: { contains: query, mode: 'insensitive' } }
                : undefined,
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

        await prisma.medicalService.create({
            data: {
                name: validatedFields.data.name,
                isActive: validatedFields.data.isActive,
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
        await prisma.medicalService.update({
            where: { id },
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
        const service = await prisma.medicalService.findUnique({
            where: { id },
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
