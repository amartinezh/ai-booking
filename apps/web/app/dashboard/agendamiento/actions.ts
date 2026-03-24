'use server';

import { prisma } from '../../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';

// Mock del Outbound de Whatsapp desde NestJS API (o invocación HTTP a nuestro NestJS)
export async function sendManualWhatsappAction(appointmentId: string, message: string) {
    if (!message || message.trim() === '') return { success: false, error: 'Mensaje vacío.' };

    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const appointment = await prisma.appointment.findFirst({
            where: { id: appointmentId, organizationId: session.organizationId },
            include: { patient: true }
        });

        if (!appointment) return { success: false, error: 'Cita no encontrada.' };

        // Llamar a NestJS Endpoint o usar lógica directa si es monolito
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/chatbot/outbound`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: appointment.patient.whatsappId || appointment.patient.cedula,
                message
            })
        });

        if (!res.ok) {
            throw new Error('Error enviando mensaje via API');
        }

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function createManualAppointmentAction(formData: FormData) {
    try {
        const patientCedula = formData.get('cedula') as string;
        const patientName = formData.get('fullName') as string;
        const epsId = formData.get('epsId') as string;
        const serviceId = formData.get('serviceId') as string;
        const doctorId = formData.get('doctorId') as string;
        const startDateStr = formData.get('startDate') as string;

        if (!patientCedula || !patientName || !epsId || !serviceId || !doctorId || !startDateStr) {
            return { success: false, error: 'Faltan campos obligatorios.' };
        }

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        // 1. Transaction to find/create patient and assign slot
        await prisma.$transaction(async (tx) => {
            // Find or insert Patient
            let patient = await tx.patientProfile.findFirst({ where: { cedula: patientCedula, organizationId: session.organizationId } });
            
            if (!patient) {
                // To create a patient, we need a base user on this architecture
                const tempEmail = `${patientCedula}@paciente.temporal.com`;
                const user = await tx.user.create({
                    data: { email: tempEmail, password: 'manual_created_hash', role: 'PATIENT', organizationId: session.organizationId }
                });
                patient = await tx.patientProfile.create({
                    data: {
                        cedula: patientCedula,
                        fullName: patientName,
                        userId: user.id,
                        epsId: epsId,
                        organizationId: session.organizationId
                    }
                });
            }

            // 2. We don't have a schedule slot picker yet, so let's mock creating an on-the-fly ScheduleSlot 
            // for the selected date and Doctor/Service if it doesn't collide
            const startDate = new Date(startDateStr);
            const endDate = new Date(startDate.getTime() + 30 * 60000); // 30 mins later
            
            // Check if ANY slot exists at this exact time (available or not)
            const existingSlot = await tx.scheduleSlot.findFirst({
                where: { doctorId, startTime: startDate, organizationId: session.organizationId }
            });

            let slot = null;
            if (existingSlot) {
                if (!existingSlot.isAvailable) {
                    throw new Error('El médico ya tiene una cita ocupada a esta hora exacta.');
                }
                // Si existe y está libre, lo usamos
                slot = existingSlot;
                await tx.scheduleSlot.update({ where: { id: slot.id }, data: { isAvailable: false } });
            } else {
                // Force Create for Admins (manual booking bypassing regular slots if needed - just for testing POC)
                slot = await tx.scheduleSlot.create({
                    data: {
                        startTime: startDate,
                        endTime: endDate,
                        doctorId,
                        serviceId,
                        isAvailable: false,
                        organizationId: session.organizationId
                    }
                });
            }

            // 3. Create Appointment Origin MANUAL
            await tx.appointment.create({
                data: {
                    scheduleSlotId: slot.id,
                    patientId: patient.id,
                    epsId: epsId,
                    origin: 'MANUAL',
                    reason: formData.get('reason') as string || 'Agendamiento Manual Panel',
                    organizationId: session.organizationId
                }
            });
        });

        revalidatePath('/dashboard/agendamiento');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function updateManualAppointmentAction(appointmentId: string, formData: FormData) {
    try {
        const patientCedula = formData.get('cedula') as string;
        const patientName = formData.get('fullName') as string;
        const epsId = formData.get('epsId') as string;
        const serviceId = formData.get('serviceId') as string;
        const doctorId = formData.get('doctorId') as string;
        const startDateStr = formData.get('startDate') as string;

        if (!appointmentId || !patientCedula || !patientName || !epsId || !serviceId || !doctorId || !startDateStr) {
            return { success: false, error: 'Faltan campos obligatorios para actualizar.' };
        }

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        await prisma.$transaction(async (tx) => {
            const appointment = await tx.appointment.findFirst({
                where: { id: appointmentId, organizationId: session.organizationId },
                include: { patient: true }
            });

            if (!appointment) throw new Error('Cita original no encontrada.');

            // 1. Actulizar Datos de Paciente Básicos
            await tx.patientProfile.update({
                where: { id: appointment.patientId },
                data: { fullName: patientName, epsId: epsId }
            });

            const startDate = new Date(startDateStr);
            const endDate = new Date(startDate.getTime() + 30 * 60000);

            // 2. Gestionar la reagendación logica de Slots
            let newSlot = await tx.scheduleSlot.findFirst({
                where: { doctorId, startTime: startDate, isAvailable: true, organizationId: session.organizationId }
            });

            if (!newSlot) {
                // Si la fecha combinada con el medico es totalmente nueva, crearla:
                newSlot = await tx.scheduleSlot.create({
                    data: {
                        startTime: startDate,
                        endTime: endDate,
                        doctorId,
                        serviceId,
                        isAvailable: false
                    }
                });
            } else {
                // Si estaba libre, pero existía, Ocuparla
                newSlot = await tx.scheduleSlot.update({ where: { id: newSlot.id }, data: { isAvailable: false } });
            }

            // 3. Si el slot original era distinto, liberar el antiguo de nuevo al pool
            if (appointment.scheduleSlotId !== newSlot.id) {
                await tx.scheduleSlot.update({ where: { id: appointment.scheduleSlotId }, data: { isAvailable: true } });
            }

            // 4. Conectar la nueva modificación en Appointment
            await tx.appointment.update({
                where: { id: appointmentId },
                data: {
                    epsId: epsId,
                    scheduleSlotId: newSlot.id,
                }
            });
        });

        revalidatePath('/dashboard/agendamiento');
        revalidatePath('/dashboard');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
