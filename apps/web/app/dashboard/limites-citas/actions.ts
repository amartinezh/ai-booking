'use server';

// ─────────────────────────────────────────────────────────────
// LÍMITE DE CITAS POR PACIENTE — guardar la configuración.
// La edita solo el ORG_ADMIN de la clínica (lib/limite-citas/acceso, 2026-10-22).
// El bot la lee en cada reserva, así que surte efecto desde el siguiente
// mensaje sin reiniciar nada.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { puedeConfigurarLimiteCitas } from '@/lib/limite-citas/acceso';
import { validarLimites } from '@/lib/limite-citas/validacion';
import type { LimitesCitas } from '@agenia/shared';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';

export async function guardarLimitesCitas(
    entrada: LimitesCitas,
): Promise<{ success: true; limites: LimitesCitas } | { success: false; error: string }> {
    const session = await getSession();
    if (!puedeConfigurarLimiteCitas(session)) return { success: false, error: 'Acceso denegado' };

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
        const antes = await prisma.organizationSettings.findUnique({
            where: { organizationId: session.organizationId },
            select: {
                dailyAppointmentLimitEnabled: true,
                maxAppointmentsPerDay: true,
                monthlyAppointmentLimitEnabled: true,
                maxAppointmentsPerMonth: true,
            },
        });
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId },
            create: { organizationId: session.organizationId, ...datos },
            update: datos,
        });
        const texto = (activo: boolean | null | undefined, max: number | null | undefined) =>
            activo ? String(max) : 'sin límite';
        const dia = `al día: ${texto(antes?.dailyAppointmentLimitEnabled, antes?.maxAppointmentsPerDay)} → ${texto(limites.diaActivo, limites.maxDia)}`;
        const mes = `al mes: ${texto(antes?.monthlyAppointmentLimitEnabled, antes?.maxAppointmentsPerMonth)} → ${texto(limites.mesActivo, limites.maxMes)}`;
        await registrarActividad({
            action: 'APPOINTMENT_LIMITS_CHANGED',
            message: 'Límite de citas por paciente actualizado',
            actor: actorDeSesion(session),
            organizationId: session.organizationId,
            metadata: { detalle: `Citas por paciente ${dia} · ${mes}` },
        });
        revalidatePath('/dashboard/limites-citas');
        return { success: true, limites };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
