/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getAgendaDependencies() {
    try {
        const doctors = await prisma.doctorProfile.findMany({
            where: { isActive: true },
            include: { service: true },
            orderBy: { fullName: 'asc' },
        });

        const epsList = await prisma.eps.findMany({
            where: { isActive: true },
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
        // Mostrar slots desde el inicio del día actual (medianoche) para ver la agenda completa del día
        const todayAtMidnight = new Date();
        todayAtMidnight.setHours(0, 0, 0, 0);

        const whereClause: any = { startTime: { gte: todayAtMidnight } };
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
            take: 100, // Limitar para UX
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

        const doctor = await prisma.doctorProfile.findUnique({
            where: { id: doctorId },
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
        const slot = await prisma.scheduleSlot.findUnique({ where: { id }, include: { appointment: true } });
        if (slot?.appointment) {
            return { success: false, error: 'Este cupo ya fue reservado por un paciente. Cancele la cita primero.' };
        }
        await prisma.scheduleSlot.delete({ where: { id } });
        revalidatePath('/dashboard/agenda');
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Error eliminando el cupo' };
    }
}
