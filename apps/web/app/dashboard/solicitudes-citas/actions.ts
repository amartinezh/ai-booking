'use server';

// ─────────────────────────────────────────────────────────────
// SOLICITUDES DE MÁS CITAS — decisión del personal.
//
// Aprobar concede `extraGranted` citas adicionales a esa cédula SOLO para el
// periodo de la solicitud (ese día o ese mes): el bot las suma al límite de la
// clínica. Rechazar no cambia nada para el paciente. Las dos cosas las pueden
// hacer ORG_ADMIN y BOOKING_AGENT de la clínica dueña, y solo sobre una
// solicitud PENDIENTE (la guarda del `updateMany` evita que dos personas la
// decidan a la vez y la segunda pise a la primera).
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { puedeGestionarLimiteCitas } from '@/lib/limite-citas/acceso';
import { esIdDeSolicitud, validarDecision } from '@/lib/limite-citas/validacion';

export async function decidirSolicitudCitas(
    id: string,
    entrada: { decision: 'APPROVED' | 'REJECTED'; adicionales?: number; nota?: string },
): Promise<{ success: true } | { success: false; error: string }> {
    const session = await getSession();
    if (!puedeGestionarLimiteCitas(session)) return { success: false, error: 'Acceso denegado' };
    if (!esIdDeSolicitud(id)) return { success: false, error: 'Solicitud no encontrada' };

    const v = validarDecision(entrada ?? {});
    if (!v.ok) return { success: false, error: v.error };

    try {
        const { count } = await prisma.appointmentLimitRequest.updateMany({
            // Multi-tenant: la solicitud debe ser de la clínica del token.
            where: { id, organizationId: session.organizationId, status: 'PENDING' },
            data: {
                status: v.datos.decision,
                extraGranted: v.datos.decision === 'APPROVED' ? v.datos.adicionales : null,
                reviewNote: v.datos.nota,
                reviewedAt: new Date(),
                reviewedByUserId: session.userId,
                reviewedByEmail: session.email,
            },
        });
        if (count === 0) {
            return { success: false, error: 'La solicitud ya fue revisada o no existe. Recarga la página.' };
        }
        revalidatePath('/dashboard/solicitudes-citas');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
