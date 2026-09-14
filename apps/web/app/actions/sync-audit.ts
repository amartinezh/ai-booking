'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@agenia/database';
import { tenantAdmin } from './espejo';

/**
 * Auditoría DETALLADA del espejo con el HIS del hospital.
 *
 * `/dashboard/espejo` (espejo.ts) ya da el resumen operativo — semáforos,
 * cola pendiente, dead-letters, conflictos recientes. Esto es su drill-down:
 * el historial completo, filtrable y paginado.
 *
 * Por qué DOS fuentes y no una:
 * - `SyncAudit` es el append-only de INBOUND (HIS→AgenIA), RECONCILE,
 *   disponibilidad y cambios de configuración — pero las entregas
 *   EXITOSAS de AgenIA→HIS nunca escriben aquí (solo lo hacen cuando el
 *   driver declina el evento). Auditarlo solo daría una foto incompleta del
 *   sentido AgenIA→HIS.
 * - `SyncOutbox` es la cola real AgenIA→HIS: una fila por evento, con el
 *   payload que se envió, cuántas veces se intentó y si se entregó. Es la
 *   única fuente completa de ese sentido.
 * Por eso el panel tiene dos pestañas en vez de fingir una sola tabla.
 *
 * Todo va contra el tenant de la sesión — mismo aislamiento que espejo.ts.
 */

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

function paginar(page?: number, pageSize?: number) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(PAGE_SIZE_MAX, Math.max(5, pageSize ?? PAGE_SIZE_DEFAULT));
  return { page: p, pageSize: ps, skip: (p - 1) * ps };
}

/**
 * Límites de un día calendario en America/Bogota, a partir de "YYYY-MM-DD".
 *
 * Bogotá no tiene horario de verano — el offset -05:00 es fijo todo el año,
 * así que construirlo a mano es correcto y evita depender de la TZ del
 * proceso (el contenedor corre en UTC). Si en el futuro un hospital fuera de
 * Colombia necesita esto, el offset deja de ser una constante y hay que
 * resolverlo desde `Organization.timezone` (igual que @agenia/shared).
 */
