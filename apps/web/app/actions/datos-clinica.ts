'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import { validarTelefonoSoporte } from '@/lib/configuracion/telefono-soporte';

export type ResultadoTelefonoSoporte =
    | { success: true; telefono: string; alertasPorWhatsapp: boolean }
    | { success: false; error: string };

const finalDe = (t: string | null | undefined) => (t ? `···${t.replace(/\D/g, '').slice(-4)}` : 'sin teléfono');

/**
 * 📞 El teléfono de soporte de la clínica (Configuración › Datos de la clínica,
 * docs/PLAN_NAVEGACION.md N9). Solo el administrador, y solo el de su clínica. El
 * asistente lo lee en cada mensaje: aplica desde el siguiente. Queda en la
 * Actividad de usuarios con los últimos cuatro dígitos.
 */
export async function setMyTelefonoSoporte(entrada: string): Promise<ResultadoTelefonoSoporte> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
        return { success: false, error: 'Acceso denegado' };
    }
    const v = validarTelefonoSoporte(entrada);
    if (!v.ok) return { success: false, error: v.error };

    try {
        const antes = await prisma.organization.findUnique({
            where: { id: session.organizationId },
            select: { supportPhone: true },
        });
        if (antes?.supportPhone !== v.valor) {
            await prisma.organization.update({
                where: { id: session.organizationId },
                data: { supportPhone: v.valor },
            });
            const detalle = `Teléfono de soporte: ${finalDe(antes?.supportPhone)} → ${finalDe(v.valor)}`;
            await registrarActividad({
                action: 'SUPPORT_PHONE_CHANGED',
                message: detalle,
                actor: actorDeSesion(session),
                organizationId: session.organizationId,
                metadata: { detalle },
            });
        }
        revalidatePath('/dashboard/configuracion', 'layout');
        return { success: true, telefono: v.valor, alertasPorWhatsapp: v.alertasPorWhatsapp };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
