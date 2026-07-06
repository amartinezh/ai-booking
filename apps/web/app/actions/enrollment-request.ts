'use server';

// ─────────────────────────────────────────────────────────────
// SOLICITUD DE ALTA EN EL PADRÓN EPS — action PÚBLICA (sin sesión).
//
// La usa el formulario /solicitud-alta/{orgId} al que el chatbot remite a los
// pacientes cuya cédula no figura en el padrón. Solo REGISTRA la revisión;
// el alta efectiva la hace la clínica re-importando el padrón.
// Al ser pública, valida todo server-side y aplica un tope de solicitudes
// pendientes por cédula para evitar abuso.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';

const MAX_PENDING_PER_CEDULA = 3;

export interface EnrollmentRequestPayload {
    cedula: string;
    fullName: string;
    phone?: string;
    epsName?: string;
    message: string;
}

export async function submitEnrollmentRequest(
    orgId: string,
    payload: EnrollmentRequestPayload,
): Promise<{ success: true } | { success: false; error: string }> {
    try {
        const organization = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { id: true, isActive: true },
        });
        if (!organization || !organization.isActive) {
            return { success: false, error: 'La institución no está disponible.' };
        }

        const cedula = (payload.cedula ?? '').replace(/[.\s]/g, '');
        const fullName = (payload.fullName ?? '').replace(/\s+/g, ' ').trim();
        const phone = (payload.phone ?? '').trim();
        const epsName = (payload.epsName ?? '').trim();
        const message = (payload.message ?? '').trim();

        if (!/^\d{4,15}$/.test(cedula)) {
            return { success: false, error: 'Ingresa un número de documento válido (solo dígitos).' };
        }
        if (fullName.length < 3 || fullName.length > 120) {
            return { success: false, error: 'Ingresa tu nombre completo.' };
        }
        if (phone && !/^\+?[\d\s\-()]{7,20}$/.test(phone)) {
            return { success: false, error: 'El teléfono no parece válido.' };
        }
        if (message.length < 10 || message.length > 2000) {
            return {
                success: false,
                error: 'Cuéntanos brevemente por qué deberías estar dado de alta (mínimo 10 caracteres).',
            };
        }

        const pending = await prisma.epsEnrollmentRequest.count({
            where: { organizationId: orgId, cedula, status: 'PENDING' },
        });
        if (pending >= MAX_PENDING_PER_CEDULA) {
            return {
                success: false,
                error: 'Ya tienes solicitudes en revisión para este documento. La institución las está procesando.',
            };
        }

        await prisma.epsEnrollmentRequest.create({
            data: {
                organizationId: orgId,
                cedula,
                fullName,
                phone: phone || null,
                epsName: epsName.slice(0, 120) || null,
                message,
            },
        });

        return { success: true };
    } catch {
        return { success: false, error: 'No pudimos registrar tu solicitud. Intenta de nuevo en unos minutos.' };
    }
}
