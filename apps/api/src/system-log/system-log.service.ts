import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Espejo del enum LogLevel del schema Prisma. Usamos string literals para
// no acoplar el resto del código a tipos generados.
export type SystemLogLevel = 'EVENT' | 'WARNING' | 'ERROR';

export interface LogInput {
  action: string;
  message: string;
  metadata?: Record<string, any> | null;
  userId?: string | null;
  organizationId?: string | null;
}

export interface ListLogsParams {
  level?: SystemLogLevel | 'ALL';
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 🩻 SystemLogService
 *
 * Servicio central de auditoría / observabilidad. Cualquier módulo
 * (auth, doctores, citas, etc.) lo inyecta para registrar EVENTs y
 * WARNINGs. El GlobalExceptionFilter lo usa también para los ERRORs.
 *
 * Es fire-and-forget: nunca propaga errores al caller. Si la escritura
 * falla, lo logueamos por consola pero no rompemos el flujo principal.
 */
@Injectable()
export class SystemLogService {
  private readonly logger = new Logger(SystemLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Atajos de uso común ─────────────────────────────────────
  async event(input: LogInput): Promise<void> {
    return this.write('EVENT', input);
  }

  async warning(input: LogInput): Promise<void> {
    return this.write('WARNING', input);
  }

  async error(input: LogInput): Promise<void> {
    return this.write('ERROR', input);
  }

  // ── Escritura cruda con nivel arbitrario ────────────────────
  private async write(level: SystemLogLevel, input: LogInput): Promise<void> {
    try {
      await this.prisma.systemLog.create({
        data: {
          level,
          action: this.truncate(input.action, 120),
          message: this.truncate(input.message, 8000),
          metadata: (input.metadata as any) ?? null,
          userId: input.userId ?? null,
          organizationId: input.organizationId ?? null,
        },
      });
    } catch (e: any) {
      // Nunca propagar: solo loguear por consola para no entrar en bucles.
      this.logger.error(
        `❌ No se pudo persistir SystemLog (${level} / ${input.action}): ${e?.message || e}`,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CONSULTAS (super-admin dashboard)
  // ══════════════════════════════════════════════════════════════

  /**
   * Listado paginado con búsqueda y filtro por nivel.
   * Toda búsqueda es case-insensitive y matchea `action` o `message`.
   */
  async list(params: ListLogsParams): Promise<{
    rows: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (params.level && params.level !== 'ALL') {
      where.level = params.level;
    }

    if (params.search && params.search.trim().length > 0) {
      const q = params.search.trim();
      where.OR = [
        { action: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.systemLog.count({ where }),
      this.prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Resumen de los últimos N errores en las últimas 24 horas.
   * Alimenta la "alerta roja" del dashboard de super-admin.
   */
  async recentErrors(limit = 5): Promise<any[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.systemLog.findMany({
      where: {
        level: 'ERROR',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(20, limit)),
    });
  }

  async getById(id: string): Promise<any | null> {
    return this.prisma.systemLog.findUnique({ where: { id } });
  }

  // ── helpers internos ────────────────────────────────────────
  private truncate(s: string, max: number): string {
    if (!s) return s;
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
  }
}
