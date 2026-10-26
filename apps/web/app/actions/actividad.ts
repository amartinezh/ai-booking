'use server';

/**
 * 👣 ACTIVIDAD DE USUARIOS (2026-10-26) — solo SUPER_ADMIN.
 *
 * La línea de tiempo de lo que hace el personal de cada clínica (ingresos,
 * intentos fallidos, cuentas, rastreo, Bandeja, padrón, configuración…) y el
 * resumen de ingresos por usuario y por clínica. Solo lectura: lee las tablas
 * donde cada módulo dejó su rastro (`lib/actividad/fuentes.ts`).
 */
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { fuentesParaConsulta, type ConsultaDeFuente } from '@/lib/actividad/fuentes';
import { leerFiltros, type FiltrosActividad, type FiltrosEnTexto } from '@/lib/actividad/filtros';
import {
    codificarCursor,
    decodificarCursor,
    mezclarPagina,
    type EventoDeActividad,
} from '@/lib/actividad/linea-de-tiempo';

/** Cuántos eventos trae cada página de la línea de tiempo. */
const POR_PAGINA = 60;
/** Ventana de los resúmenes de ingresos. */
const DIAS_RESUMEN = 30;

const ROLES_DEL_PERSONAL = ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'] as const;

async function esSuperAdmin(): Promise<boolean> {
    const s = await getSession();
    return s?.role === 'SUPER_ADMIN';
}

// ─────────────────────────────────────────────────────────────
// Línea de tiempo
// ─────────────────────────────────────────────────────────────

export interface PaginaDeActividad {
    success: boolean;
    error?: string;
    eventos: EventoDeActividad[];
    /** Cursor para «Cargar más»; null si no hay más. */
    siguiente: string | null;
    /** Las fuentes que fallaron (la página sale con lo demás). */
    fuentesConError: string[];
}

export async function cargarActividad(
    filtrosTexto: FiltrosEnTexto,
    cursorTexto?: string | null,
): Promise<PaginaDeActividad> {
    if (!(await esSuperAdmin())) {
        return { success: false, error: 'Acceso denegado', eventos: [], siguiente: null, fuentesConError: [] };
    }
    try {
        return { success: true, ...(await paginaDeActividad(leerFiltros(filtrosTexto), cursorTexto ?? null)) };
    } catch (e) {
        return {
            success: false,
            error: getErrorMessage(e) || 'No se pudo cargar la actividad.',
            eventos: [],
            siguiente: null,
            fuentesConError: [],
        };
    }
}

async function paginaDeActividad(
    f: FiltrosActividad,
    cursorTexto: string | null,
): Promise<Omit<PaginaDeActividad, 'success' | 'error'>> {
    const usuario = f.usuarioId
        ? await prisma.user
              .findUnique({ where: { id: f.usuarioId }, select: { id: true, email: true } })
              .then((u) => u ?? { id: f.usuarioId as string, email: '' })
        : null;

    const consulta: ConsultaDeFuente = {
        clinica: f.clinica,
        usuario,
        categoria: f.categoria,
        desdeUtc: f.desdeUtc,
        hastaUtc: f.hastaUtc,
        cursor: decodificarCursor(cursorTexto),
        limite: POR_PAGINA,
    };

    const fuentes = fuentesParaConsulta(consulta);
    const fuentesConError: string[] = [];
    const listas = await Promise.all(
        fuentes.map((fuente) =>
            fuente.buscar(prisma, consulta).catch((e: unknown) => {
                console.error(`[actividad] la fuente ${fuente.clave} falló:`, getErrorMessage(e));
                fuentesConError.push(fuente.clave);
                return [] as EventoDeActividad[];
            }),
        ),
    );

    const { eventos, siguiente } = mezclarPagina(listas, POR_PAGINA, consulta.cursor);
    return {
        eventos: await completarNombres(eventos),
        siguiente: siguiente ? codificarCursor(siguiente) : null,
        fuentesConError,
    };
}

/** Pone el correo y el rol de cada actor y el nombre de cada clínica. */
async function completarNombres(eventos: EventoDeActividad[]): Promise<EventoDeActividad[]> {
    const ids = [...new Set(eventos.map((e) => e.actor.userId).filter((x): x is string => !!x))];
    const orgIds = [...new Set(eventos.map((e) => e.organizationId).filter((x): x is string => !!x))];
    const [usuarios, clinicas] = await Promise.all([
        ids.length
            ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, role: true } })
            : [],
        orgIds.length
            ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
            : [],
    ]);
    const porId = new Map(usuarios.map((u) => [u.id, u]));
    const nombreClinica = new Map(clinicas.map((o) => [o.id, o.name]));
    return eventos.map((e) => {
        const u = e.actor.userId ? porId.get(e.actor.userId) : undefined;
        return {
            ...e,
            organizationName: e.organizationName ?? (e.organizationId ? nombreClinica.get(e.organizationId) ?? null : null),
            actor: {
                userId: e.actor.userId,
                email: e.actor.email ?? u?.email ?? null,
                role: e.actor.role ?? u?.role ?? null,
            },
        };
    });
}

// ─────────────────────────────────────────────────────────────
// Resúmenes de ingresos
// ─────────────────────────────────────────────────────────────

export interface UsuarioConIngresos {
    id: string;
    email: string;
    role: string;
    creado: string;
    ultimoIngreso: string | null;
    ingresos30: number;
    fallidos30: number;
}

export interface ClinicaConIngresos {
    id: string;
    nombre: string;
    activa: boolean;
    usuarios: number;
    usuariosQueIngresaron30: number;
    ingresos30: number;
    fallidos30: number;
    ultimoIngreso: string | null;
}

