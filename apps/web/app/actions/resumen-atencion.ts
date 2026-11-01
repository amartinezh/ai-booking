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
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { adminDelResumen } from '@/lib/resumen/acceso';
import { INTERNAL_API_URL } from '@/lib/resumen/api';
import { registrarActividad } from '@/lib/actividad/registrar';
import {
    LIMITES_RESUMEN_ATENCION,
    aplicarCambioDeDocumentos,
    aplicarCambioDeEnvio,
    aplicarCambioDeLectura,
    configResumenAtencionApagada,
    leerConfigDocumentos,
    leerConfigResumenAtencion,
    leerCorreosDeRelleno,
    resumirMediciones,
    validarRevision,
    type CambioDocumentosResumen,
    type CambioEnvioResumen,
    type CambioLecturaResumen,
    type ConfigDocumentosResumen,
    type ConfigResumenAtencion,
    type ResultadoRevisionResumen,
    type ResumenAtencionHis,
    type ResumenMedicionesLectura,
} from '@agenia/shared';

const MS_DIA = 86_400_000;
/** Resúmenes que se listan para revisar (los más recientes). */
const RECIENTES = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    /** Encabezado, logo, pie y marca de agua de los documentos (Fase 2). */
    documentos: ConfigDocumentosResumen;
    /** Si el encabezado no tiene nombre, el de la clínica. */
    nombreClinica: string;
    /** Fase 4: el envío por WhatsApp. */
    envio: {
        /** La plantilla «Documentos de la consulta» está configurada y activa. */
        plantillaConfigurada: boolean;
        /** El servidor tiene correo (SMTP) configurado; `null` si no se pudo saber. */
        correoConfigurado: boolean | null;
        /** Correos de relleno del hospital (no se usan). */
        correosDeRelleno: string[];
        /** Atenciones sin correo utilizable (vacío o de relleno), últimos 30 días. */
        sinCorreo: number;
        /** Últimos envíos, sin contenido. */
        entregas: EntregaDelPanel[];
        /** Atenciones de los últimos 30 días por estado (RECIBIDO, ENVIADO, EXCLUIDO, SIN_CONTACTO, CADUCADO). */
        porEstado: Record<string, number>;
    };
}

export interface EntregaDelPanel {
    id: string;
    historia: string;
    canal: string;
    prueba: boolean;
    destino: string;
    estado: string;
    motivo: string | null;
    avisoIso: string | null;
    documentosIso: string | null;
    verificadoPor: string | null;
}

export interface DocumentoDelPanel {
    id: string;
    titulo: string;
    hojas: number;
    nombreArchivo: string;
}

export interface ResumenAbierto {
    resumen: ResumenAtencionHis;
    hisKey: string;
    version: number;
    attendedAt: string;
}

