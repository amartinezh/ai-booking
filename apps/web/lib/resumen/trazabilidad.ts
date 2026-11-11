import { Prisma, type PrismaClient } from '@agenia/database';
import { prisma } from '@/lib/prisma';

/**
 * 🧾 Trazabilidad del resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md
 * §8.10): qué pasó con cada envío, mensaje por mensaje, y las cifras de un
 * período. Solo lectura y sin contenido clínico.
 *
 * De dónde sale cada dato:
 *  - el aviso, los documentos y los textos de WhatsApp: `WhatsappMessageLog`
 *    con `attentionSummaryDeliveryId` (enviado, entregado y leído con su hora,
 *    o el error de Meta);
 *  - Telegram: `TelegramMessageLog` (Telegram solo dice si aceptó el mensaje;
 *    no informa entregado ni leído);
 *  - el correo: el envío mismo (el servidor de correo lo aceptó; no informa si
 *    se leyó);
 *  - pidió y verificó: `AttentionSummaryDelivery.requestedAt` y `verifiedAt`;
 *  - la página: `AttentionSummaryAccess` de los enlaces del paciente (los de
 *    prueba no cuentan).
 *
 * Los mensajes enviados antes del 2026-11-11 no tienen envío asociado ni horas:
 * para ellos solo queda el estado.
 */

type Db = Pick<PrismaClient, '$queryRaw'>;

export type EstadoMeta = 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface AvisoDelEnvio {
    /** Cómo salió el aviso. null si no salió. */
    tipo: 'PLANTILLA' | 'MENSAJE' | 'TELEGRAM' | 'CORREO' | null;
    enviadoIso: string | null;
    /** Solo WhatsApp informa entregado y leído. */
    entregadoIso: string | null;
    leidoIso: string | null;
    /** El último estado que reportó Meta (WhatsApp). */
    estado: EstadoMeta | null;
    /** El error de Meta o de Telegram, si no se entregó. */
    error: string | null;
}

export interface TrazaDelEnvio {
    aviso: AvisoDelEnvio;
    pidioIso: string | null;
    verificadoIso: string | null;
    documentosIso: string | null;
    /** Los PDF y las imágenes: cuántos salieron y, en WhatsApp, cuántos se entregaron y se vieron. */
    archivos: { enviados: number; entregados: number; leidos: number; fallidos: number };
}

interface FilaDeMensaje {
    entrega: string;
    canal: 'WHATSAPP' | 'TELEGRAM';
    tipo: string;
    estado: string;
    enviado: Date;
    entregado: Date | null;
    leido: Date | null;
    error: string | null;
}

const ARCHIVO = new Set(['DOCUMENT', 'IMAGE', 'PHOTO']);
const AVISO_WA = new Set(['TEMPLATE', 'INTERACTIVE']);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * El recorrido de cada envío. `entregas` trae lo que ya está en la fila del
 * envío; los mensajes se buscan por su id.
 */
export async function trazaDeEnvios(
    organizationId: string,
    entregas: {
        id: string;
        channel: string;
        noticeSentAt: Date | null;
        requestedAt: Date | null;
        verifiedAt: Date | null;
        documentsSentAt: Date | null;
        templateName: string | null;
    }[],
    db: Db = prisma,
): Promise<Map<string, TrazaDelEnvio>> {
    const ids = entregas.map((e) => e.id);
    const filas = ids.length
        ? await db.$queryRaw<FilaDeMensaje[]>(Prisma.sql`
            SELECT "attentionSummaryDeliveryId" AS entrega, 'WHATSAPP' AS canal, "messageType"::text AS tipo,
                   status::text AS estado, "createdAt" AS enviado, "deliveredAt" AS entregado, "readAt" AS leido,
                   NULLIF(concat_ws(' ', "errorCode", "errorDetail"), '') AS error
              FROM "WhatsappMessageLog"
             WHERE "organizationId" = ${organizationId} AND "attentionSummaryDeliveryId" IN (${Prisma.join(ids)})
            UNION ALL
            SELECT "attentionSummaryDeliveryId", 'TELEGRAM', "messageType"::text, status::text, "createdAt", NULL, NULL,
                   NULLIF(concat_ws(' ', "errorCode", "errorDetail"), '')
              FROM "TelegramMessageLog"
             WHERE "organizationId" = ${organizationId} AND "attentionSummaryDeliveryId" IN (${Prisma.join(ids)})
             ORDER BY 5`)
        : [];

    const porEntrega = new Map<string, FilaDeMensaje[]>();
    for (const f of filas) {
        const lista = porEntrega.get(f.entrega) ?? [];
        lista.push(f);
        porEntrega.set(f.entrega, lista);
    }

    const r = new Map<string, TrazaDelEnvio>();
    for (const e of entregas) {
        const mensajes = porEntrega.get(e.id) ?? [];
        r.set(e.id, {
            aviso: avisoDe(e, mensajes),
            pidioIso: iso(e.requestedAt),
            verificadoIso: iso(e.verifiedAt),
            documentosIso: iso(e.documentsSentAt),
            archivos: archivosDe(mensajes),
        });
    }
    return r;
}

