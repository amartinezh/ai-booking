'use server';

// ─────────────────────────────────────────────────────────────
// RESUMEN DE LA ATENCIÓN — server actions de /dashboard/espejo/resumen-atencion.
// docs/PLAN_RESUMEN_ATENCION.md §3.11 (interruptores) y Fase 1 (lectura en sombra).
//
// EXCLUSIVO del driver cnt-sanvicente-anserma y SOLO ORG_ADMIN. Se comprueba en
// CADA acción, nunca solo al cargar la pantalla (mismo criterio que avisos).
//
// En esta fase el panel solo enciende la LECTURA: qué servicios se leen, la
// calma y «Leer del hospital». «Enviar» y los canales no se pueden prender
// aquí (`aplicarCambioDeLectura` lo impide): el envío todavía no existe y, si
// quedaran encendidos, saldría todo de una vez al desplegarlo.
//
// Revisión (cierre de la Fase 1): el hospital abre resúmenes y los compara con
// el HIS. El contenido está cifrado y la llave vive en la API: `abrirResumenAction`
// se lo pide a la API, que lo descifra y deja constancia de quién lo abrió. El
// resto de esta pantalla son configuración, conteos y la medición del agente.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { registrarActividad } from '@/lib/actividad/registrar';
import {
    LIMITES_RESUMEN_ATENCION,
    aplicarCambioDeLectura,
    configResumenAtencionApagada,
    leerConfigResumenAtencion,
    resumirMediciones,
    validarRevision,
    type CambioLecturaResumen,
    type ConfigResumenAtencion,
    type ResultadoRevisionResumen,
    type ResumenAtencionHis,
    type ResumenMedicionesLectura,
} from '@agenia/shared';

const DRIVER = 'cnt-sanvicente-anserma';
const MS_DIA = 86_400_000;
/** Resúmenes que se listan para revisar (los más recientes). */
const RECIENTES = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ServicioDelPanel {
    codigo: string;
    nombre: string;
    seLee: boolean;
}

/** Un resumen en la lista para revisar: solo datos de control, nunca el contenido. */
export interface FilaResumenParaRevisar {
    id: string;
    historia: string;
    servicio: string | null;
    atendidaIso: string;
    version: number;
    /** Hay un paciente de AgenIA con ese documento. */
    conPaciente: boolean;
    /** false = ya pasaron los 30 días y el contenido se borró. */
    contenidoDisponible: boolean;
    revision: {
        resultado: ResultadoRevisionResumen;
        nota: string | null;
        fechaIso: string;
        quien: string | null;
    } | null;
}

export interface PanelResumenAtencion {
    config: ConfigResumenAtencion;
    servicios: ServicioDelPanel[];
    lectura: {
        cursor: string | null;
        recibidos24h: number;
        recibidos30d: number;
        ultimoRecibidoIso: string | null;
        porServicio: { servicio: string; cantidad: number }[];
    };
    /** Cuánto tardaron las consultas del agente al HIS en el último día. */
    medicion: ResumenMedicionesLectura | null;
    revision: { meta: number; correctos: number; conError: number; recientes: FilaResumenParaRevisar[] };
}

export interface ResumenAbierto {
    resumen: ResumenAtencionHis;
    hisKey: string;
    version: number;
    attendedAt: string;
}

/** ORG_ADMIN de una clínica con el espejo ENCENDIDO y el driver de Anserma. Nunca dice cuál llave falló. */
async function requireAdmin(): Promise<{ organizationId: string; userId: string; role: string } | null> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    const espejo = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: session.organizationId },
        select: { driverKey: true, enabled: true },
    });
    if (!espejo || !espejo.enabled || espejo.driverKey !== DRIVER) return null;
    return { organizationId: session.organizationId, userId: session.userId, role: session.role };
}

export async function getPanelResumenAtencionAction(): Promise<
    { success: true; panel: PanelResumenAtencion } | { success: false; error: string }
> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const ahora = Date.now();
    const desde30 = new Date(ahora - 30 * MS_DIA);
    const [fila, catalogo, recibidos24h, recibidos30d, ultimo, porServicio, revisiones, recientes] = await Promise.all([
        prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId: auth.organizationId },
            select: { resumenAtencion: true, resumenAtencionCursor: true, resumenAtencionMedicion: true },
        }),
        // Los servicios del HIS los sube el agente con el catálogo (no es exclusivo de esto).
        prisma.mirrorCatalogEntry.findMany({
            where: { organizationId: auth.organizationId, entityType: 'SERVICE' },
            select: { externalKey: true, label: true },
            orderBy: { label: 'asc' },
        }),
        prisma.attentionSummary.count({
            where: { organizationId: auth.organizationId, receivedAt: { gte: new Date(ahora - MS_DIA) } },
        }),
        prisma.attentionSummary.count({ where: { organizationId: auth.organizationId, receivedAt: { gte: desde30 } } }),
        prisma.attentionSummary.findFirst({
            where: { organizationId: auth.organizationId },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
        }),
        prisma.attentionSummary.groupBy({
            by: ['serviceCode'],
            where: { organizationId: auth.organizationId, receivedAt: { gte: desde30 } },
            _count: { _all: true },
        }),
        prisma.attentionSummary.groupBy({
            by: ['reviewResult'],
            where: { organizationId: auth.organizationId, reviewResult: { not: null } },
            _count: { _all: true },
        }),
        prisma.attentionSummary.findMany({
            where: { organizationId: auth.organizationId },
            orderBy: { attendedAt: 'desc' },
            take: RECIENTES,
            select: {
                id: true,
                hisKey: true,
                serviceCode: true,
                attendedAt: true,
                version: true,
                patientProfileId: true,
                purgedAt: true,
                reviewResult: true,
                reviewNote: true,
                reviewedAt: true,
                reviewedByUserId: true,
            },
        }),
    ]);

    const idsRevisores = [...new Set(recientes.map((r) => r.reviewedByUserId).filter((x): x is string => !!x))];
    const revisores = idsRevisores.length
        ? await prisma.user.findMany({ where: { id: { in: idsRevisores } }, select: { id: true, email: true } })
        : [];
    const correoDe = new Map(revisores.map((u) => [u.id, u.email]));
    const contar = (r: ResultadoRevisionResumen) => revisiones.find((x) => x.reviewResult === r)?._count._all ?? 0;

    const config = leerConfigResumenAtencion(fila?.resumenAtencion) ?? configResumenAtencionApagada();
    const enLaMatriz = new Set(Object.keys(config.servicios));
    const servicios: ServicioDelPanel[] = catalogo.map((c) => ({
        codigo: c.externalKey.trim(),
        nombre: c.label,
        seLee: enLaMatriz.has(c.externalKey.trim()),
    }));
    // Un servicio de la matriz que ya no está en el catálogo igual se muestra: si no, no se podría quitar.
    for (const codigo of enLaMatriz) {
        if (!servicios.some((s) => s.codigo === codigo)) servicios.push({ codigo, nombre: '(no está en el catálogo del hospital)', seLee: true });
    }

    return {
        success: true,
        panel: {
            config,
            servicios,
            lectura: {
                cursor: fila?.resumenAtencionCursor ?? null,
                recibidos24h,
                recibidos30d,
                ultimoRecibidoIso: ultimo?.receivedAt.toISOString() ?? null,
                porServicio: porServicio
                    .map((p) => ({ servicio: p.serviceCode ?? '(sin servicio)', cantidad: p._count._all }))
                    .sort((a, b) => b.cantidad - a.cantidad),
            },
            medicion: resumirMediciones(fila?.resumenAtencionMedicion, new Date(ahora)),
            revision: {
                meta: LIMITES_RESUMEN_ATENCION.revisionesParaCerrar,
                correctos: contar('CORRECTO'),
                conError: contar('CON_ERROR'),
                recientes: recientes.map((r) => ({
                    id: r.id,
                    historia: r.hisKey,
                    servicio: r.serviceCode,
                    atendidaIso: r.attendedAt.toISOString(),
                    version: r.version,
                    conPaciente: r.patientProfileId !== null,
                    contenidoDisponible: r.purgedAt === null,
                    revision:
                        (r.reviewResult === 'CORRECTO' || r.reviewResult === 'CON_ERROR') && r.reviewedAt
                            ? {
                                  resultado: r.reviewResult,
                                  nota: r.reviewNote,
                                  fechaIso: r.reviewedAt.toISOString(),
                                  quien: r.reviewedByUserId ? (correoDe.get(r.reviewedByUserId) ?? null) : null,
                              }
                            : null,
                })),
            },
        },
    };
}

