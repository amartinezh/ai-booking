'use server';

// ─────────────────────────────────────────────────────────────
// «Envíos de documentos» (docs/PLAN_RESUMEN_ATENCION.md §4.6, D14): si al
// paciente le llegaron los documentos de su consulta y «Reenviar» a pedido
// suyo, tras verificar su identidad en ventanilla. Administrador y Agente de
// Reservas. Nunca el contenido clínico ni números completos.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { documentoSinCerosIniciales, enmascararDocumento, enmascararNombre, normalizeDocumento } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { personalDeEnvios } from '@/lib/resumen/acceso';
import { INTERNAL_API_URL } from '@/lib/resumen/api';

const MS_DIA = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE = 40;

export interface EnvioDeLaAtencion {
    canal: string;
    proposito: string;
    destino: string;
    estado: string;
    motivo: string | null;
    avisoIso: string | null;
    documentosIso: string | null;
}

export interface AtencionConEnvios {
    id: string;
    historia: string;
    atendidaIso: string;
    servicio: string | null;
    /** Enmascarados: lo justo para reconocerlo en ventanilla. Sin ficha en AgenIA, null. */
    paciente: { nombre: string; documento: string | null } | null;
    estado: string;
    motivo: string | null;
    contenidoDisponible: boolean;
    envios: EnvioDeLaAtencion[];
}

/**
 * Las atenciones de los últimos 30 días con sus envíos, de la más reciente. Con
 * `consulta`, por número de historia o por cédula (de los pacientes con ficha).
 */
export async function listarEnviosAction(
    consulta?: string,
): Promise<{ success: true; atenciones: AtencionConEnvios[] } | { success: false; error: string }> {
    const auth = await personalDeEnvios();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const texto = typeof consulta === 'string' ? consulta.trim() : '';
    const digitos = texto.replace(/\D/g, '');
    let filtro: object = { receivedAt: { gte: new Date(Date.now() - 30 * MS_DIA) } };
    if (texto) {
        if (!/^\d{3,18}$/.test(digitos)) return { success: false, error: 'Escriba el número de historia o la cédula, solo números.' };
        const doc = documentoSinCerosIniciales(normalizeDocumento(digitos));
        const perfiles = await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "PatientProfile"
             WHERE "organizationId" = ${auth.organizationId}
               AND regexp_replace("cedula", '^0+', '') = ${doc}
             LIMIT 5`;
        filtro = { OR: [{ hisKey: digitos }, { patientProfileId: { in: perfiles.map((p) => p.id) } }] };
    }

    const filas = await prisma.attentionSummary.findMany({
        where: { organizationId: auth.organizationId, ...filtro },
        orderBy: { attendedAt: 'desc' },
        take: LIMITE,
        select: {
            id: true,
            hisKey: true,
            attendedAt: true,
            serviceCode: true,
            status: true,
            statusReason: true,
            purgedAt: true,
            patientProfile: { select: { fullName: true, cedula: true } },
            deliveries: {
                orderBy: { createdAt: 'desc' },
                take: 6,
                select: {
                    channel: true,
                    purpose: true,
                    destinationMasked: true,
                    status: true,
                    statusReason: true,
                    noticeSentAt: true,
                    documentsSentAt: true,
                },
            },
        },
    });
    return {
        success: true,
        atenciones: filas.map((f) => ({
            id: f.id,
            historia: f.hisKey,
            atendidaIso: f.attendedAt.toISOString(),
            servicio: f.serviceCode,
            paciente: f.patientProfile
                ? { nombre: enmascararNombre(f.patientProfile.fullName), documento: enmascararDocumento(f.patientProfile.cedula) }
                : null,
            estado: f.status,
            motivo: f.statusReason,
            contenidoDisponible: f.purgedAt === null,
            envios: f.deliveries.map((d) => ({
                canal: d.channel,
                proposito: d.purpose,
                destino: d.destinationMasked,
                estado: d.status,
                motivo: d.statusReason,
                avisoIso: d.noticeSentAt?.toISOString() ?? null,
                documentosIso: d.documentsSentAt?.toISOString() ?? null,
            })),
        })),
    };
}

/**
 * «Reenviar»: solo después de verificar la identidad del paciente en ventanilla
 * (`identidadVerificada`). La API respeta las mismas reglas que el envío
 * automático (lo sensible, la baja, los interruptores y el modo prueba) y deja
 * constancia de quién lo pidió.
 */
export async function reenviarResumenAction(
    id: string,
    identidadVerificada: boolean,
): Promise<{ success: true; enviados: string[] } | { success: false; error: string }> {
    const auth = await personalDeEnvios();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    if (identidadVerificada !== true) return { success: false, error: 'Primero verifique la identidad del paciente en ventanilla.' };
    if (typeof id !== 'string' || !UUID.test(id)) return { success: false, error: 'La atención no existe.' };

    const token = (await cookies()).get('auth_token')?.value;
    let res: Response;
    try {
        res = await fetch(`${INTERNAL_API_URL}/attention-summaries/${id}/resend`, {
            method: 'POST',
            headers: token ? { Cookie: `auth_token=${token}` } : {},
            cache: 'no-store',
        });
    } catch {
        return { success: false, error: 'No se pudo contactar al servidor. Intente de nuevo.' };
    }
    if (res.status === 404) return { success: false, error: 'La atención no existe.' };
    if (res.status === 401 || res.status === 403) return { success: false, error: 'Sin permisos.' };
    if (!res.ok) return { success: false, error: `El servidor respondió ${res.status}.` };
    const r = (await res.json()) as { enviados: string[]; motivo?: string };
    revalidatePath('/dashboard/espejo/resumen-atencion/envios');
    return r.enviados.length ? { success: true, enviados: r.enviados } : { success: false, error: r.motivo ?? 'No salió por ningún canal.' };
}
