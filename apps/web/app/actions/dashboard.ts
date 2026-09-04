'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { AttendanceStatus } from '@agenia/database';
import { getErrorMessage } from '@/lib/error';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

const REMINDER_ALLOWED_ROLES = ['BOOKING_AGENT', 'DOCTOR', 'ORG_ADMIN', 'SUPER_ADMIN'];

const ATTENDANCE_ALLOWED_ROLES = ['BOOKING_AGENT', 'DOCTOR', 'ORG_ADMIN', 'SUPER_ADMIN'];

export async function updateAttendance(appointmentId: string, status: string) {
    try {
        const session = await getSession();

        if (!session || !ATTENDANCE_ALLOWED_ROLES.includes(session.role)) {
            return { success: false, error: 'No tiene permisos para actualizar la asistencia' };
        }

        const whereClause: { id: string; organizationId?: string } = { id: appointmentId };
        if (session.role !== 'SUPER_ADMIN' && session.organizationId) {
            whereClause.organizationId = session.organizationId;
        }

        await prisma.appointment.update({
            where: whereClause,
            data: { attendanceStatus: status as AttendanceStatus },
        });

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Error updating attendance:', error);
        return { success: false, error: 'Error actualizando asistencia' };
    }
}

/**
 * Dispara un recordatorio manual de cita.
 *
 * Va contra `POST /appointments/:id/send-manual-reminder` del backend NestJS,
 * que reutiliza la misma maquinaria del cron (envío + idempotencia +
 * InteractionLog + SystemLog) pero aplicada a UNA sola cita.
 *
 * Al éxito, el backend ya dejó `Appointment.reminderSentAt` poblado para
 * que el cron automático no vuelva a enviar al mismo paciente hoy.
 */
export async function sendManualReminder(appointmentId: string): Promise<{
    success: boolean;
    error?: string;
    reminderSentAt?: string | null;
}> {
    const session = await getSession();
    if (!session || !REMINDER_ALLOWED_ROLES.includes(session.role)) {
        return { success: false, error: 'No tiene permisos para enviar recordatorios.' };
    }

    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        const res = await fetch(
            `${INTERNAL_API_URL}/appointments/${appointmentId}/send-manual-reminder`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Cookie: `auth_token=${token}` } : {}),
                },
                cache: 'no-store',
            },
        );

        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Backend ${res.status}: ${errText}` };
        }

        const data = await res.json();
        if (!data?.success) {
            return { success: false, error: data?.error ?? 'No se pudo enviar el recordatorio.' };
        }

        revalidatePath('/dashboard');
        return {
            success: true,
            reminderSentAt: data?.appointment?.reminderSentAt ?? null,
        };
    } catch (e) {
        console.error('Error enviando recordatorio manual:', e);
        return { success: false, error: getErrorMessage(e) };
    }
}

export async function cancelAppointmentAndFreeSlot(appointmentId: string, scheduleSlotId: string) {
    try {
        // 🔐 Sesión + tenant obligatorios: sin esto, cualquiera podía cancelar
        // citas de cualquier clínica conociendo los IDs.
        const session = await getSession();
        if (!session || !ATTENDANCE_ALLOWED_ROLES.includes(session.role)) {
            return { success: false, error: 'No tiene permisos para cancelar citas.' };
        }

        const whereClause: { id: string; organizationId?: string } = { id: appointmentId };
        if (session.role !== 'SUPER_ADMIN' && session.organizationId) {
            whereClause.organizationId = session.organizationId;
        }

        // El slot a liberar se toma de la MISMA cita (no del cliente): evita
        // liberar un slot ajeno pasando un scheduleSlotId arbitrario.
        const appointment = await prisma.appointment.findFirst({
            where: whereClause,
            select: { id: true, scheduleSlotId: true }
        });
        if (!appointment) {
            return { success: false, error: 'Cita no encontrada en su organización.' };
        }
        if (scheduleSlotId && scheduleSlotId !== appointment.scheduleSlotId) {
            return { success: false, error: 'El cupo indicado no corresponde a la cita.' };
        }

        // En una transacción: Cancelar o eliminar la cita (en este caso cambiar estado a CANCELLED)
        // Y liberar el slot para que la IA/WhatsApp lo pueda re-vender.
        await prisma.$transaction([
            prisma.appointment.update({
                where: { id: appointment.id },
                data: { status: 'CANCELLED' }
            }),
            prisma.scheduleSlot.update({
                where: { id: appointment.scheduleSlotId },
                data: { isAvailable: true } // Liberación al mercado
            })
        ]);

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        return { success: false, error: 'Hubo un error crítico al cancelar y liberar el cupo.' };
    }
}
