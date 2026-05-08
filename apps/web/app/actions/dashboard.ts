'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

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
            data: { attendanceStatus: status as any },
        });

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Error updating attendance:', error);
        return { success: false, error: 'Error actualizando asistencia' };
    }
}

export async function cancelAppointmentAndFreeSlot(appointmentId: string, scheduleSlotId: string) {
    try {
        // En una transacción: Cancelar o eliminar la cita (en este caso cambiar estado a CANCELLED)
        // Y liberar el slot para que la IA/WhatsApp lo pueda re-vender.

        await prisma.$transaction([
            prisma.appointment.update({
                where: { id: appointmentId },
                data: { status: 'CANCELLED' }
            }),
            prisma.scheduleSlot.update({
                where: { id: scheduleSlotId },
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
