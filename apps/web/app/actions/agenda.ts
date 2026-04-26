/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';

export async function getAgendaDependencies() {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };
        const doctors = await prisma.doctorProfile.findMany({
            where: { isActive: true, organizationId: session.organizationId },
            include: { service: true },
            orderBy: { fullName: 'asc' },
        });

        const epsList = await prisma.eps.findMany({
            where: { isActive: true, organizationId: session.organizationId },
            orderBy: { name: 'asc' },
        });

        return { success: true, data: { doctors, epsList } };
    } catch (error) {
        console.error('Error fetching dependencies:', error);
        return { success: false, error: 'Error cargando catálogos de agendas' };
    }
}

export async function getUpcomingSlots(doctorId?: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        // Expandimos 30 días al pasado para que el visualizador de semana/mes cargue contexto histórico
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        const whereClause: any = { startTime: { gte: thirtyDaysAgo }, organizationId: session.organizationId };
        if (doctorId) whereClause.doctorId = doctorId;

        const slots = await prisma.scheduleSlot.findMany({
            where: whereClause,
            include: {
                doctor: true,
                service: true,
                allowedEps: true,
                appointment: true,
            },
            orderBy: { startTime: 'asc' },
            take: 3000, // Límite expansivo para vistas mensuales pesadas
        });
        return { success: true, data: slots };
    } catch (error) {
        console.error('Error fetching slots:', error);
        return { success: false, error: 'Error obteniendo cupos creados' };
    }
}

export async function generateBulkSlots(formData: FormData) {
    try {
        const doctorId = formData.get('doctorId') as string;
        const epsId = formData.get('epsId') as string; // 'none' para universal
        const dateStr = formData.get('date') as string;
        const startTimeStr = formData.get('startTime') as string;
        const endTimeStr = formData.get('endTime') as string;
        const durationMin = parseInt(formData.get('durationMinutes') as string);

        if (!doctorId || !dateStr || !startTimeStr || !endTimeStr || !durationMin) {
            return { success: false, error: 'Faltan campos obligatorios' };
        }

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const doctor = await prisma.doctorProfile.findFirst({
            where: { id: doctorId, organizationId: session.organizationId },
        });

        if (!doctor || !doctor.serviceId) {
            return { success: false, error: 'Médico inválido o sin servicio configurado' };
        }

        // Convertir tiempos a la zona horaria local simulada en Date
        const startDateTime = new Date(`${dateStr}T${startTimeStr}:00`);
        const endDateTime = new Date(`${dateStr}T${endTimeStr}:00`);

        if (startDateTime >= endDateTime) {
            return { success: false, error: 'La hora de inicio debe ser menor a la hora de fin' };
        }

        const slotsToCreate = [];
        let currentSlotStart = new Date(startDateTime);

        // Iterador para generar bloques
        while (currentSlotStart < endDateTime) {
            const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMin * 60000);

            // Solo registrar si el bloque cabe completo antes del fin de turno
            if (currentSlotEnd <= endDateTime) {
                slotsToCreate.push({
                    startTime: currentSlotStart,
                    endTime: currentSlotEnd,
                    doctorId,
                    serviceId: doctor.serviceId,
                    allowedEpsId: epsId === 'none' ? null : epsId,
                    isAvailable: true,
                    organizationId: session.organizationId
                });
            }

            currentSlotStart = currentSlotEnd;
        }

        if (slotsToCreate.length === 0) {
            return { success: false, error: 'El rango de tiempo es muy corto para generar al menos un cupo de esa duración' };
        }

        // Ejecutar creación masiva ignorando colisiones uno por uno
        let createdCount = 0;
        for (const slot of slotsToCreate) {
            try {
                await prisma.scheduleSlot.create({ data: slot });
                createdCount++;
            } catch (e: any) {
                // P2002 Unique constraint failed (ya existe un slot a esa hora para ese doc)
                if (e.code === 'P2002') continue;
                throw e;
            }
        }

        revalidatePath('/dashboard/agenda');
        return {
            success: true,
            message: `Generación exitosa. Se abrieron ${createdCount} cupos en la agenda. ${slotsToCreate.length - createdCount} colisiones omitidas.`
        };

    } catch (error) {
        console.error('Error bulk slot generator:', error);
        return { success: false, error: 'Error crítico de servidor al generar slots' };
    }
}

export async function deleteSlot(id: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const slot = await prisma.scheduleSlot.findFirst({ where: { id, organizationId: session.organizationId }, include: { appointment: true } });
        if (slot?.appointment) {
            return { success: false, error: 'Este cupo ya fue reservado por un paciente. Cancele la cita primero.' };
        }
        await prisma.scheduleSlot.delete({ where: { id, organizationId: session.organizationId } });
        revalidatePath('/dashboard/agenda');
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Error eliminando el cupo' };
    }
}

export async function cloneDaySlots(formData: FormData) {
    try {
        const doctorId = formData.get('doctorId') as string;
        const sourceDateStr = formData.get('sourceDate') as string; // 'YYYY-MM-DD'
        const targetDateStr = formData.get('targetDate') as string; // 'YYYY-MM-DD'

        if (!doctorId || !sourceDateStr || !targetDateStr) {
            return { success: false, error: 'Faltan campos (Doctor, Fecha Origen, Fecha Destino)' };
        }

        // 1. Obtener todos los slots del doctor en sourceDate
        const sourceStart = new Date(`${sourceDateStr}T00:00:00`);
        const sourceEnd = new Date(`${sourceDateStr}T23:59:59`);

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const sourceSlots = await prisma.scheduleSlot.findMany({
            where: {
                doctorId,
                organizationId: session.organizationId,
                startTime: {
                    gte: sourceStart,
                    lte: sourceEnd,
                }
            }
        });

        if (sourceSlots.length === 0) {
            return { success: false, error: 'No se encontraron agendas en la fecha de origen para clonar.' };
        }

        // 2. Calcular diferencia en milisegundos entre targetDate y sourceDate
        const targetStart = new Date(`${targetDateStr}T00:00:00`);
        const timeOffset = targetStart.getTime() - sourceStart.getTime();

        if (timeOffset === 0) {
            return { success: false, error: 'La fecha origen y destino no pueden ser la misma.' };
        }

        // 3. Preparar array de nuevos slots desplazados en el tiempo
        const slotsToCreate = sourceSlots.map(slot => ({
            doctorId: slot.doctorId,
            serviceId: slot.serviceId,
            allowedEpsId: slot.allowedEpsId,
            isAvailable: true, // Siempre nacen disponibles
            organizationId: session.organizationId,
            startTime: new Date(slot.startTime.getTime() + timeOffset),
            endTime: new Date(slot.endTime.getTime() + timeOffset)
        }));

        // 4. Inserción masiva ignorando colisiones (P2002)
        let createdCount = 0;
        for (const slot of slotsToCreate) {
            try {
                await prisma.scheduleSlot.create({ data: slot });
                createdCount++;
            } catch (e: any) {
                if (e.code === 'P2002') continue;
                throw e;
            }
        }

        revalidatePath('/dashboard/agenda');
        return {
            success: true,
            message: `Clonación Exitosa. Se replicaron ${createdCount} cupos en el nuevo día.`
        };

    } catch (error) {
        console.error('Error clonando agenda:', error);
        return { success: false, error: 'Fallo crítico ejecutando la clonación.' };
    }
}
