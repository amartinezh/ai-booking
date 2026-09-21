'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { AttendanceStatus } from '@agenia/database';
import { armarMetaLogCancelacionPersonal } from '@agenia/shared';
import { getErrorMessage } from '@/lib/error';
import {
    MSG_FUERA_DE_ALCANCE,
    alcanceDeLaSesion,
    citaFueraDeAlcance,
} from '@/lib/alcance-agente';

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

        // 🔐 El alcance, ANTES de escribir (§12 #10 del plan del rastreo): un agente
        // acotado a una EPS o a un médico —y un médico a su propia agenda— solo marca
        // la asistencia de lo que su panel le lista. Hay que leer la cita para saberlo:
        // la EPS es de la cita y el médico, de su cupo.
        const cita = await prisma.appointment.findFirst({
            where: whereClause,
            select: { id: true, epsId: true, scheduleSlot: { select: { doctorId: true } } },
        });
        if (!cita) {
            return { success: false, error: 'Cita no encontrada en su organización.' };
        }
        const alcance = await alcanceDeLaSesion(prisma, session);
        if (citaFueraDeAlcance(alcance, { epsId: cita.epsId, doctorId: cita.scheduleSlot.doctorId })) {
            return { success: false, error: MSG_FUERA_DE_ALCANCE };
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
        // 🔐 El alcance, antes de mandar un WhatsApp al paciente de otro (§12 #10).
        // La API aplica esta MISMA regla en el endpoint (§12 #10b), con la función
        // compartida `citaFueraDeAlcance`: la de aquí ahorra el viaje y da un mensaje
        // claro; la de allá es la frontera de verdad, porque el endpoint se puede
        // llamar directo con un token.
        const alcanceRecordatorio = await alcanceDeLaSesion(prisma, session);
        if (alcanceRecordatorio) {
            const whereCita: { id: string; organizationId?: string } = { id: appointmentId };
            if (session.organizationId) whereCita.organizationId = session.organizationId;
            const cita = await prisma.appointment.findFirst({
                where: whereCita,
                select: { epsId: true, scheduleSlot: { select: { doctorId: true } } },
            });
            if (!cita) {
                return { success: false, error: 'Cita no encontrada en su organización.' };
            }
            if (citaFueraDeAlcance(alcanceRecordatorio, { epsId: cita.epsId, doctorId: cita.scheduleSlot.doctorId })) {
                return { success: false, error: MSG_FUERA_DE_ALCANCE };
            }
        }

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
        // liberar un slot ajeno pasando un scheduleSlotId arbitrario. La EPS y el
        // médico de su cupo se leen para poder comprobar el alcance del agente.
        const appointment = await prisma.appointment.findFirst({
            where: whereClause,
            select: {
                id: true,
                scheduleSlotId: true,
                metaLog: true,
                epsId: true,
                scheduleSlot: { select: { doctorId: true } },
            }
        });
        if (!appointment) {
            return { success: false, error: 'Cita no encontrada en su organización.' };
        }

        // 🔐 Cada uno actúa solo sobre lo que su panel le lista (§12 #9 y #11 del plan
        // del rastreo): el agente sobre su EPS y su médico, el MÉDICO sobre su propia
        // agenda. Sin esto, cualquiera de los dos cancelaba cualquier cita de la clínica. Se comprueba ANTES que el cupo: una cita fuera de
        // su alcance no debe enterarse de nada más. Si el perfil no se puede leer, el
        // `catch` de abajo responde con error y NO se cancela (falla cerrado).
        const alcance = await alcanceDeLaSesion(prisma, session);
        if (citaFueraDeAlcance(alcance, { epsId: appointment.epsId, doctorId: appointment.scheduleSlot.doctorId })) {
            return { success: false, error: MSG_FUERA_DE_ALCANCE };
        }
        if (scheduleSlotId && scheduleSlotId !== appointment.scheduleSlotId) {
            return { success: false, error: 'El cupo indicado no corresponde a la cita.' };
        }

        // Quién y cuándo canceló. `Appointment` no tiene `updatedAt`, así que sin esto
        // una cancelación del personal no dejaba ningún rastro y, ante un "yo no
        // cancelé esa cita", no había forma de saber si fue el paciente, el hospital
        // o alguien de la clínica (ver @agenia/shared `appointment-cancel`).
        const metaLog = armarMetaLogCancelacionPersonal(appointment.metaLog, {
            userId: session.userId,
            role: session.role,
            at: new Date(),
        });

        // Cancelar y liberar el cupo (para que la IA/WhatsApp lo pueda re-vender) en
        // una transacción, y solo libera el cupo QUIEN REALMENTE CANCELA: el cambio va
        // condicionado a que la cita no esté ya cancelada. Una cita ya cancelada (doble
        // clic, página vieja, cancelada antes por el paciente o por el hospital) liberó
        // su cupo cuando se canceló, y ese cupo pudo venderse a otra cita: liberarlo de
        // nuevo dejaría a AgenIA ofreciendo una hora ocupada. También evita pisar la
        // constancia original y un evento redundante hacia el HIS (el trigger se dispara
        // por `status` en el SET aunque no cambie). Si dos peticiones llegan a la vez,
        // Postgres reevalúa el filtro y solo una encuentra la cita sin cancelar.
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.appointment.updateMany({
                where: { id: appointment.id, status: { not: 'CANCELLED' } },
                data: { status: 'CANCELLED', metaLog },
            });
            if (count === 0) return;
            await tx.scheduleSlot.update({
                where: { id: appointment.scheduleSlotId },
                data: { isAvailable: true },
            });
        });

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        return { success: false, error: 'Hubo un error crítico al cancelar y liberar el cupo.' };
    }
}
