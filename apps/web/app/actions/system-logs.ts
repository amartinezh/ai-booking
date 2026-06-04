'use server';

import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { LogLevel } from '@agenia/database';

export type SystemLogLevel = 'EVENT' | 'WARNING' | 'ERROR';

export interface SystemLogRow {
    id: string;
    level: SystemLogLevel;
    action: string;
    message: string;
    userId: string | null;
    organizationId: string | null;
    metadata: any;
    createdAt: string; // ISO string para serializar al cliente
}

export interface ListLogsParams {
    level?: SystemLogLevel | 'ALL';
    search?: string;
    page?: number;
    pageSize?: number;
}

export interface ListLogsResult {
    rows: SystemLogRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// ─────────────────────────────────────────────────────────────
// Guardia compartida: solo SUPER_ADMIN puede acceder a la auditoría.
// ─────────────────────────────────────────────────────────────
async function ensureSuperAdmin() {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') {
        throw new Error('Acceso denegado');
    }
    return session;
}

// Mapeo: row Prisma → DTO serializable al cliente (Date → ISO string).
function serialize(row: any): SystemLogRow {
    return {
        id: row.id,
        level: row.level as SystemLogLevel,
        action: row.action,
        message: row.message,
        userId: row.userId,
        organizationId: row.organizationId,
        metadata: row.metadata ?? null,
        createdAt: row.createdAt.toISOString(),
    };
}

/**
 * Listado paginado con búsqueda y filtro por nivel.
 */
export async function listSystemLogs(params: ListLogsParams): Promise<ListLogsResult> {
    await ensureSuperAdmin();

    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (params.level && params.level !== 'ALL') {
        where.level = params.level as LogLevel;
    }

    if (params.search && params.search.trim().length > 0) {
        const q = params.search.trim();
        where.OR = [
            { action: { contains: q, mode: 'insensitive' } },
            { message: { contains: q, mode: 'insensitive' } },
        ];
    }

    const [total, rows] = await prisma.$transaction([
        prisma.systemLog.count({ where }),
        prisma.systemLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
        }),
    ]);

    return {
        rows: rows.map(serialize),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
}

/**
 * Errores de las últimas 24 horas (alimenta la alerta roja del dashboard).
 */
export async function getRecentErrors(limit = 5): Promise<SystemLogRow[]> {
    await ensureSuperAdmin();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.systemLog.findMany({
        where: {
            level: 'ERROR',
            createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(1, Math.min(20, limit)),
    });
    return rows.map(serialize);
}

/**
 * Detalle de un log para el modal/drawer (incluye metadata completa).
 */
export async function getSystemLogById(id: string): Promise<SystemLogRow | null> {
    await ensureSuperAdmin();
    const row = await prisma.systemLog.findUnique({ where: { id } });
    return row ? serialize(row) : null;
}