const requireAdmin = adminDelResumen;

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

    const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { name: true } });
    const [plantilla, entregas, estados, sinCorreo, correoConfigurado] = await Promise.all([
        prisma.whatsappTemplate.findFirst({
            where: { organizationId: auth.organizationId, kind: 'ATTENTION_SUMMARY_READY', isActive: true },
            select: { id: true },
        }),
        prisma.attentionSummaryDelivery.findMany({
            // Los «sin correo utilizable» no son envíos: van en un contador.
            where: { attentionSummary: { organizationId: auth.organizationId }, status: { not: 'NO_ENVIADO' } },
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: {
                id: true,
                channel: true,
                purpose: true,
                destinationMasked: true,
                status: true,
                statusReason: true,
                noticeSentAt: true,
                documentsSentAt: true,
                verifiedBy: true,
                attentionSummary: { select: { hisKey: true } },
            },
        }),
        prisma.attentionSummary.groupBy({
            by: ['status'],
            where: { organizationId: auth.organizationId, receivedAt: { gte: desde30 } },
            _count: { _all: true },
        }),
        prisma.attentionSummaryDelivery.count({
            where: {
                attentionSummary: { organizationId: auth.organizationId },
                channel: 'EMAIL',
                status: 'NO_ENVIADO',
                createdAt: { gte: desde30 },
            },
        }),
        estadoDelCorreo(),
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
            documentos: leerConfigDocumentos(fila?.resumenAtencion),
            nombreClinica: org?.name ?? '',
            envio: {
                plantillaConfigurada: plantilla !== null,
                correoConfigurado,
                correosDeRelleno: leerCorreosDeRelleno(fila?.resumenAtencion),
                sinCorreo,
                entregas: entregas.map((e) => ({
                    id: e.id,
                    historia: e.attentionSummary.hisKey,
                    canal: e.channel,
                    prueba: e.purpose === 'PRUEBA',
                    destino: e.destinationMasked,
                    estado: e.status,
                    motivo: e.statusReason,
                    avisoIso: e.noticeSentAt?.toISOString() ?? null,
                    documentosIso: e.documentsSentAt?.toISOString() ?? null,
                    verificadoPor: e.verifiedBy,
                })),
                porEstado: Object.fromEntries(estados.map((x) => [x.status, x._count._all])),
            },
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

// ─── Fase 2: documentos ─────────────────────────────────────────────────────

/** ¿La API tiene correo (SMTP) configurado? `null` si no responde. */
async function estadoDelCorreo(): Promise<boolean | null> {
    const res = await api('GET', '/attention-summaries/settings/mail');
    if (!res?.ok) return null;
    try {
        return ((await res.json()) as { configurado?: boolean }).configurado === true;
    } catch {
        return null;
    }
}

async function api(metodo: 'GET' | 'POST', ruta: string): Promise<Response | null> {
    const token = (await cookies()).get('auth_token')?.value;
    try {
        return await fetch(`${INTERNAL_API_URL}${ruta}`, {
            method: metodo,
            headers: token ? { Cookie: `auth_token=${token}` } : {},
            cache: 'no-store',
        });
    } catch {
        return null;
    }
}

function errorDeLaApi(res: Response | null): string {
    if (!res) return 'No se pudo contactar al servidor. Intente de nuevo.';
    if (res.status === 404) return 'El resumen no existe.';
    if (res.status === 410) return 'El contenido de este resumen ya se borró (se guarda 30 días).';
    if (res.status === 401 || res.status === 403) return 'Sin permisos.';
    return `El servidor respondió ${res.status}.`;
}

/** Los documentos de un resumen (resumen, fórmulas, órdenes, remisiones, incapacidades) con sus hojas. */
export async function listarDocumentosAction(
    id: string,
): Promise<{ success: true; documentos: DocumentoDelPanel[] } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    if (typeof id !== 'string' || !UUID.test(id)) return { success: false, error: 'El resumen no existe.' };
    const res = await api('GET', `/attention-summaries/${id}/documents`);
    if (!res?.ok) return { success: false, error: errorDeLaApi(res) };
    const { documentos } = (await res.json()) as { documentos: DocumentoDelPanel[] };
    return { success: true, documentos };
}

/**
 * Un enlace de prueba a la página del paciente (`/resumen/<token>`), para verla
 * en un celular. El token solo se muestra esta vez; la API lo deja anotado.
 */
export async function crearEnlaceDePruebaAction(
    id: string,
): Promise<{ success: true; url: string; expiraIso: string } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    if (typeof id !== 'string' || !UUID.test(id)) return { success: false, error: 'El resumen no existe.' };
    const res = await api('POST', `/attention-summaries/${id}/test-links`);
    if (!res?.ok) return { success: false, error: errorDeLaApi(res) };
    const { token, expiraIso } = (await res.json()) as { token: string; expiraIso: string };
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return { success: true, url: `${proto}://${host}/resumen/${token}`, expiraIso };
}