function avisoDe(
    e: { channel: string; noticeSentAt: Date | null; templateName: string | null },
    mensajes: FilaDeMensaje[],
): AvisoDelEnvio {
    if (e.channel === 'EMAIL') {
        return {
            tipo: e.noticeSentAt ? 'CORREO' : null,
            enviadoIso: iso(e.noticeSentAt),
            entregadoIso: null,
            leidoIso: null,
            estado: null,
            error: null,
        };
    }
    // El aviso es el primer mensaje del envío: la plantilla o el mensaje con
    // botón (WhatsApp), o el texto con el botón de teclado (Telegram).
    const aviso =
        e.channel === 'WHATSAPP'
            ? mensajes.find((m) => m.canal === 'WHATSAPP' && AVISO_WA.has(m.tipo))
            : mensajes.find((m) => m.canal === 'TELEGRAM');
    if (!aviso) {
        return {
            tipo: e.noticeSentAt ? (e.channel === 'TELEGRAM' ? 'TELEGRAM' : e.templateName ? 'PLANTILLA' : 'MENSAJE') : null,
            enviadoIso: iso(e.noticeSentAt),
            entregadoIso: null,
            leidoIso: null,
            estado: null,
            error: null,
        };
    }
    if (aviso.canal === 'TELEGRAM') {
        return {
            tipo: 'TELEGRAM',
            enviadoIso: iso(aviso.enviado),
            entregadoIso: null,
            leidoIso: null,
            estado: aviso.estado === 'FAILED' ? 'FAILED' : 'ACCEPTED',
            error: aviso.estado === 'FAILED' ? aviso.error : null,
        };
    }
    const estado = aviso.estado as EstadoMeta;
    const entregado = aviso.entregado ?? aviso.leido;
    return {
        tipo: aviso.tipo === 'TEMPLATE' ? 'PLANTILLA' : 'MENSAJE',
        enviadoIso: iso(aviso.enviado),
        entregadoIso: iso(entregado),
        leidoIso: iso(aviso.leido),
        estado,
        error: estado === 'FAILED' ? (aviso.error ?? 'Meta no lo entregó') : null,
    };
}

function archivosDe(mensajes: FilaDeMensaje[]): TrazaDelEnvio['archivos'] {
    const archivos = mensajes.filter((m) => ARCHIVO.has(m.tipo));
    return {
        enviados: archivos.filter((m) => m.estado !== 'FAILED').length,
        entregados: archivos.filter((m) => m.canal === 'WHATSAPP' && (m.entregado || m.leido || m.estado === 'DELIVERED' || m.estado === 'READ')).length,
        leidos: archivos.filter((m) => m.canal === 'WHATSAPP' && (m.leido || m.estado === 'READ')).length,
        fallidos: archivos.filter((m) => m.estado === 'FAILED').length,
    };
}

// ─── Las cifras de un período ─────────────────────────────────────────────

export interface EmbudoDelEnvio {
    /** Las consultas leídas del hospital en el período y qué pasó con cada una. */
    atenciones: {
        leidas: number;
        avisadas: number;
        excluidas: number;
        /** De las excluidas, por baja del paciente. */
        porBaja: number;
        sinContacto: number;
        /** Todavía sin enviar: envío apagado, fuera del horario o esperando un interruptor. */
        sinEnviar: number;
    };
    /** Los avisos que salieron (sin los de prueba). Un reenvío cuenta como otro aviso. */
    avisos: { total: number; reenvios: number; whatsapp: number; telegram: number; correo: number };
    /** Avisos que no salieron (Meta, Telegram o el correo los rechazaron). */
    avisosQueNoSalieron: number;
    /** Lo que Meta informa de los avisos de WhatsApp. */
    whatsapp: { entregados: number; leidos: number; fallidos: number; sinConfirmar: number };
    pidieron: number;
    verificados: number;
    /** Recibieron todos sus documentos (por WhatsApp, Telegram o correo). */
    recibieron: number;
    /** Archivos (PDF e imágenes) por WhatsApp. */
    archivos: { enviados: number; entregados: number; leidos: number };
    /** Atenciones cuya página abrió el paciente con su fecha de nacimiento. */
    abrieronLaPagina: number;
    /** Bajas registradas en el período («no quiero resúmenes»). */
    bajas: number;
    porDia: { dia: string; avisos: number; entregados: number; leidos: number; pidieron: number; recibieron: number }[];
}

