import { Injectable } from '@nestjs/common';
import { Prisma } from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';

// ══════════════════════════════════════════════════════════════
// 🌎 GLOBAL STATS — Dashboard exclusivo Super Admin
//
// Reglas duras (impuestas por el producto):
//   - NUNCA traer registros crudos: solo agregaciones (_count, groupBy).
//   - Soporta filtro por clínica única (organizationId) o "Global".
//   - Soporta filtros de rango por gte/lte sobre el campo correcto:
//       · SystemLog / Patient / ClinicalRecord / Addendum → createdAt
//       · Appointment                                     → scheduleSlot.startTime
//
// Convención de acciones SystemLog (ya definida en el proyecto):
//   - 'USER_LOGIN'           → login exitoso (metadata.role = Role)
//   - 'WHATSAPP_ESCALATION'  → conversación elevada a humano
//   - 'AI_MESSAGE_PROCESSED' → cada respuesta generada por el LLM
// ══════════════════════════════════════════════════════════════

export type TimeRange = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export interface StatsFilters {
  organizationId?: string | null; // null/undefined = global (todas las clínicas)
  range?: TimeRange;
  startDate?: string; // ISO date (yyyy-mm-dd) — solo cuando range = CUSTOM
  endDate?: string;   // ISO date (yyyy-mm-dd)
}

interface ResolvedRange {
  gte: Date;
  lte: Date;
}

export interface TrendPoint {
  date: string; // yyyy-mm-dd
  count: number;
}

