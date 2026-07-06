'use server';

// ─────────────────────────────────────────────────────────────
// SOLICITUDES DE ALTA — acciones del panel administrativo.
// Solo ORG_ADMIN de la clínica dueña puede marcar una solicitud
// como revisada (el listado se renderiza server-side en page.tsx).
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export async function markEnrollmentRequestReviewed(
    id: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await getSession();
        if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
            return { success: false, error: 'Acceso denegado' };
        }

        // Scoping multi-tenant: la solicitud debe pertenecer a la clínica del token.
        const request = await prisma.epsEnrollmentRequest.findFirst({
            where: { id, organizationId: session.organizationId },
            select: { id: true, status: true },
        });
        if (!request) return { success: false, error: 'Solicitud no encontrada' };
        if (request.status === 'REVIEWED') return { success: true };

        await prisma.epsEnrollmentRequest.update({
            where: { id: request.id },
            data: { status: 'REVIEWED', reviewedAt: new Date() },
        });

        revalidatePath('/dashboard/solicitudes-alta');
        return { success: true };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Error al actualizar la solicitud';
        return { success: false, error: message };
    }
}