const MOTIVO_BAJA = 'El paciente se dio de baja de los resúmenes';

/** Instante UTC → la forma de las columnas (timestamp sin zona, en UTC). */
const comoColumna = (instante: Date) => Prisma.sql`(${instante.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Las cifras del envío entre `desde` (incluido) y `hasta` (excluido). Los
 * avisos cuentan por el día en que se creó el envío; las atenciones, por el
 * día en que llegaron del hospital. Sin los envíos de prueba.
 */
export async function consultarEmbudoDelEnvio(
    organizationId: string,
    rango: { desde: Date; hasta: Date },
    timeZone: string,
    db: Db = prisma,
): Promise<EmbudoDelEnvio> {
    const org = organizationId;
    const desde = comoColumna(rango.desde);
    const hasta = comoColumna(rango.hasta);
    const dia = Prisma.sql`to_char(((e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text)::date, 'YYYY-MM-DD')`;
    const envios = Prisma.sql`
        e AS (
            SELECT d.id, d.channel, d.purpose, d.status, d."noticeSentAt", d."requestedAt", d."verifiedAt",
                   d."documentsSentAt", d."createdAt"
              FROM "AttentionSummaryDelivery" d
              JOIN "AttentionSummary" s ON s.id = d."attentionSummaryId"
             WHERE s."organizationId" = ${org} AND d.purpose IN ('PACIENTE', 'REENVIO') AND d.status <> 'NO_ENVIADO'
               AND d."createdAt" >= ${desde} AND d."createdAt" < ${hasta}),
        w AS (
            SELECT "attentionSummaryDeliveryId" AS id,
                   bool_or("messageType" IN ('TEMPLATE', 'INTERACTIVE')
                           AND (status IN ('DELIVERED', 'READ') OR "deliveredAt" IS NOT NULL)) AS entregado,
                   bool_or("messageType" IN ('TEMPLATE', 'INTERACTIVE') AND (status = 'READ' OR "readAt" IS NOT NULL)) AS leido,
                   bool_or("messageType" IN ('TEMPLATE', 'INTERACTIVE') AND status = 'FAILED') AS fallido,
                   count(*) FILTER (WHERE "messageType" IN ('DOCUMENT', 'IMAGE') AND status <> 'FAILED')::int AS archivos,
                   count(*) FILTER (WHERE "messageType" IN ('DOCUMENT', 'IMAGE') AND status IN ('DELIVERED', 'READ'))::int AS "archivosEntregados",
                   count(*) FILTER (WHERE "messageType" IN ('DOCUMENT', 'IMAGE') AND status = 'READ')::int AS "archivosLeidos"
              FROM "WhatsappMessageLog"
             WHERE "organizationId" = ${org} AND "attentionSummaryDeliveryId" IN (SELECT id FROM e)
             GROUP BY 1)`;
    const salio = Prisma.sql`e."noticeSentAt" IS NOT NULL`;
    const recibio = Prisma.sql`(e."documentsSentAt" IS NOT NULL AND e.status = 'DOCUMENTOS_ENVIADOS')`;

    const [[t], porDia, [a], [p], [b]] = await Promise.all([
        db.$queryRaw<
            [
                {
                    avisos: number;
                    reenvios: number;
                    whatsapp: number;
                    telegram: number;
                    correo: number;
                    noSalieron: number;
                    entregados: number;
                    leidos: number;
                    fallidos: number;
                    pidieron: number;
                    verificados: number;
                    recibieron: number;
                    archivos: number;
                    archivosEntregados: number;
                    archivosLeidos: number;
                },
            ]
        >(Prisma.sql`
            WITH ${envios}
            SELECT count(*) FILTER (WHERE ${salio})::int AS avisos,
                   count(*) FILTER (WHERE ${salio} AND e.purpose = 'REENVIO')::int AS reenvios,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'WHATSAPP')::int AS whatsapp,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'TELEGRAM')::int AS telegram,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'EMAIL')::int AS correo,
                   count(*) FILTER (WHERE NOT ${salio} AND e.status = 'FALLO')::int AS "noSalieron",
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'WHATSAPP' AND w.entregado)::int AS entregados,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'WHATSAPP' AND w.leido)::int AS leidos,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'WHATSAPP' AND w.fallido AND NOT coalesce(w.entregado, false))::int AS fallidos,
                   count(*) FILTER (WHERE e."requestedAt" IS NOT NULL)::int AS pidieron,
                   count(*) FILTER (WHERE e."verifiedAt" IS NOT NULL)::int AS verificados,
                   count(*) FILTER (WHERE ${recibio})::int AS recibieron,
                   coalesce(sum(w.archivos), 0)::int AS archivos,
                   coalesce(sum(w."archivosEntregados"), 0)::int AS "archivosEntregados",
                   coalesce(sum(w."archivosLeidos"), 0)::int AS "archivosLeidos"
              FROM e LEFT JOIN w ON w.id = e.id`),
        db.$queryRaw<EmbudoDelEnvio['porDia']>(Prisma.sql`
            WITH ${envios}
            SELECT ${dia} AS dia,
                   count(*) FILTER (WHERE ${salio})::int AS avisos,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'WHATSAPP' AND w.entregado)::int AS entregados,
                   count(*) FILTER (WHERE ${salio} AND e.channel = 'WHATSAPP' AND w.leido)::int AS leidos,
                   count(*) FILTER (WHERE e."requestedAt" IS NOT NULL)::int AS pidieron,
                   count(*) FILTER (WHERE ${recibio})::int AS recibieron
              FROM e LEFT JOIN w ON w.id = e.id
             GROUP BY 1 ORDER BY 1`),
        db.$queryRaw<[EmbudoDelEnvio['atenciones']]>(Prisma.sql`
            SELECT count(*)::int AS leidas,
                   count(*) FILTER (WHERE status = 'ENVIADO')::int AS avisadas,
                   count(*) FILTER (WHERE status = 'EXCLUIDO')::int AS excluidas,
                   count(*) FILTER (WHERE status = 'EXCLUIDO' AND "statusReason" = ${MOTIVO_BAJA})::int AS "porBaja",
                   count(*) FILTER (WHERE status = 'SIN_CONTACTO')::int AS "sinContacto",
                   count(*) FILTER (WHERE status = 'RECIBIDO')::int AS "sinEnviar"
              FROM "AttentionSummary"
             WHERE "organizationId" = ${org} AND "receivedAt" >= ${desde} AND "receivedAt" < ${hasta}`),
        db.$queryRaw<[{ n: number }]>(Prisma.sql`
            SELECT count(DISTINCT a."attentionSummaryId")::int AS n
              FROM "AttentionSummaryAccess" a
              JOIN "AttentionSummaryLink" l ON l.id = a."linkId"
              JOIN "AttentionSummary" s ON s.id = a."attentionSummaryId"
             WHERE s."organizationId" = ${org} AND a.kind = 'VER' AND l.purpose = 'PACIENTE'
               AND a."createdAt" >= ${desde} AND a."createdAt" < ${hasta}`),
        db.$queryRaw<[{ n: number }]>(Prisma.sql`
            SELECT count(*)::int AS n FROM "AttentionSummaryOptOut"
             WHERE "organizationId" = ${org} AND "createdAt" >= ${desde} AND "createdAt" < ${hasta}`),
    ]);

    return {
        atenciones: a,
        avisos: { total: t.avisos, reenvios: t.reenvios, whatsapp: t.whatsapp, telegram: t.telegram, correo: t.correo },
        avisosQueNoSalieron: t.noSalieron,
        whatsapp: {
            entregados: t.entregados,
            leidos: t.leidos,
            fallidos: t.fallidos,
            sinConfirmar: Math.max(0, t.whatsapp - t.entregados - t.fallidos),
        },
        pidieron: t.pidieron,
        verificados: t.verificados,
        recibieron: t.recibieron,
        archivos: { enviados: t.archivos, entregados: t.archivosEntregados, leidos: t.archivosLeidos },
        abrieronLaPagina: p.n,
        bajas: b.n,
        porDia,
    };
}
