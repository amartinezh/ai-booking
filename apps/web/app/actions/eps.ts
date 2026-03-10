/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const formSchema = z.object({
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
    nit: z.string().min(5, 'El NIT debe ser válido').optional().or(z.literal('')),
    isActive: z.boolean().default(true),
});

export async function getEpsList(query?: string) {
    try {
        const data = await prisma.eps.findMany({
            where: query
                ? {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { nit: { contains: query, mode: 'insensitive' } },
                    ],
                }
                : undefined,
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

export async function createEps(prevState: any, formData: FormData) {
    try {
        const validatedFields = formSchema.safeParse({
            name: formData.get('name'),
            nit: formData.get('nit'),
            isActive: formData.get('isActive') === 'on',
        });

        if (!validatedFields.success) {
            return { success: false, error: 'Datos inválidos', issues: validatedFields.error.flatten().fieldErrors };
        }

        await prisma.eps.create({
            data: {
                name: validatedFields.data.name,
                nit: validatedFields.data.nit || null,
                isActive: validatedFields.data.isActive,
            },
        });

        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error creating EPS:', error);
        return { success: false, error: 'Ocurrió un error al crear la EPS' };
    }
}

export async function updateEps(id: string, prevState: any, formData: FormData) {
    try {
        const validatedFields = formSchema.safeParse({
            name: formData.get('name'),
            nit: formData.get('nit'),
            isActive: formData.get('isActive') === 'on',
        });

        if (!validatedFields.success) {
            return { success: false, error: 'Datos inválidos' };
        }

        await prisma.eps.update({
            where: { id },
            data: {
                name: validatedFields.data.name,
                nit: validatedFields.data.nit || null,
                isActive: validatedFields.data.isActive,
            },
        });

        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error updating EPS:', error);
        return { success: false, error: 'Ocurrió un error al actualizar' };
    }
}

export async function toggleEpsStatus(id: string, currentStatus: boolean) {
    try {
        await prisma.eps.update({
            where: { id },
            data: { isActive: !currentStatus },
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
        // Validar si tiene pacientes o citas atadas
        const eps = await prisma.eps.findUnique({
            where: { id },
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
        revalidatePath('/dashboard/eps');
        return { success: true };
    } catch (error) {
        console.error('Error deleting EPS:', error);
        return { success: false, error: 'Error al eliminar la EPS' };
    }
}