function inicioDiaBogota(fecha: string): Date | null {
  const d = new Date(`${fecha}T00:00:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function finDiaBogota(fecha: string): Date | null {
  const d = new Date(`${fecha}T23:59:59.999-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────
// SyncAudit
// ─────────────────────────────────────────────────────────────

export interface SyncAuditRow {
  id: string;
  direction: string;
  entityType: string;
  entityId: string | null;
  op: string;
  outcome: string;
  detail: string | null;
  eventId: string | null;
  createdAt: string;
}

export interface ListSyncAuditParams {
  direction?: string;
  entityType?: string;
  outcome?: string;
  op?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function serializeAudit(row: {
  id: string;
  direction: string;
  entityType: string;
  entityId: string | null;
  op: string;
  outcome: string;
  detail: string | null;
  eventId: string | null;
  createdAt: Date;
}): SyncAuditRow {
  return {
    id: row.id,
    direction: row.direction,
    entityType: row.entityType,
    entityId: row.entityId,
    op: row.op,
    outcome: row.outcome,
    detail: row.detail,
    eventId: row.eventId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSyncAudit(
  params: ListSyncAuditParams,
): Promise<{ success: true; data: ListResult<SyncAuditRow> } | { success: false; error: string }> {
  const organizationId = await tenantAdmin();
  if (!organizationId) return { success: false, error: 'Sin permisos.' };

  const { page, pageSize, skip } = paginar(params.page, params.pageSize);

  const where: Prisma.SyncAuditWhereInput = { organizationId };
  if (params.direction) where.direction = params.direction;
  if (params.entityType) where.entityType = params.entityType;
  if (params.outcome) where.outcome = params.outcome;
  if (params.op) where.op = params.op;

  const q = params.search?.trim();
  if (q) {
    where.OR = [
      { entityId: { contains: q, mode: 'insensitive' } },
      { eventId: { contains: q, mode: 'insensitive' } },
      { detail: { contains: q, mode: 'insensitive' } },
    ];
  }

  const desde = params.from ? inicioDiaBogota(params.from) : null;
  const hasta = params.to ? finDiaBogota(params.to) : null;
  if (desde || hasta) {
    where.createdAt = {
      ...(desde ? { gte: desde } : {}),
      ...(hasta ? { lte: hasta } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.syncAudit.count({ where }),
    prisma.syncAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    success: true,
    data: {
      rows: rows.map(serializeAudit),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export interface SyncAuditFacets {
  directions: string[];
  entityTypes: string[];
  outcomes: string[];
  ops: string[];
}

/**
 * Valores distintos ya vistos para esta organización — no una lista fija.
 * El vocabulario de `direction`/`op` ha crecido con cada driver/servicio
 * nuevo (HIS_TO_AGENIA, RECONCILE, CONFIG...) y una lista fija en el
 * frontend se habría quedado corta ya con el primer driver.
 */
export async function getSyncAuditFacets(): Promise<
  { success: true; data: SyncAuditFacets } | { success: false; error: string }
> {
  const organizationId = await tenantAdmin();
  if (!organizationId) return { success: false, error: 'Sin permisos.' };

  const [directions, entityTypes, outcomes, ops] = await Promise.all([
    prisma.syncAudit.findMany({
      where: { organizationId },
      distinct: ['direction'],
      select: { direction: true },
      orderBy: { direction: 'asc' },
    }),
    prisma.syncAudit.findMany({
      where: { organizationId },
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
    }),
    prisma.syncAudit.findMany({
      where: { organizationId },
      distinct: ['outcome'],
      select: { outcome: true },
      orderBy: { outcome: 'asc' },
    }),
    prisma.syncAudit.findMany({
      where: { organizationId },
      distinct: ['op'],
      select: { op: true },
      orderBy: { op: 'asc' },
    }),
  ]);

  return {
    success: true,
    data: {
      directions: directions.map((d) => d.direction),
      entityTypes: entityTypes.map((e) => e.entityType),
      outcomes: outcomes.map((o) => o.outcome),
      ops: ops.map((o) => o.op),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// SyncOutbox
// ─────────────────────────────────────────────────────────────

export type OutboxEstado = 'PENDIENTE' | 'ENTREGADO' | 'DEAD_LETTER';

export interface SyncOutboxRow {
  seq: string;
  eventId: string;
  entityType: string;
  entityId: string;
  op: string;
  payload: Prisma.JsonValue;
  origin: string;
  createdAt: string;
  deliveredAt: string | null;
  attempts: number;
  deadLettered: boolean;
  nextAttemptAt: string | null;
  estado: OutboxEstado;
}

export interface ListSyncOutboxParams {
  entityType?: string;
  op?: string;
  estado?: OutboxEstado;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

function estadoDe(row: { deliveredAt: Date | null; deadLettered: boolean }): OutboxEstado {
  if (row.deadLettered) return 'DEAD_LETTER';
  if (row.deliveredAt) return 'ENTREGADO';
  return 'PENDIENTE';
}

function serializeOutbox(row: {
  seq: bigint;
  eventId: string;
  entityType: string;
  entityId: string;
  op: string;
  payload: Prisma.JsonValue;
  origin: string;
  createdAt: Date;
  deliveredAt: Date | null;
  attempts: number;
  deadLettered: boolean;
  nextAttemptAt: Date | null;
}): SyncOutboxRow {
  return {
    seq: row.seq.toString(),
    eventId: row.eventId,
    entityType: row.entityType,
    entityId: row.entityId,
    op: row.op,
    payload: row.payload,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    attempts: row.attempts,
    deadLettered: row.deadLettered,
    nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
    estado: estadoDe(row),
  };
}

export async function listSyncOutbox(
  params: ListSyncOutboxParams,
): Promise<{ success: true; data: ListResult<SyncOutboxRow> } | { success: false; error: string }> {
  const organizationId = await tenantAdmin();
  if (!organizationId) return { success: false, error: 'Sin permisos.' };

  const { page, pageSize, skip } = paginar(params.page, params.pageSize);

  const where: Prisma.SyncOutboxWhereInput = { organizationId };
  if (params.entityType) where.entityType = params.entityType;
  if (params.op) where.op = params.op;

  switch (params.estado) {
    case 'PENDIENTE':
      where.deliveredAt = null;
      where.deadLettered = false;
      break;
    case 'ENTREGADO':
      where.deliveredAt = { not: null };
      break;
    case 'DEAD_LETTER':
      where.deadLettered = true;
      break;
    default:
      break;
  }

  const q = params.search?.trim();
  if (q) {
    where.OR = [
      { entityId: { contains: q, mode: 'insensitive' } },
      { eventId: { contains: q, mode: 'insensitive' } },
    ];
  }

  const desde = params.from ? inicioDiaBogota(params.from) : null;
  const hasta = params.to ? finDiaBogota(params.to) : null;
  if (desde || hasta) {
    where.createdAt = {
      ...(desde ? { gte: desde } : {}),
      ...(hasta ? { lte: hasta } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.syncOutbox.count({ where }),
    prisma.syncOutbox.findMany({
      where,
      orderBy: { seq: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    success: true,
    data: {
      rows: rows.map(serializeOutbox),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export interface SyncOutboxFacets {
  entityTypes: string[];
  ops: string[];
}

export async function getSyncOutboxFacets(): Promise<
  { success: true; data: SyncOutboxFacets } | { success: false; error: string }
> {
  const organizationId = await tenantAdmin();
  if (!organizationId) return { success: false, error: 'Sin permisos.' };

  const [entityTypes, ops] = await Promise.all([
    prisma.syncOutbox.findMany({
      where: { organizationId },
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
    }),
    prisma.syncOutbox.findMany({
      where: { organizationId },
      distinct: ['op'],
      select: { op: true },
      orderBy: { op: 'asc' },
    }),
  ]);

  return {
    success: true,
    data: {
      entityTypes: entityTypes.map((e) => e.entityType),
      ops: ops.map((o) => o.op),
    },
  };
}
