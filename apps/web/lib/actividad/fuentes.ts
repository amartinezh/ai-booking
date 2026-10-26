/**
 * 👣 ACTIVIDAD DE USUARIOS — de dónde sale cada evento.
 *
 * El sistema no tiene UNA tabla de auditoría: cada módulo guardó su rastro donde
 * lo necesitaba (el rastreo en `PatientLookupLog`, la Bandeja en
 * `SyncExceptionLog`, la configuración del espejo en `SyncAudit`…). Cada fuente de
 * este archivo lee una de esas tablas con los mismos filtros (clínica, usuario,
 * categoría, fechas y cursor) y devuelve eventos con la forma común; la acción
 * (`app/actions/actividad.ts`) las mezcla con `mezclarPagina`.
 *
 * Solo lectura. Cada fuente trae, como mucho, `limite + HOLGURA` eventos con hora
 * <= la del cursor: la holgura absorbe los eventos de la misma hora exacta que ya
 * se mostraron en la página anterior.
 */
import { Prisma, type PrismaClient } from '@agenia/database';
import {
    MOTIVOS_CONSULTA,
    SYNC_AUDIT_DIRECTION,
    TITULO_EXCEPCION,
    etiquetaMotivoSolicitudCitas,
    type TipoExcepcion,
} from '@agenia/shared';
import {
    ACCIONES_DE_LA_BITACORA,
    ACCIONES_SIN_USUARIO,
    MOTIVO_INGRESO_FALLIDO,
    accionesDeCategorias,
    describirNavegador,
    enmascarar,
    leerAccionDeLaBitacora,
    recortar,
    type Categoria,
} from './catalogo';
import type { AlcanceClinica } from './filtros';
import type { Cursor, EventoDeActividad } from './linea-de-tiempo';

export const HOLGURA = 20;

export interface ConsultaDeFuente {
    clinica: AlcanceClinica;
    /** El usuario filtrado, con su correo (algunas fuentes solo guardan el correo). */
    usuario: { id: string; email: string } | null;
    categoria: Categoria | null;
    /** Incluir las pantallas abiertas aunque no se haya elegido esa categoría. */
    vistas?: boolean;
    desdeUtc: Date | null;
    hastaUtc: Date | null;
    cursor: Cursor | null;
    /** Cuántos eventos pide la página (cada fuente trae este número + HOLGURA). */
    limite: number;
}

type Db = PrismaClient;

export interface Fuente {
    clave: string;
    /** Las categorías que puede producir (para saltarla si se filtra por otra). */
    categorias: readonly Categoria[];
    /** ¿Tiene filas sin clínica (de la plataforma)? */
    tienePlataforma?: boolean;
    buscar(db: Db, c: ConsultaDeFuente): Promise<EventoDeActividad[]>;
}

// ─────────────────────────────────────────────────────────────
// Ayudas comunes
// ─────────────────────────────────────────────────────────────

/** El filtro de fechas de una columna: rango pedido y tope del cursor. */
function rango(c: ConsultaDeFuente): Prisma.DateTimeFilter {
    const f: Prisma.DateTimeFilter = {};
    if (c.desdeUtc) f.gte = c.desdeUtc;
    if (c.hastaUtc) f.lt = c.hastaUtc;
    if (c.cursor) f.lte = new Date(c.cursor.at);
    return f;
}

/** El filtro de clínica para una columna `organizationId` obligatoria. */
function clinicaObligatoria(c: ConsultaDeFuente): { organizationId?: string } | null {
    if (c.clinica.tipo === 'PLATAFORMA') return null; // estas tablas no tienen filas sin clínica
    if (c.clinica.tipo === 'CLINICA') return { organizationId: c.clinica.id };
    return {};
}

const tope = (c: ConsultaDeFuente) => c.limite + HOLGURA;

