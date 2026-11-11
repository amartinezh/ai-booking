'use server';

// ─────────────────────────────────────────────────────────────
// «Envíos de documentos» (docs/PLAN_RESUMEN_ATENCION.md §4.6, D14): si al
// paciente le llegaron los documentos de su consulta y «Reenviar» a pedido
// suyo, tras verificar su identidad en ventanilla. Administrador y Agente de
// Reservas. Nunca el contenido clínico ni números completos.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import {
    DEFAULT_TIMEZONE,
    documentoSinCerosIniciales,
    enmascararDocumento,
    enmascararNombre,
    horaLocalAUtc,
    normalizeDocumento,
    sumarDiasAFecha,
} from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { personalDeEnvios } from '@/lib/resumen/acceso';
import { INTERNAL_API_URL } from '@/lib/resumen/api';
import { trazaDeEnvios, type TrazaDelEnvio } from '@/lib/resumen/trazabilidad';
import { registrarActividad } from '@/lib/actividad/registrar';
import { DESCARGAS } from '@/lib/actividad/pantallas';

const MS_DIA = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE = 40;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
/** El registro descargable: hasta 3 meses y 5.000 atenciones por archivo. */
const EXPORTAR_MAX_DIAS = 92;
const EXPORTAR_MAX_ATENCIONES = 5000;

export interface EnvioDeLaAtencion {
    canal: string;
    proposito: string;
    destino: string;
    estado: string;
    motivo: string | null;
    avisoIso: string | null;
    documentosIso: string | null;
    verificadoPor: string | null;
    /** El recorrido: aviso enviado, entregado y leído; pidió; verificó; documentos y archivos. */
    traza: TrazaDelEnvio;
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
    /** La página del paciente: cuántas veces la abrió (con su fecha de nacimiento) y cuántos documentos descargó. */
    pagina: { veces: number; ultimaIso: string | null; descargas: number };
}

const SELECT_ENVIO = {
    id: true,
    channel: true,
    purpose: true,
    destinationMasked: true,
    status: true,
    statusReason: true,
    noticeSentAt: true,
    requestedAt: true,
    verifiedAt: true,
    verifiedBy: true,
    documentsSentAt: true,
    templateName: true,
} as const;

type FilaDeAtencion = {
    id: string;
    hisKey: string;
    attendedAt: Date;
    serviceCode: string | null;
    status: string;
    statusReason: string | null;
    purgedAt: Date | null;
    patientProfile: { fullName: string; cedula: string | null } | null;
    deliveries: {
        id: string;
        channel: string;
        purpose: string;
        destinationMasked: string;
        status: string;
        statusReason: string | null;
        noticeSentAt: Date | null;
        requestedAt: Date | null;
        verifiedAt: Date | null;
        verifiedBy: string | null;
        documentsSentAt: Date | null;
        templateName: string | null;
    }[];
};

/** Las filas de la base → lo que ve la pantalla (o el archivo), con el recorrido de cada envío. */
async function conTrazas(organizationId: string, filas: FilaDeAtencion[]): Promise<AtencionConEnvios[]> {
    const ids = filas.map((f) => f.id);
    const [trazas, visitas, descargas] = await Promise.all([
        trazaDeEnvios(
            organizationId,
            filas.flatMap((f) => f.deliveries),
        ),
        ids.length
            ? prisma.attentionSummaryAccess.groupBy({
                  by: ['attentionSummaryId'],
                  where: { attentionSummaryId: { in: ids }, kind: 'VER', link: { purpose: 'PACIENTE' } },
                  _count: { _all: true },
                  _max: { createdAt: true },
              })
            : [],
        ids.length
            ? prisma.attentionSummaryAccess.groupBy({
                  by: ['attentionSummaryId'],
                  where: { attentionSummaryId: { in: ids }, kind: 'DOCUMENTO', link: { purpose: 'PACIENTE' } },
                  _count: { _all: true },
              })
            : [],
    ]);
    return filas.map((f) => {
        const v = visitas.find((x) => x.attentionSummaryId === f.id);
        return {
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
                verificadoPor: d.verifiedBy,
                traza: trazas.get(d.id)!,
            })),
            pagina: {
                veces: v?._count._all ?? 0,
                ultimaIso: v?._max.createdAt?.toISOString() ?? null,
                descargas: descargas.find((x) => x.attentionSummaryId === f.id)?._count._all ?? 0,
            },
        };
    });
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
            deliveries: { orderBy: { createdAt: 'desc' }, take: 6, select: SELECT_ENVIO },
        },
    });
    return { success: true, atenciones: await conTrazas(auth.organizationId, filas) };
}

/**
 * El registro para descargar (Excel): todas las atenciones leídas del hospital
 * entre dos días (incluidos, en la zona de la clínica), con cada envío y su
 * recorrido. Sin contenido clínico y con nombre, documento y destino
 * enmascarados. Queda anotado quién lo descargó.
 */
export async function exportarEnviosAction(
    desdeDia: string,
    hastaDia: string,
): Promise<{ success: true; atenciones: AtencionConEnvios[]; truncado: boolean } | { success: false; error: string }> {
    const auth = await personalDeEnvios();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    if (typeof desdeDia !== 'string' || typeof hastaDia !== 'string' || !DIA.test(desdeDia) || !DIA.test(hastaDia)) {
        return { success: false, error: 'Elija las fechas.' };
    }
    if (desdeDia > hastaDia) return { success: false, error: 'La fecha inicial va antes que la final.' };
    if (sumarDiasAFecha(desdeDia, EXPORTAR_MAX_DIAS) <= hastaDia) {
        return { success: false, error: `Máximo ${EXPORTAR_MAX_DIAS} días por archivo.` };
    }
    const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { timezone: true } });
    const zona = org?.timezone || DEFAULT_TIMEZONE;
    const inicioDe = (dia: string) => {
        const [y, m, d] = dia.split('-').map(Number);
        return horaLocalAUtc(y, m, d, 0, zona);
    };
    const desde = inicioDe(desdeDia);
    const hasta = inicioDe(sumarDiasAFecha(hastaDia, 1));

    const filas = await prisma.attentionSummary.findMany({
        where: { organizationId: auth.organizationId, receivedAt: { gte: desde, lt: hasta } },
        orderBy: { attendedAt: 'asc' },
        take: EXPORTAR_MAX_ATENCIONES + 1,
        select: {
            id: true,
            hisKey: true,
            attendedAt: true,
            serviceCode: true,
            status: true,
            statusReason: true,
            purgedAt: true,
            patientProfile: { select: { fullName: true, cedula: true } },
            deliveries: { orderBy: { createdAt: 'asc' }, select: SELECT_ENVIO },
        },
    });
    const truncado = filas.length > EXPORTAR_MAX_ATENCIONES;
    const atenciones = await conTrazas(auth.organizationId, filas.slice(0, EXPORTAR_MAX_ATENCIONES));
    await registrarActividad({
        action: 'DATA_EXPORTED',
        level: 'WARNING',
        message: `Descarga: ${DESCARGAS.ENVIOS_RESUMEN}`,
        actor: { userId: auth.userId, role: auth.role },
        organizationId: auth.organizationId,
        metadata: {
            detalle: `${DESCARGAS.ENVIOS_RESUMEN} del ${desdeDia} al ${hastaDia} · ${atenciones.length} atención(es)`,
            tipo: 'ENVIOS_RESUMEN',
            filas: atenciones.length,
        },
    });
    return { success: true, atenciones, truncado };
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
