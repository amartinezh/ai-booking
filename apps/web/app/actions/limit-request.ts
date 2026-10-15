'use server';

// ─────────────────────────────────────────────────────────────
// SOLICITUD DE MÁS CITAS — action PÚBLICA (sin sesión).
//
// La usa el formulario /solicitud-citas/{id} al que el bot remite al paciente
// que llegó al límite de citas del día o del mes. El `id` (UUID v4) es el token
// del enlace: solo quien recibió el mensaje lo conoce. Solo RADICA la solicitud
// (INVITED → PENDING); la decisión la toma el personal en el panel.
// Al ser pública, valida todo server-side, y la guarda del `updateMany` impide
// radicar dos veces la misma o radicar con el enlace vencido.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';
import { esIdDeSolicitud, validarRadicacion } from '@/lib/limite-citas/validacion';

export interface LimitRequestPayload {
    motivo: string;
    argumento: string;
    adicionales: number;
    telefono?: string;
}

export async function submitLimitRequest(
    id: string,
    payload: LimitRequestPayload,
): Promise<{ success: true } | { success: false; error: string }> {
    try {
        if (!esIdDeSolicitud(id)) return { success: false, error: 'El enlace no es válido.' };

        const v = validarRadicacion(payload ?? {});
        if (!v.ok) return { success: false, error: v.error };

        const ahora = new Date();
        const { count } = await prisma.appointmentLimitRequest.updateMany({
            where: {
                id,
                status: 'INVITED',
                expiresAt: { gt: ahora },
                organization: { isActive: true },
            },
            data: {
                status: 'PENDING',
                submittedAt: ahora,
                reasonCategory: v.datos.motivo,
                message: v.datos.argumento,
                extraRequested: v.datos.adicionales,
                ...(v.datos.telefono ? { phone: v.datos.telefono } : {}),
            },
        });
        if (count === 0) {
            return {
                success: false,
                error: 'Esta solicitud ya fue enviada o el enlace venció. Si lo necesitas, escríbele de nuevo al asistente.',
            };
        }
        return { success: true };
    } catch {
        return { success: false, error: 'No pudimos registrar tu solicitud. Intenta de nuevo en unos minutos.' };
    }
}