function texto(v: unknown): string | null {
    return typeof v === 'string' && v.trim() ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ─────────────────────────────────────────────────────────────
// 1. Bitácora del sistema: ingresos, claves, cuentas, días sin citas…
// ─────────────────────────────────────────────────────────────

const ACCIONES_CONOCIDAS = Object.keys(ACCIONES_DE_LA_BITACORA);

export const fuenteBitacora: Fuente = {
    clave: 'log',
    categorias: [
        'INGRESOS',
        'SEGURIDAD',
        'CUENTAS',
        'CITAS',
        'PACIENTES',
        'CATALOGOS',
        'CONFIGURACION',
        'AVISOS',
        'PLATAFORMA',
        'HISTORIA',
        'PADRON',
        'SOPORTE',
        'DESCARGAS',
        'PANTALLAS',
        'OTROS',
    ],
    tienePlataforma: true,
    async buscar(db, c) {
        const where: Prisma.SystemLogWhereInput = {
            // Los errores técnicos también traen usuario (el filtro de excepciones lo
            // anota): no son actividad de nadie.
            level: { in: ['EVENT', 'WARNING'] },
            OR: [{ userId: { not: null } }, { action: { in: [...ACCIONES_SIN_USUARIO] } }],
            createdAt: rango(c),
        };
        const y: Prisma.SystemLogWhereInput[] = [];
        if (c.clinica.tipo === 'PLATAFORMA') y.push({ organizationId: null });
        if (c.clinica.tipo === 'CLINICA') y.push({ organizationId: c.clinica.id });
        if (c.usuario) y.push({ userId: c.usuario.id });
        if (c.categoria === 'OTROS') y.push({ action: { notIn: ACCIONES_CONOCIDAS } });
        else if (c.categoria) y.push({ action: { in: accionesDeCategorias(new Set([c.categoria])) } });
        // Las pantallas abiertas son muchas: solo con la casilla o con su categoría.
        if (!c.vistas && c.categoria !== 'PANTALLAS') y.push({ action: { not: 'SCREEN_VIEWED' } });
        if (y.length) where.AND = y;

        const filas = await db.systemLog.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
        });
        return filas.map((f): EventoDeActividad => {
            const meta = obj(f.metadata) ?? {};
            const leida = leerAccionDeLaBitacora(f.action, f.message);
            const ua = texto(meta.userAgent);
            let detalle = texto(meta.detalle) ?? leida.detalle;
            if (f.action === 'LOGIN_FAILED' || f.action === 'LOGIN_BLOCKED') {
                const motivo = MOTIVO_INGRESO_FALLIDO[meta.motivo as keyof typeof MOTIVO_INGRESO_FALLIDO];
                const correo = texto(meta.email);
                detalle = [correo ? `Con el correo ${correo}` : null, motivo ? `(${motivo})` : null]
                    .filter(Boolean)
                    .join(' ') || detalle;
            }
            return {
                clave: `log:${f.id}`,
                at: f.createdAt.toISOString(),
                categoria: leida.categoria,
                accion: f.action,
                titulo: leida.titulo,
                detalle,
                aviso: leida.aviso || f.level === 'WARNING',
                organizationId: f.organizationId,
                actor: {
                    userId: f.userId,
                    // En un fallido sin cuenta, el correo es el que se intentó, no un actor.
                    email: f.userId ? texto(meta.email) : null,
                    role: texto(meta.role),
                },
                ip: texto(meta.ip),
                navegador: ua ? describirNavegador(ua) : null,
                extra: { ...meta, ...(ua ? { userAgent: ua } : {}) },
            };
        });
    },
};

// ─────────────────────────────────────────────────────────────
// 2. Rastreo de paciente: cada búsqueda, expediente abierto, dato descubierto
// ─────────────────────────────────────────────────────────────

const TIPO_CONSULTA: Record<string, string> = {
    CEDULA: 'Buscó un paciente por cédula',
    PHONE: 'Buscó un paciente por teléfono',
    BSUID: 'Buscó un paciente por su identificador de WhatsApp',
    NAME: 'Buscó un paciente por nombre',
    OPEN: 'Abrió el expediente de un paciente',
    REVEAL: 'Mostró los datos completos de un paciente',
    LIVE_HIS: 'Consultó en vivo al sistema del hospital',
    CONFIRM: 'Le envió al paciente la confirmación de su cita',
};

