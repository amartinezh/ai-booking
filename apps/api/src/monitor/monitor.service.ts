import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ServiceIncident } from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorCheckers } from './monitor.checkers';
import { ACTIVE_SERVICES, SERVICES_CONFIG } from './services.config';

export interface IncidentFilters {
  from?: Date;
  to?: Date;
  /** Una o varias serviceKey. */
  services?: string[];
  /** 'all' | 'open' | 'resolved'. */
  status?: 'all' | 'open' | 'resolved';
  /** Texto libre: match en errorMessage / errorCode / serviceKey. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface IncidentListResult {
  rows: ServiceIncident[];
  total: number;
}

export interface IncidentSummary {
  periodDays: number;
  total: number;
  open: number;
  resolved: number;
  /** Duración media de incidentes resueltos, en ms. null si no hay resueltos. */
  avgDurationMs: number | null;
}

export interface MonitorMeta {
  bgEnabled: boolean;
  bgIntervalMinutes: number;
  liveIntervalSeconds: number;
  /** Catálogo de servicios para los chips/filtros del frontend. */
  services: { key: string; displayName: string; group: string }[];
}

/**
 * Lógica de consulta sobre `ServiceIncident` (histórico del MODO A) y ejecución
 * del check en vivo (MODO B). El check en vivo NO escribe en BD.
 */
@Injectable()
export class MonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly checkers: MonitorCheckers,
  ) {}

  // ── MODO B: check en vivo (efímero) ──────────────────────────────────────────

  async runLiveCheck() {
    const results = await Promise.allSettled(
      ACTIVE_SERVICES.map((svc) => this.checkers.checkService(svc)),
    );
    return {
      timestamp: new Date().toISOString(),
      services: results.map((r, i) => {
        const svc = ACTIVE_SERVICES[i];
        const result =
          r.status === 'fulfilled'
            ? r.value
            : {
                status: 'DOWN' as const,
                latencyMs: null,
                errorCode: 'UNHANDLED',
                errorMessage: 'Internal error',
              };
        return {
          key: svc.key,
          displayName: svc.displayName,
          group: svc.group,
          ...result,
        };
      }),
    };
  }

  // ── MODO A: histórico de incidentes ──────────────────────────────────────────

  async listIncidents(filters: IncidentFilters): Promise<IncidentListResult> {
    const where = this.buildWhere(filters);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);

    const [rows, total] = await Promise.all([
      this.prisma.serviceIncident.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.serviceIncident.count({ where }),
    ]);
    return { rows, total };
  }

  async getIncident(id: string): Promise<ServiceIncident | null> {
    return this.prisma.serviceIncident.findUnique({ where: { id } });
  }

  async summary(periodDays: number): Promise<IncidentSummary> {
    const from = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.serviceIncident.findMany({
      where: { startedAt: { gte: from } },
      select: { startedAt: true, resolvedAt: true },
    });

    const resolved = rows.filter((r) => r.resolvedAt);
    const durations = resolved.map(
      (r) => r.resolvedAt!.getTime() - r.startedAt.getTime(),
    );
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    return {
      periodDays,
      total: rows.length,
      open: rows.length - resolved.length,
      resolved: resolved.length,
      avgDurationMs,
    };
  }

  /** Limpieza manual: borra incidentes resueltos anteriores a `before`. */
  async deleteBefore(before: Date): Promise<number> {
    const result = await this.prisma.serviceIncident.deleteMany({
      where: { resolvedAt: { not: null, lt: before } },
    });
    return result.count;
  }

  // ── Metadata para el frontend ────────────────────────────────────────────────

  meta(): MonitorMeta {
    return {
      bgEnabled: this.config.get<string>('MONITOR_ENABLED', 'true') === 'true',
      bgIntervalMinutes: Number(
        this.config.get('MONITOR_BG_INTERVAL_MINUTES') ?? 15,
      ),
      liveIntervalSeconds: Number(
        this.config.get('MONITOR_LIVE_INTERVAL_SECONDS') ?? 5,
      ),
      services: SERVICES_CONFIG.map((s) => ({
        key: s.key,
        displayName: s.displayName,
        group: s.group,
      })),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private buildWhere(
    filters: IncidentFilters,
  ): Prisma.ServiceIncidentWhereInput {
    const where: Prisma.ServiceIncidentWhereInput = {};

    if (filters.from || filters.to) {
      where.startedAt = {};
      if (filters.from) where.startedAt.gte = filters.from;
      if (filters.to) where.startedAt.lte = filters.to;
    }

    if (filters.services?.length) {
      where.serviceKey = { in: filters.services };
    }

    if (filters.status === 'open') where.resolvedAt = null;
    else if (filters.status === 'resolved') where.resolvedAt = { not: null };

    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { errorMessage: { contains: q, mode: 'insensitive' } },
        { errorCode: { contains: q, mode: 'insensitive' } },
        { serviceKey: { contains: q, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
