'use server';

// ─────────────────────────────────────────────────────────────
// LÍMITE DE CITAS POR PACIENTE — guardar la configuración.
// La editan ORG_ADMIN y BOOKING_AGENT de la clínica (lib/limite-citas/acceso).
// El bot la lee en cada reserva, así que surte efecto desde el siguiente
// mensaje sin reiniciar nada.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { puedeGestionarLimiteCitas } from '@/lib/limite-citas/acceso';
import { validarLimites } from '@/lib/limite-citas/validacion';
import type { LimitesCitas } from '@agenia/shared';

export async function guardarLimitesCitas(
    entrada: LimitesCitas,
): Promise<{ success: true; limites: LimitesCitas } | { success: false; error: string }> {
    const session = await getSession();
    if (!puedeGestionarLimiteCitas(session)) return { success: false, error: 'Acceso denegado' };

    // Se acota aquí y no solo en el formulario: la acción se puede llamar con
    // cualquier cosa. El bot vuelve a acotar al leer.
    const limites = validarLimites(entrada ?? {});
    const datos = {
        dailyAppointmentLimitEnabled: limites.diaActivo,
        maxAppointmentsPerDay: limites.maxDia,
        monthlyAppointmentLimitEnabled: limites.mesActivo,
        maxAppointmentsPerMonth: limites.maxMes,
        appointmentLimitsUpdatedAt: new Date(),
        appointmentLimitsUpdatedBy: session.email,
    };
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId },
            create: { organizationId: session.organizationId, ...datos },
            update: datos,
        });
        revalidatePath('/dashboard/limites-citas');
        return { success: true, limites };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