export const fuenteRastreo: Fuente = {
    clave: 'rastreo',
    categorias: ['PACIENTES'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.patientLookupLog.findMany({
            where: {
                ...clinica,
                ...(c.usuario ? { actorUserId: c.usuario.id } : {}),
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                organizationId: true,
                actorUserId: true,
                actorRole: true,
                mode: true,
                queryKind: true,
                queryMasked: true,
                reason: true,
                reasonNote: true,
                openedPatientId: true,
                liveHisRequested: true,
                createdAt: true,
            },
        });
        return filas.map((f) => {
            const motivo = MOTIVOS_CONSULTA.find((m) => m.codigo === f.reason)?.etiqueta ?? f.reason;
            const pantalla = f.mode === 'B' ? 'Lo agendaron en el HIS' : 'Dice que agendó';
            return {
                clave: `rastreo:${f.id}`,
                at: f.createdAt.toISOString(),
                categoria: 'PACIENTES' as const,
                accion: `RASTREO_${f.queryKind}`,
                titulo: TIPO_CONSULTA[f.queryKind] ?? `Rastreo de paciente (${f.queryKind})`,
                detalle: [
                    f.queryMasked ? `«${f.queryMasked}»` : null,
                    `motivo: ${motivo}${f.reasonNote ? ` — ${recortar(f.reasonNote, 120)}` : ''}`,
                    `pestaña «${pantalla}»`,
                ]
                    .filter(Boolean)
                    .join(' · '),
                aviso: f.queryKind === 'REVEAL',
                organizationId: f.organizationId,
                actor: { userId: f.actorUserId, email: null, role: f.actorRole },
                ip: null,
                navegador: null,
                extra: {
                    modo: f.mode,
                    tipo: f.queryKind,
                    busqueda: f.queryMasked,
                    motivo: f.reason,
                    expedienteAbierto: !!f.openedPatientId,
                    consultaEnVivo: f.liveHisRequested,
                },
            };
        });
    },
};

// ─────────────────────────────────────────────────────────────
// 3. Bandeja de sincronización: tomar, soltar, resolver, descartar, reabrir
// ─────────────────────────────────────────────────────────────

const ACCION_BANDEJA: Record<string, string> = {
    TOMADA: 'Tomó un caso de la Bandeja',
    SOLTADA: 'Soltó un caso de la Bandeja',
    REASIGNADA: 'Se asignó un caso de la Bandeja que tenía otra persona',
    RESUELTA: 'Resolvió un caso de la Bandeja',
    DESCARTADA: 'Descartó un caso de la Bandeja',
    REABIERTA: 'Reabrió un caso de la Bandeja',
};

export const fuenteBandeja: Fuente = {
    clave: 'bandeja',
    categorias: ['BANDEJA'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.syncExceptionLog.findMany({
            where: {
                // Las del vigilante (sin persona) no son actividad de un usuario.
                actorUserId: c.usuario ? c.usuario.id : { not: null },
                ...(clinica.organizationId ? { exception: { organizationId: clinica.organizationId } } : {}),
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                action: true,
                actorUserId: true,
                actorRole: true,
                note: true,
                createdAt: true,
                exception: { select: { id: true, kind: true, title: true, organizationId: true } },
            },
        });
        return filas.map((f) => {
            const tipo = TITULO_EXCEPCION[f.exception.kind as TipoExcepcion] ?? f.exception.title;
            return {
                clave: `bandeja:${f.id}`,
                at: f.createdAt.toISOString(),
                categoria: 'BANDEJA' as const,
                accion: `BANDEJA_${f.action}`,
                titulo: ACCION_BANDEJA[f.action] ?? `Bandeja: ${f.action}`,
                detalle: [`«${tipo}»`, f.note ? `nota: ${recortar(f.note, 160)}` : null].filter(Boolean).join(' · '),
                aviso: f.action === 'DESCARTADA',
                organizationId: f.exception.organizationId,
                actor: { userId: f.actorUserId, email: null, role: f.actorRole },
                ip: null,
                navegador: null,
                extra: { caso: f.exception.id, tipo: f.exception.kind, accion: f.action },
            };
        });
    },
};

// ─────────────────────────────────────────────────────────────
// 4. Configuración con espejo: interruptores, plazo, servicios, avisos…
// ─────────────────────────────────────────────────────────────

/**
 * La auditoría del espejo (`SyncAudit`) mezcla lo que hace la sincronización con
 * lo que cambia una persona desde el panel. Solo son de una persona los cambios
 * de configuración (`CONFIG`) y el reproceso manual de un evento. Esa tabla no
 * tiene columna de usuario: quién lo hizo va escrito en el texto («… por
 * ana@clinica.com»), y por eso el filtro de usuario busca su correo ahí.
 */
/**
 * El autor que la auditoría del espejo escribe dentro del texto («… por
 * ana@clinica.co: …»). Sin correo (algunas solo dicen el rol) devuelve null.
 */