/**
 * Abre un resumen para compararlo con el HIS. Lo descifra la API (la llave vive
 * allá), que además deja constancia de quién lo abrió.
 */
export async function abrirResumenAction(
    id: string,
): Promise<{ success: true; abierto: ResumenAbierto } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    if (typeof id !== 'string' || !UUID.test(id)) return { success: false, error: 'El resumen no existe.' };

    const token = (await cookies()).get('auth_token')?.value;
    let res: Response;
    try {
        res = await fetch(`${INTERNAL_API_URL}/attention-summaries/${id}`, {
            headers: token ? { Cookie: `auth_token=${token}` } : {},
            cache: 'no-store',
        });
    } catch {
        return { success: false, error: 'No se pudo contactar al servidor. Intente de nuevo.' };
    }
    if (res.status === 404) return { success: false, error: 'El resumen no existe.' };
    if (res.status === 410) return { success: false, error: 'El contenido de este resumen ya se borró (se guarda 30 días).' };
    if (res.status === 401 || res.status === 403) return { success: false, error: 'Sin permisos.' };
    if (!res.ok) return { success: false, error: `El servidor respondió ${res.status}.` };
    return { success: true, abierto: (await res.json()) as ResumenAbierto };
}

/** «Correcto» o «Con error» (con qué está mal) tras compararlo con el HIS. */
export async function revisarResumenAction(
    id: string,
    entrada: { resultado: ResultadoRevisionResumen; nota?: string },
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    const v = validarRevision(entrada);
    if (!v.ok) return { success: false, error: v.error };
    if (typeof id !== 'string' || !UUID.test(id)) return { success: false, error: 'El resumen no existe.' };

    // Solo de SU clínica y con el contenido todavía guardado: no se revisa lo que ya no se puede ver.
    const r = await prisma.attentionSummary.updateMany({
        where: { id, organizationId: auth.organizationId, purgedAt: null },
        data: {
            reviewResult: v.resultado,
            reviewNote: v.nota,
            reviewedAt: new Date(),
            reviewedByUserId: auth.userId,
        },
    });
    if (r.count === 0) return { success: false, error: 'El resumen no existe o su contenido ya se borró.' };

    const fila = await prisma.attentionSummary.findUnique({ where: { id }, select: { hisKey: true } });
    await registrarActividad({
        action: 'ATTENTION_SUMMARY_REVIEWED',
        message: `Revisó el resumen de la atención de la historia ${fila?.hisKey ?? '?'}: ${
            v.resultado === 'CORRECTO' ? 'correcto' : 'con error'
        }`,
        actor: { userId: auth.userId, role: auth.role },
        organizationId: auth.organizationId,
        // La nota puede nombrar datos clínicos: no va a la bitácora.
        metadata: { summaryId: id, hisKey: fila?.hisKey ?? null, resultado: v.resultado },
    });

    revalidatePath('/dashboard/espejo/resumen-atencion');
    return { success: true };
}

export async function updateLecturaResumenAction(
    cambio: CambioLecturaResumen,
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const fila = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: auth.organizationId },
        select: { resumenAtencion: true },
    });
    // Solo lo que el panel puede cambiar en esta fase; lo demás del objeto se ignora.
    const r = aplicarCambioDeLectura(fila?.resumenAtencion, {
        leerDelHospital: cambio?.leerDelHospital,
        serviciosALeer: cambio?.serviciosALeer,
        calmaMinutos: cambio?.calmaMinutos,
    });
    if (!r.ok) return { success: false, error: r.error };

    await prisma.hospitalMirrorConfig.update({
        where: { organizationId: auth.organizationId },
        data: { resumenAtencion: r.config as object },
    });

    if (r.cambios.length) {
        await registrarActividad({
            action: 'ATTENTION_SUMMARY_CONFIG_CHANGED',
            message: 'Configuración del resumen de la atención actualizada',
            actor: { userId: auth.userId, role: auth.role },
            organizationId: auth.organizationId,
            metadata: { detalle: r.cambios.join(' · ').slice(0, 400) },
        });
    }

    revalidatePath('/dashboard/espejo/resumen-atencion');
    return { success: true };
}