@Injectable()
export class GlobalStatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────
  // PUBLIC API
  // ────────────────────────────────────────────────────────────

  async getGlobalStats(filters: StatsFilters) {
    const range = this.resolveRange(filters);
    const orgId = filters.organizationId?.trim() || null;

    // Lanzamos todas las agregaciones en paralelo. Cada una pega solo a
    // un índice y devuelve un escalar. El payload final es muy pequeño.
    const [
      loginsClinicAdmin,
      loginsDoctor,
      loginsScheduler,
      appointmentsScheduled,
      appointmentsFailed,
      whatsappEscalations,
      newPatients,
      signedClinicalRecords,
      legalAddendums,
      aiMessagesProcessed,
      activeOrganizations,
      // Trends (un solo bucket por día — barato porque agrupa en SQL).
      appointmentsTrend,
      patientsTrend,
      aiMessagesTrend,
      signedRecordsTrend,
    ] = await Promise.all([
      this.countLoginsByRole('ORG_ADMIN', range, orgId),
      this.countLoginsByRole('DOCTOR', range, orgId),
      this.countLoginsByRole('BOOKING_AGENT', range, orgId),
      this.countAppointmentsByStatus('SCHEDULED', range, orgId),
      this.countAppointmentsFailed(range, orgId),
      this.countSystemLogAction('WHATSAPP_ESCALATION', range, orgId),
      this.countNewPatients(range, orgId),
      this.countSignedClinicalRecords(range, orgId),
      this.countLegalAddendums(range, orgId),
      this.countSystemLogAction('AI_MESSAGE_PROCESSED', range, orgId),
      this.countActiveOrganizations(range, orgId),
      // Tendencias por día.
      this.trendAppointmentsScheduled(range, orgId),
      this.trendNewPatients(range, orgId),
      this.trendSystemLogAction('AI_MESSAGE_PROCESSED', range, orgId),
      this.trendSignedClinicalRecords(range, orgId),
    ]);

    return {
      filters: {
        organizationId: orgId,
        range: filters.range ?? 'MONTH',
        startDate: range.gte.toISOString(),
        endDate: range.lte.toISOString(),
      },
      metrics: {
        // Logueos (puntos 1, 2, 3) — agregaciones en SystemLog action='USER_LOGIN'.
        loginsClinicAdmin,
        loginsDoctor,
        loginsScheduler,
        // Citas (puntos 4, 5).
        appointmentsScheduled,
        appointmentsFailed,
        // Bot / IA (punto 6).
        whatsappEscalations,
        // HealthTech relevantes (puntos 7–11).
        newPatients,
        signedClinicalRecords,
        legalAddendums,
        aiMessagesProcessed,
        activeOrganizations,
      },
      trends: {
        appointmentsScheduled: appointmentsTrend,
        newPatients: patientsTrend,
        aiMessagesProcessed: aiMessagesTrend,
        signedClinicalRecords: signedRecordsTrend,
      },
    };
  }

  // Lista compacta de clínicas para alimentar el dropdown del filtro.
  async listOrganizationsForFilter() {
    return this.prisma.organization.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ────────────────────────────────────────────────────────────
  // RESOLUCIÓN DE RANGO TEMPORAL
  // ────────────────────────────────────────────────────────────

  private resolveRange(filters: StatsFilters): ResolvedRange {
    const now = new Date();

    if (filters.range === 'CUSTOM' && filters.startDate && filters.endDate) {
      return {
        gte: new Date(`${filters.startDate}T00:00:00.000Z`),
        lte: new Date(`${filters.endDate}T23:59:59.999Z`),
      };
    }

    switch (filters.range) {
      case 'TODAY': {
        const start = new Date(now);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setUTCHours(23, 59, 59, 999);
        return { gte: start, lte: end };
      }
      case 'WEEK': {
        // Lunes a domingo de la semana actual (UTC).
        const start = new Date(now);
        const day = start.getUTCDay(); // 0 dom .. 6 sab
        const offset = day === 0 ? 6 : day - 1;
        start.setUTCDate(start.getUTCDate() - offset);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        end.setUTCHours(23, 59, 59, 999);
        return { gte: start, lte: end };
      }
      case 'YEAR': {
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
        const end = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
        return { gte: start, lte: end };
      }
      case 'MONTH':
      default: {
        const start = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
        );
        const end = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
        );
        return { gte: start, lte: end };
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // WHERE BUILDERS (cada modelo tiene su columna temporal distinta)
  // ────────────────────────────────────────────────────────────

  // Para tablas con createdAt directo (SystemLog, Patient, ClinicalRecord, Addendum).
  private whereCreatedAt(range: ResolvedRange, orgId: string | null) {
    const where: Prisma.SystemLogWhereInput &
      Prisma.PatientProfileWhereInput &
      Prisma.ClinicalRecordWhereInput &
      Prisma.AddendumWhereInput = {
      createdAt: { gte: range.gte, lte: range.lte },
    };
    if (orgId) (where as any).organizationId = orgId;
    return where;
  }

  // Para Appointment: la fecha clínica vive en scheduleSlot.startTime.
  private whereAppointment(range: ResolvedRange, orgId: string | null): Prisma.AppointmentWhereInput {
    const where: Prisma.AppointmentWhereInput = {
      scheduleSlot: {
        startTime: { gte: range.gte, lte: range.lte },
      },
    };
    if (orgId) where.organizationId = orgId;
    return where;
  }

  // ────────────────────────────────────────────────────────────
  // CONTADORES (todos van por _count, nada de findMany)
  // ────────────────────────────────────────────────────────────

  private async countLoginsByRole(
    role: 'ORG_ADMIN' | 'DOCTOR' | 'BOOKING_AGENT',
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    // SystemLog guarda el rol dentro de metadata. Usamos filtro JSON
    // nativo de Prisma para no traer el blob completo.
    const where: Prisma.SystemLogWhereInput = {
      action: 'USER_LOGIN',
      createdAt: { gte: range.gte, lte: range.lte },
      metadata: { path: ['role'], equals: role } as any,
    };
    if (orgId) where.organizationId = orgId;

    return this.prisma.systemLog.count({ where });
  }

  private countAppointmentsByStatus(
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED',
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    return this.prisma.appointment.count({
      where: { ...this.whereAppointment(range, orgId), status },
    });
  }

  // Citas fallidas = canceladas O paciente no asistió (NO_SHOW).
  private countAppointmentsFailed(range: ResolvedRange, orgId: string | null): Promise<number> {
    return this.prisma.appointment.count({
      where: {
        ...this.whereAppointment(range, orgId),
        OR: [{ status: 'CANCELLED' }, { attendanceStatus: 'NO_SHOW' }],
      },
    });
  }

  private countSystemLogAction(
    action: string,
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    const where: Prisma.SystemLogWhereInput = {
      action,
      createdAt: { gte: range.gte, lte: range.lte },
    };
    if (orgId) where.organizationId = orgId;
    return this.prisma.systemLog.count({ where });
  }

  private countNewPatients(range: ResolvedRange, orgId: string | null): Promise<number> {
    return this.prisma.patientProfile.count({
      where: this.whereCreatedAt(range, orgId) as Prisma.PatientProfileWhereInput,
    });
  }

  private countSignedClinicalRecords(range: ResolvedRange, orgId: string | null): Promise<number> {
    return this.prisma.clinicalRecord.count({
      where: {
        ...(this.whereCreatedAt(range, orgId) as Prisma.ClinicalRecordWhereInput),
        status: 'SIGNED',
      },
    });
  }

  private countLegalAddendums(range: ResolvedRange, orgId: string | null): Promise<number> {
    // Addendum no tiene organizationId propio: lo filtramos vía clinicalRecord.
    const where: Prisma.AddendumWhereInput = {
      createdAt: { gte: range.gte, lte: range.lte },
    };
    if (orgId) {
      where.clinicalRecord = { organizationId: orgId };
    }
    return this.prisma.addendum.count({ where });
  }

  // Clínicas únicas que en el periodo crearon AL MENOS una cita o una HC.
  // groupBy + length es O(clínicas), no O(filas).
  private async countActiveOrganizations(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    // Si ya se filtró a una sola clínica, basta verificar si tuvo actividad.
    if (orgId) {
      const [hasAppt, hasRecord] = await Promise.all([
        this.prisma.appointment.count({
          where: { ...this.whereAppointment(range, orgId), organizationId: orgId },
        }),
        this.prisma.clinicalRecord.count({
          where: {
            createdAt: { gte: range.gte, lte: range.lte },
            organizationId: orgId,
          },
        }),
      ]);
      return hasAppt > 0 || hasRecord > 0 ? 1 : 0;
    }

    const [byAppt, byRecord] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['organizationId'],
        where: {
          ...this.whereAppointment(range, null),
          organizationId: { not: null },
        },
      }),
      this.prisma.clinicalRecord.groupBy({
        by: ['organizationId'],
        where: {
          createdAt: { gte: range.gte, lte: range.lte },
          organizationId: { not: null },
        },
      }),
    ]);

    const unique = new Set<string>();
    byAppt.forEach((r) => r.organizationId && unique.add(r.organizationId));
    byRecord.forEach((r) => r.organizationId && unique.add(r.organizationId));
    return unique.size;
  }

  // ────────────────────────────────────────────────────────────
  // TRENDS (agregación SQL por día — pasa por $queryRaw porque
  // Prisma groupBy no soporta date_trunc nativo).
  // ────────────────────────────────────────────────────────────

  private async trendAppointmentsScheduled(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', s."startTime") AS day, COUNT(a.id)::bigint AS count
      FROM "Appointment" a
      INNER JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
      WHERE a.status = 'SCHEDULED'
        AND s."startTime" >= ${range.gte}
        AND s."startTime" <= ${range.lte}
        AND (${orgId}::text IS NULL OR a."organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }

  private async trendNewPatients(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "PatientProfile"
      WHERE "createdAt" >= ${range.gte}
        AND "createdAt" <= ${range.lte}
        AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }

  private async trendSystemLogAction(
    action: string,
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "SystemLog"
      WHERE action = ${action}
        AND "createdAt" >= ${range.gte}
        AND "createdAt" <= ${range.lte}
        AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }

  private async trendSignedClinicalRecords(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "ClinicalRecord"
      WHERE status = 'SIGNED'
        AND "createdAt" >= ${range.gte}
        AND "createdAt" <= ${range.lte}
        AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }
}