export function autorEnElTexto(detalle: string | null | undefined): string | null {
    const m = /\bpor ([^\s:,;()«»]+@[^\s:,;()«»]+?)[.:,;]?(?:\s|$)/.exec(detalle ?? '');
    return m ? m[1] : null;
}

export const fuenteConfiguracion: Fuente = {
    clave: 'config',
    categorias: ['CONFIGURACION'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const y: Prisma.SyncAuditWhereInput[] = [
            { OR: [{ direction: SYNC_AUDIT_DIRECTION.CONFIG }, { op: 'REPROCESS' }] },
        ];
        if (c.usuario) {
            // Un usuario ya borrado llega sin correo: un `contains: ''` lo traería todo.
            const OR: Prisma.SyncAuditWhereInput[] = [{ detail: { contains: c.usuario.id } }];
            if (c.usuario.email) OR.push({ detail: { contains: c.usuario.email, mode: 'insensitive' } });
            y.push({ OR });
        }
        const filas = await db.syncAudit.findMany({
            where: { ...clinica, createdAt: rango(c), AND: y },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: { id: true, organizationId: true, entityType: true, op: true, detail: true, createdAt: true },
        });
        return filas.map((f) => ({
            clave: `config:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'CONFIGURACION' as const,
            accion: f.op,
            titulo: f.op === 'REPROCESS' ? 'Devolvió a la cola un evento hacia el hospital' : 'Cambió la configuración',
            detalle: recortar(f.detail, 400) || null,
            aviso: false,
            organizationId: f.organizationId,
            actor: { userId: null, email: autorEnElTexto(f.detail), role: null },
            ip: null,
            navegador: null,
            extra: { entidad: f.entityType, operacion: f.op },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 5. Padrón EPS: cada corte cargado
// ─────────────────────────────────────────────────────────────

export const fuentePadron: Fuente = {
    clave: 'padron',
    categorias: ['PADRON'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.padronImport.findMany({
            where: {
                ...clinica,
                ...(c.usuario ? { createdByUserId: c.usuario.id } : {}),
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                organizationId: true,
                createdByUserId: true,
                fileName: true,
                totalDataRows: true,
                validRows: true,
                errorRows: true,
                created: true,
                updated: true,
                reactivated: true,
                deactivated: true,
                createdAt: true,
                eps: { select: { name: true } },
            },
        });
        return filas.map((f) => ({
            clave: `padron:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'PADRON' as const,
            accion: 'PADRON_IMPORT',
            titulo: `Cargó el padrón de ${f.eps.name}`,
            detalle:
                `Archivo «${recortar(f.fileName, 80)}»: ${f.validRows} de ${f.totalDataRows} filas válidas · ` +
                `${f.created} nuevos, ${f.updated} actualizados, ${f.reactivated} reactivados, ${f.deactivated} desactivados`,
            aviso: f.deactivated > 0,
            organizationId: f.organizationId,
            actor: { userId: f.createdByUserId, email: null, role: null },
            ip: null,
            navegador: null,
            extra: { filasConError: f.errorRows },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 6. Avisos masivos: cada lote armado
// ─────────────────────────────────────────────────────────────

export const fuenteAvisos: Fuente = {
    clave: 'avisos',
    categorias: ['AVISOS'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.massNoticeBatch.findMany({
            where: {
                ...clinica,
                ...(c.usuario ? { createdByUserId: c.usuario.id } : {}),
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                organizationId: true,
                createdByUserId: true,
                kind: true,
                status: true,
                doctorLabel: true,
                serviceLabel: true,
                selected: true,
                sent: true,
                failed: true,
                createdAt: true,
            },
        });
        return filas.map((f) => ({
            clave: `avisos:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'AVISOS' as const,
            accion: 'MASS_NOTICE_BATCH',
            titulo: 'Armó un lote de avisos masivos',
            detalle: [
                f.doctorLabel,
                f.serviceLabel,
                `${f.selected} destinatarios`,
                `estado: ${f.status.toLowerCase()}`,
                f.sent || f.failed ? `${f.sent} enviados, ${f.failed} fallidos` : null,
            ]
                .filter(Boolean)
                .join(' · '),
            aviso: false,
            organizationId: f.organizationId,
            actor: { userId: f.createdByUserId, email: null, role: null },
            ip: null,
            navegador: null,
            extra: { lote: f.id, tipo: f.kind },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 7. Solicitudes de más citas: cada revisión
// ─────────────────────────────────────────────────────────────

const DECISION: Record<string, string> = {
    APPROVED: 'aprobada',
    REJECTED: 'rechazada',
    PENDING: 'pendiente',
    INVITED: 'invitada',
};

export const fuenteSolicitudesCitas: Fuente = {
    clave: 'solicitud',
    categorias: ['PADRON'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.appointmentLimitRequest.findMany({
            where: {
                ...clinica,
                reviewedAt: { not: null, ...rango(c) },
                ...(c.usuario ? { reviewedByUserId: c.usuario.id } : { reviewedByUserId: { not: null } }),
            },
            orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                organizationId: true,
                reviewedByUserId: true,
                reviewedByEmail: true,
                reviewedAt: true,
                status: true,
                extraGranted: true,
                cedula: true,
                reasonCategory: true,
            },
        });
        return filas.map((f) => ({
            clave: `solicitud:${f.id}`,
            at: (f.reviewedAt as Date).toISOString(),
            categoria: 'PADRON' as const,
            accion: 'LIMIT_REQUEST_REVIEWED',
            titulo: 'Revisó una solicitud de más citas',
            detalle: [
                `Paciente ${enmascarar(f.cedula)}`,
                DECISION[f.status] ?? f.status,
                f.status === 'APPROVED' && f.extraGranted ? `+${f.extraGranted} cita(s)` : null,
                f.reasonCategory ? `motivo: ${etiquetaMotivoSolicitudCitas(f.reasonCategory)}` : null,
            ]
                .filter(Boolean)
                .join(' · '),
            aviso: false,
            organizationId: f.organizationId,
            actor: { userId: f.reviewedByUserId, email: f.reviewedByEmail, role: null },
            ip: null,
            navegador: null,
            extra: { solicitud: f.id, estado: f.status },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 8. Caja Negra: «Marcar como contactado»
// ─────────────────────────────────────────────────────────────

export const fuenteCajaNegra: Fuente = {
    clave: 'cajanegra',
    categorias: ['BANDEJA'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.interactionLog.findMany({
            where: {
                ...clinica,
                contactedAt: { not: null, ...rango(c) },
                ...(c.usuario
                    ? { contactedBy: { equals: c.usuario.email || c.usuario.id, mode: 'insensitive' as const } }
                    : {}),
            },
            orderBy: [{ contactedAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                organizationId: true,
                contactedAt: true,
                contactedBy: true,
                contactNotes: true,
                failureReason: true,
                whatsappId: true,
            },
        });
        return filas.map((f) => ({
            clave: `cajanegra:${f.id}`,
            at: (f.contactedAt as Date).toISOString(),
            categoria: 'BANDEJA' as const,
            accion: 'BLACKBOX_CONTACTED',
            titulo: 'Marcó como contactado un caso de la Caja Negra',
            detalle: [
                `Remitente ${enmascarar(f.whatsappId)}`,
                f.failureReason ? `motivo del caso: ${f.failureReason}` : null,
                f.contactNotes ? `nota: ${recortar(f.contactNotes, 160)}` : null,
            ]
                .filter(Boolean)
                .join(' · '),
            aviso: false,
            organizationId: f.organizationId,
            // Esta tabla guarda el correo o el nombre de quien contactó, no su id.
            actor: { userId: null, email: f.contactedBy, role: null },
            ip: null,
            navegador: null,
            extra: { caso: f.id },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 9 y 10. Soporte: tickets abiertos y lo que se les agregó
// ─────────────────────────────────────────────────────────────

export const fuenteTickets: Fuente = {
    clave: 'ticket',
    categorias: ['SOPORTE'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.supportTicket.findMany({
            where: {
                ...clinica,
                ...(c.usuario ? { reporterId: c.usuario.id } : {}),
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                number: true,
                title: true,
                channel: true,
                priority: true,
                organizationId: true,
                reporterId: true,
                createdAt: true,
            },
        });
        return filas.map((f) => ({
            clave: `ticket:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'SOPORTE' as const,
            accion: 'SUPPORT_TICKET_CREATED',
            titulo: `Abrió el ticket de soporte #${f.number}`,
            detalle: `«${recortar(f.title, 120)}»${f.channel === 'TELEGRAM' ? ' · por Telegram' : ''}`,
            aviso: f.priority !== 'NORMAL',
            organizationId: f.organizationId,
            actor: { userId: f.reporterId, email: null, role: null },
            ip: null,
            navegador: null,
            extra: { ticket: f.id, prioridad: f.priority },
        }));
    },
};

export const fuenteNotasDeTickets: Fuente = {
    clave: 'nota',
    categorias: ['SOPORTE'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.supportTicketNote.findMany({
            where: {
                authorId: c.usuario ? c.usuario.id : { not: null },
                ...(clinica.organizationId ? { ticket: { organizationId: clinica.organizationId } } : {}),
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: {
                id: true,
                kind: true,
                channel: true,
                authorId: true,
                createdAt: true,
                ticket: { select: { id: true, number: true, organizationId: true } },
            },
        });
        return filas.map((f) => ({
            clave: `nota:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'SOPORTE' as const,
            accion: `SUPPORT_TICKET_${f.kind}`,
            titulo:
                f.kind === 'REAPERTURA'
                    ? `Reabrió el ticket de soporte #${f.ticket.number}`
                    : `Amplió el ticket de soporte #${f.ticket.number}`,
            detalle: f.channel === 'TELEGRAM' ? 'Por Telegram' : null,
            aviso: false,
            organizationId: f.ticket.organizationId,
            actor: { userId: f.authorId, email: null, role: null },
            ip: null,
            navegador: null,
            extra: { ticket: f.ticket.id },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 11. Exclusiones del espejo (documentos que no se sincronizan)
// ─────────────────────────────────────────────────────────────

export const fuenteExclusiones: Fuente = {
    clave: 'exclusion',
    categorias: ['CONFIGURACION'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const filas = await db.mirrorPatientOptOut.findMany({
            where: {
                ...clinica,
                createdByUserId: c.usuario ? c.usuario.id : { not: null },
                createdAt: rango(c),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
            select: { id: true, organizationId: true, document: true, reason: true, createdByUserId: true, createdAt: true },
        });
        return filas.map((f) => ({
            clave: `exclusion:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'CONFIGURACION' as const,
            accion: 'MIRROR_OPT_OUT',
            titulo: 'Excluyó a un paciente de la sincronización con el hospital',
            detalle: [`Documento ${enmascarar(f.document)}`, f.reason ? `motivo: ${recortar(f.reason, 120)}` : null]
                .filter(Boolean)
                .join(' · '),
            aviso: false,
            organizationId: f.organizationId,
            actor: { userId: f.createdByUserId, email: null, role: null },
            ip: null,
            navegador: null,
            extra: null,
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 12. Citas anuladas por el personal desde el panel
// ─────────────────────────────────────────────────────────────

/**
 * La anulación desde la Visión General deja en la cita (`metaLog`) quién la anuló
 * y cuándo (`armarMetaLogCancelacionPersonal`). Va en SQL porque la hora vive
 * dentro del JSON; la conversión a fecha se protege con una expresión regular para
 * que un `metaLog` raro no tumbe la consulta.
 */
interface FilaAnulacion {
    id: string;
    organizationId: string;
    cuando: Date;
    userId: string | null;
    role: string | null;
    inicio: Date;
    servicio: string | null;
    medico: string | null;
}

export const fuenteAnulaciones: Fuente = {
    clave: 'anulacion',
    categorias: ['CITAS'],
    async buscar(db, c) {
        const clinica = clinicaObligatoria(c);
        if (!clinica) return [];
        const condiciones: Prisma.Sql[] = [Prisma.sql`x.cuando IS NOT NULL`];
        if (clinica.organizationId) condiciones.push(Prisma.sql`x."organizationId" = ${clinica.organizationId}`);
        if (c.usuario) condiciones.push(Prisma.sql`x."userId" = ${c.usuario.id}`);
        // Las fechas viajan como texto ISO (con «Z») y se convierten en la base: así no
        // dependen de la zona horaria de la sesión de Postgres.
        if (c.desdeUtc) condiciones.push(Prisma.sql`x.cuando >= ${c.desdeUtc.toISOString()}::timestamptz`);
        if (c.hastaUtc) condiciones.push(Prisma.sql`x.cuando < ${c.hastaUtc.toISOString()}::timestamptz`);
        if (c.cursor) condiciones.push(Prisma.sql`x.cuando <= ${new Date(c.cursor.at).toISOString()}::timestamptz`);

        const filas = await db.$queryRaw<FilaAnulacion[]>`
            SELECT x.id, x."organizationId", x.cuando, x."userId", x.role,
                   s."startTime" AS inicio, ms.name AS servicio, d."fullName" AS medico
            FROM (
                SELECT a.id, a."organizationId", a."scheduleSlotId",
                       a."metaLog"->>'cancelledByUserId' AS "userId",
                       a."metaLog"->>'cancelledByRole' AS role,
                       CASE WHEN (a."metaLog"->>'cancelledAt') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}'
                            THEN (a."metaLog"->>'cancelledAt')::timestamptz
                       END AS cuando
                FROM "Appointment" a
                WHERE a."metaLog"->>'cancelledBy' = 'STAFF'
            ) x
            JOIN "ScheduleSlot" s ON s.id = x."scheduleSlotId"
            LEFT JOIN "MedicalService" ms ON ms.id = s."serviceId"
            LEFT JOIN "DoctorProfile" d ON d.id = s."doctorId"
            WHERE ${Prisma.join(condiciones, ' AND ')}
            ORDER BY x.cuando DESC, x.id DESC
            LIMIT ${tope(c)}
        `;
        return filas.map((f) => ({
            clave: `anulacion:${f.id}`,
            at: new Date(f.cuando).toISOString(),
            categoria: 'CITAS' as const,
            accion: 'APPOINTMENT_CANCELLED_BY_STAFF',
            titulo: 'Anuló una cita desde el panel',
            detalle: [f.servicio, f.medico].filter(Boolean).join(' · ') || null,
            aviso: false,
            organizationId: f.organizationId,
            actor: { userId: f.userId, email: null, role: f.role },
            ip: null,
            navegador: null,
            extra: { cita: f.id, horaDeLaCita: new Date(f.inicio).toISOString() },
        }));
    },
};

// ─────────────────────────────────────────────────────────────
// 13. Bitácora legal de la plataforma (super administradores)
// ─────────────────────────────────────────────────────────────

const ACCION_GLOBAL: Record<string, string> = {
    ORGANIZATION_PURGED: 'Purgó la clínica (borrado definitivo)',
    ORGANIZATION_CREATED: 'Creó la clínica',
    ORGANIZATION_SUSPENDED: 'Suspendió la clínica',
    TECH_ALERTS_CONFIG_CHANGED: 'Cambió las alertas técnicas',
    SUPPORT_BOT_CONFIG_CHANGED: 'Cambió el asistente de soporte',
};

export const fuentePlataforma: Fuente = {
    clave: 'global',
    categorias: ['PLATAFORMA'],
    tienePlataforma: true,
    async buscar(db, c) {
        const where: Prisma.GlobalAuditLogWhereInput = { createdAt: rango(c) };
        if (c.clinica.tipo === 'PLATAFORMA') where.organizationId = null;
        if (c.clinica.tipo === 'CLINICA') where.organizationId = c.clinica.id;
        if (c.usuario) where.actorId = c.usuario.id;
        const filas = await db.globalAuditLog.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: tope(c),
        });
        return filas.map((f) => ({
            clave: `global:${f.id}`,
            at: f.createdAt.toISOString(),
            categoria: 'PLATAFORMA' as const,
            accion: f.action,
            titulo: ACCION_GLOBAL[f.action] ?? f.action,
            detalle: recortar(f.message, 300) || null,
            aviso: f.action === 'ORGANIZATION_PURGED',
            organizationId: f.organizationId,
            organizationName: f.organizationName,
            actor: { userId: f.actorId, email: f.actorEmail, role: 'SUPER_ADMIN' },
            ip: f.ipAddress,
            navegador: null,
            extra: obj(f.metadata),
        }));
    },
};

export const FUENTES: readonly Fuente[] = [
    fuenteBitacora,
    fuenteRastreo,
    fuenteBandeja,
    fuenteConfiguracion,
    fuentePadron,
    fuenteAvisos,
    fuenteSolicitudesCitas,
    fuenteCajaNegra,
    fuenteTickets,
    fuenteNotasDeTickets,
    fuenteExclusiones,
    fuenteAnulaciones,
    fuentePlataforma,
];

/** Las fuentes que hay que consultar para estos filtros. */
export function fuentesParaConsulta(c: Pick<ConsultaDeFuente, 'categoria' | 'clinica'>): Fuente[] {
    return FUENTES.filter(
        (f) =>
            (!c.categoria || f.categorias.includes(c.categoria)) &&
            (c.clinica.tipo !== 'PLATAFORMA' || f.tienePlataforma),
    );
}