/** El encabezado de los documentos: nombre, NIT, dirección, teléfono, logo y pie. */
export async function updateDocumentosResumenAction(
    cambio: CambioDocumentosResumen,
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    const fila = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: auth.organizationId },
        select: { resumenAtencion: true },
    });
    const r = aplicarCambioDeDocumentos(fila?.resumenAtencion, {
        nombre: cambio?.nombre,
        nit: cambio?.nit,
        direccion: cambio?.direccion,
        telefono: cambio?.telefono,
        pie: cambio?.pie,
        logo: cambio?.logo,
    });
    if (!r.ok) return { success: false, error: r.error };
    await prisma.hospitalMirrorConfig.update({
        where: { organizationId: auth.organizationId },
        data: { resumenAtencion: r.config as object },
    });
    if (r.cambios.length) {
        await registrarActividad({
            action: 'ATTENTION_SUMMARY_DOCUMENTS_CONFIG_CHANGED',
            message: 'Encabezado de los documentos del resumen de la atención actualizado',
            actor: { userId: auth.userId, role: auth.role },
            organizationId: auth.organizationId,
            metadata: { detalle: r.cambios.join(' · ').slice(0, 400) },
        });
    }
    revalidatePath('/dashboard/espejo/resumen-atencion');
    return { success: true };
}

// ─── Fase 4: envío por WhatsApp ─────────────────────────────────────────────

/**
 * «Enviar a pacientes», el canal WhatsApp, los servicios que envían y los
 * números del modo prueba. Mientras no se apruebe el piloto, «Enviar» solo
 * enciende con números del equipo (`aplicarCambioDeEnvio`).
 */
export async function updateEnvioResumenAction(
    cambio: CambioEnvioResumen,
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    const fila = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: auth.organizationId },
        select: { resumenAtencion: true },
    });
    const r = aplicarCambioDeEnvio(fila?.resumenAtencion, {
        enviar: cambio?.enviar,
        whatsapp: cambio?.whatsapp,
        telegram: cambio?.telegram,
        correo: cambio?.correo,
        correosDeRelleno: cambio?.correosDeRelleno,
        serviciosWhatsapp: cambio?.serviciosWhatsapp,
        serviciosTelegram: cambio?.serviciosTelegram,
        serviciosCorreo: cambio?.serviciosCorreo,
        destinosPrueba: cambio?.destinosPrueba,
    });
    if (!r.ok) return { success: false, error: r.error };
    await prisma.hospitalMirrorConfig.update({
        where: { organizationId: auth.organizationId },
        data: { resumenAtencion: r.config as object },
    });
    if (r.cambios.length) {
        await registrarActividad({
            action: 'ATTENTION_SUMMARY_CONFIG_CHANGED',
            message: 'Envío del resumen de la atención actualizado',
            actor: { userId: auth.userId, role: auth.role },
            organizationId: auth.organizationId,
            metadata: { detalle: r.cambios.join(' · ').slice(0, 400) },
        });
    }
    revalidatePath('/dashboard/espejo/resumen-atencion');
    return { success: true };
}

/** «Enviar de prueba»: el aviso de este resumen a un número del modo prueba. */
export async function enviarDePruebaAction(
    id: string,
    destino: string,
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };
    if (typeof id !== 'string' || !UUID.test(id)) return { success: false, error: 'El resumen no existe.' };
    const token = (await cookies()).get('auth_token')?.value;
    let res: Response;
    try {
        res = await fetch(`${INTERNAL_API_URL}/attention-summaries/${id}/test-send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `auth_token=${token}` } : {}) },
            body: JSON.stringify({ destino }),
            cache: 'no-store',
        });
    } catch {
        return { success: false, error: 'No se pudo contactar al servidor. Intente de nuevo.' };
    }
    if (res.status === 400) return { success: false, error: 'Solo se envía de prueba a un número de la lista del modo prueba.' };
    if (!res.ok) return { success: false, error: errorDeLaApi(res) };
    const r = (await res.json()) as { ok: boolean; motivo?: string };
    revalidatePath('/dashboard/espejo/resumen-atencion');
    return r.ok ? { success: true } : { success: false, error: `El aviso no salió: ${r.motivo ?? 'motivo desconocido'}` };
}
