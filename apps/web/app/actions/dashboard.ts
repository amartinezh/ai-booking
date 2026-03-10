'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

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