export interface ResumenDeIngresos {
    /** Desde cuándo hay registro de ingresos (el primero guardado). */
    registroDesde: string | null;
    ingresos30: number;
    fallidos30: number;
    usuariosQueIngresaron30: number;
    /** Usuarios de la clínica (o super administradores en «Plataforma»); vacío en «Todas». */
    usuarios: UsuarioConIngresos[];
    /** Una fila por clínica, solo en «Todas». */
    clinicas: ClinicaConIngresos[];
}

const FALLIDOS = ['LOGIN_FAILED', 'LOGIN_BLOCKED'];

export async function resumenDeIngresos(filtrosTexto: FiltrosEnTexto): Promise<ResumenDeIngresos | null> {
    if (!(await esSuperAdmin())) return null;
    const f = leerFiltros(filtrosTexto);
    const desde = new Date(Date.now() - DIAS_RESUMEN * 86_400_000);
    const deLaClinica =
        f.clinica.tipo === 'CLINICA'
            ? { organizationId: f.clinica.id }
            : f.clinica.tipo === 'PLATAFORMA'
              ? { organizationId: null }
              : {};

    const [primero, ingresos30, fallidos30, quienes] = await Promise.all([
        prisma.systemLog.findFirst({
            where: { action: 'USER_LOGIN' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
        }),
        prisma.systemLog.count({ where: { ...deLaClinica, action: 'USER_LOGIN', createdAt: { gte: desde } } }),
        prisma.systemLog.count({ where: { ...deLaClinica, action: { in: FALLIDOS }, createdAt: { gte: desde } } }),
        prisma.systemLog.groupBy({
            by: ['userId'],
            where: { ...deLaClinica, action: 'USER_LOGIN', createdAt: { gte: desde }, userId: { not: null } },
        }),
    ]);

    const base = {
        registroDesde: primero?.createdAt.toISOString() ?? null,
        ingresos30,
        fallidos30,
        usuariosQueIngresaron30: quienes.length,
    };

    if (f.clinica.tipo === 'TODAS') {
        return { ...base, usuarios: [], clinicas: await clinicasConIngresos(desde) };
    }

    const usuarios = await prisma.user.findMany({
        where:
            f.clinica.tipo === 'CLINICA'
                ? { organizationId: f.clinica.id, role: { in: [...ROLES_DEL_PERSONAL] } }
                : { role: 'SUPER_ADMIN' },
        select: { id: true, email: true, role: true, createdAt: true },
        orderBy: [{ role: 'asc' }, { email: 'asc' }],
        take: 500,
    });
    return { ...base, usuarios: await conIngresos(usuarios, desde), clinicas: [] };
}

async function conIngresos(
    usuarios: { id: string; email: string; role: string; createdAt: Date }[],
    desde: Date,
): Promise<UsuarioConIngresos[]> {
    if (usuarios.length === 0) return [];
    const ids = usuarios.map((u) => u.id);
    const [ultimos, recientes] = await Promise.all([
        prisma.systemLog.groupBy({
            by: ['userId'],
            where: { userId: { in: ids }, action: 'USER_LOGIN' },
            _max: { createdAt: true },
        }),
        prisma.systemLog.groupBy({
            by: ['userId', 'action'],
            where: { userId: { in: ids }, action: { in: ['USER_LOGIN', ...FALLIDOS] }, createdAt: { gte: desde } },
            _count: { _all: true },
        }),
    ]);
    const ultimo = new Map(ultimos.map((u) => [u.userId, u._max.createdAt]));
    const cuenta = (id: string, acciones: string[]) =>
        recientes
            .filter((r) => r.userId === id && acciones.includes(r.action))
            .reduce((s, r) => s + r._count._all, 0);
    return usuarios.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        creado: u.createdAt.toISOString(),
        ultimoIngreso: ultimo.get(u.id)?.toISOString() ?? null,
        ingresos30: cuenta(u.id, ['USER_LOGIN']),
        fallidos30: cuenta(u.id, FALLIDOS),
    }));
}

async function clinicasConIngresos(desde: Date): Promise<ClinicaConIngresos[]> {
    const [clinicas, usuarios, porAccion, quienes, ultimos] = await Promise.all([
        prisma.organization.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.user.groupBy({
            by: ['organizationId'],
            where: { role: { in: [...ROLES_DEL_PERSONAL] }, organizationId: { not: null } },
            _count: { _all: true },
        }),
        prisma.systemLog.groupBy({
            by: ['organizationId', 'action'],
            where: {
                organizationId: { not: null },
                action: { in: ['USER_LOGIN', ...FALLIDOS] },
                createdAt: { gte: desde },
            },
            _count: { _all: true },
        }),
        prisma.systemLog.groupBy({
            by: ['organizationId', 'userId'],
            where: { organizationId: { not: null }, action: 'USER_LOGIN', createdAt: { gte: desde }, userId: { not: null } },
        }),
        prisma.systemLog.groupBy({
            by: ['organizationId'],
            where: { organizationId: { not: null }, action: 'USER_LOGIN' },
            _max: { createdAt: true },
        }),
    ]);
    const cuenta = (org: string, acciones: string[]) =>
        porAccion
            .filter((r) => r.organizationId === org && acciones.includes(r.action))
            .reduce((s, r) => s + r._count._all, 0);
    return clinicas.map((o) => ({
        id: o.id,
        nombre: o.name,
        activa: o.isActive,
        usuarios: usuarios.find((u) => u.organizationId === o.id)?._count._all ?? 0,
        usuariosQueIngresaron30: quienes.filter((q) => q.organizationId === o.id).length,
        ingresos30: cuenta(o.id, ['USER_LOGIN']),
        fallidos30: cuenta(o.id, FALLIDOS),
        ultimoIngreso: ultimos.find((u) => u.organizationId === o.id)?._max.createdAt?.toISOString() ?? null,
    }));
}
