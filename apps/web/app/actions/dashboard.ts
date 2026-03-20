'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

export async function updateAttendance(appointmentId: string, status: string) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/appointments/${appointmentId}/attendance`, {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ status })
        });

        if (!res.ok) throw new Error('API Error');

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
