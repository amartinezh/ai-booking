import { Injectable } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import { resolverRangoEstadisticas } from '@agenia/shared';
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
//   - Los rangos (hoy, semana, mes, año) y los días de las tendencias son los
//     de Bogotá, no los de UTC (ver CLAUDE.md, fechas): antes «hoy» empezaba a
//     las 7 p. m. del día anterior.
//
// Fuentes de los contadores que antes salían SIEMPRE en 0 (leían acciones de
// SystemLog que nadie escribía):
//   - 'USER_LOGIN'  → lo escribe el login de la web (metadata.role = Role).
//   - Mensajes recibidos por el bot → ChannelActivityLog (event INBOUND),
//     un registro exacto por mensaje entrante.
//   - Emergencias derivadas → InteractionLog status EMERGENCY_ESCALATED (el
//     bot no tiene «paso a humano»; la derivación por emergencia es lo que
//     existe). La caja negra se purga a los 180 días.
// ══════════════════════════════════════════════════════════════

export type TimeRange = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export interface StatsFilters {
  organizationId?: string | null; // null/undefined = global (todas las clínicas)
  range?: TimeRange;
  startDate?: string; // ISO date (yyyy-mm-dd) — solo cuando range = CUSTOM
  endDate?: string; // ISO date (yyyy-mm-dd)
}

interface ResolvedRange {
  gte: Date;
  lte: Date;
}

export interface TrendPoint {
  date: string; // yyyy-mm-dd, día de Bogotá
  count: number;
}

/** Zona de los rangos y tendencias. Multi-tenant: vendrá de Organization.timezone. */
const TIME_ZONE = 'America/Bogota';

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
      emergencyEscalations,
      newPatients,
      signedClinicalRecords,
      legalAddendums,
      botMessagesReceived,
      activeOrganizations,
      // Trends (un solo bucket por día — barato porque agrupa en SQL).
      appointmentsTrend,
      patientsTrend,
      botMessagesTrend,
      signedRecordsTrend,
    ] = await Promise.all([
      this.countLoginsByRole('ORG_ADMIN', range, orgId),
      this.countLoginsByRole('DOCTOR', range, orgId),
      this.countLoginsByRole('BOOKING_AGENT', range, orgId),
      this.countAppointmentsByStatus('SCHEDULED', range, orgId),
      this.countAppointmentsFailed(range, orgId),
      this.countEmergencyEscalations(range, orgId),
      this.countNewPatients(range, orgId),
      this.countSignedClinicalRecords(range, orgId),
      this.countLegalAddendums(range, orgId),
      this.countBotMessagesReceived(range, orgId),
      this.countActiveOrganizations(range, orgId),
      // Tendencias por día.
      this.trendAppointmentsScheduled(range, orgId),
      this.trendNewPatients(range, orgId),
      this.trendBotMessagesReceived(range, orgId),
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
        // Bot (punto 6): derivaciones por posible emergencia médica.
        emergencyEscalations,
        // HealthTech relevantes (puntos 7–11).
        newPatients,
        signedClinicalRecords,
        legalAddendums,
        botMessagesReceived,
        activeOrganizations,
      },
      trends: {
        appointmentsScheduled: appointmentsTrend,
        newPatients: patientsTrend,
        botMessagesReceived: botMessagesTrend,
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
    // Rango en la hora de Bogotá (helper compartido con «Canales en vivo»).
    // `lte` es el último milisegundo del rango, como siempre usó este servicio.
    const r = resolverRangoEstadisticas({
      range: filters.range,
      startDate: filters.startDate,
      endDate: filters.endDate,
      timeZone: TIME_ZONE,
    });
    return { gte: r.gte, lte: new Date(r.lt.getTime() - 1) };
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
    if (orgId) where.organizationId = orgId;
    return where;
  }

  // Para Appointment: la fecha clínica vive en scheduleSlot.startTime.
  private whereAppointment(
    range: ResolvedRange,
    orgId: string | null,
  ): Prisma.AppointmentWhereInput {
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
      metadata: {
        path: ['role'],
        equals: role,
      } satisfies Prisma.JsonFilter<'SystemLog'>,
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
  private countAppointmentsFailed(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    return this.prisma.appointment.count({
      where: {
        ...this.whereAppointment(range, orgId),
        OR: [{ status: 'CANCELLED' }, { attendanceStatus: 'NO_SHOW' }],
      },
    });
  }

  private countEmergencyEscalations(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    const where: Prisma.InteractionLogWhereInput = {
      status: 'EMERGENCY_ESCALATED',
      createdAt: { gte: range.gte, lte: range.lte },
    };
    if (orgId) where.organizationId = orgId;
    return this.prisma.interactionLog.count({ where });
  }

  private countBotMessagesReceived(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    const where: Prisma.ChannelActivityLogWhereInput = {
      event: 'INBOUND',
      createdAt: { gte: range.gte, lte: range.lte },
    };
    if (orgId) where.organizationId = orgId;
    return this.prisma.channelActivityLog.count({ where });
  }

  private countNewPatients(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    return this.prisma.patientProfile.count({
      where: this.whereCreatedAt(
        range,
        orgId,
      ) as Prisma.PatientProfileWhereInput,
    });
  }

  private countSignedClinicalRecords(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
    return this.prisma.clinicalRecord.count({
      where: {
        ...(this.whereCreatedAt(
          range,
          orgId,
        ) as Prisma.ClinicalRecordWhereInput),
        status: 'SIGNED',
      },
    });
  }

  private countLegalAddendums(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<number> {
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
          where: {
            ...this.whereAppointment(range, orgId),
            organizationId: orgId,
          },
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
      // Appointment.organizationId ya es NOT NULL: no hace falta filtrarlo.
      this.prisma.appointment.groupBy({
        by: ['organizationId'],
        where: this.whereAppointment(range, null),
      }),
      // ClinicalRecord.organizationId ya es NOT NULL: no hace falta filtrarlo.
      this.prisma.clinicalRecord.groupBy({
        by: ['organizationId'],
        where: {
          createdAt: { gte: range.gte, lte: range.lte },
        },
      }),
    ]);

    const unique = new Set<string>();
    byAppt.forEach((r) => r.organizationId && unique.add(r.organizationId));
    byRecord.forEach((r) => r.organizationId && unique.add(r.organizationId));
    return unique.size;
  }

  // ────────────────────────────────────────────────────────────
  // TRENDS (agregación SQL por día de Bogotá — pasa por $queryRaw porque
  // Prisma groupBy no agrupa por expresiones). `timestamp(3)` guarda UTC sin
  // zona: `AT TIME ZONE 'UTC'` lo marca como UTC y el segundo lo pasa a Bogotá.
  // ────────────────────────────────────────────────────────────

  private async trendAppointmentsScheduled(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; count: bigint }>
    >`
      SELECT to_char((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day, COUNT(a.id)::bigint AS count
      FROM "Appointment" a
      INNER JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
      WHERE a.status = 'SCHEDULED'
        AND s."startTime" >= ${range.gte}
        AND s."startTime" <= ${range.lte}
        AND (${orgId}::text IS NULL OR a."organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({ date: r.day, count: Number(r.count) }));
  }

  private async trendNewPatients(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; count: bigint }>
    >`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
      FROM "PatientProfile"
      WHERE "createdAt" >= ${range.gte}
        AND "createdAt" <= ${range.lte}
        AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({ date: r.day, count: Number(r.count) }));
  }

  private async trendBotMessagesReceived(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; count: bigint }>
    >`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
      FROM "ChannelActivityLog"
      WHERE event = 'INBOUND'
        AND "createdAt" >= ${range.gte}
        AND "createdAt" <= ${range.lte}
        AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({ date: r.day, count: Number(r.count) }));
  }

  private async trendSignedClinicalRecords(
    range: ResolvedRange,
    orgId: string | null,
  ): Promise<TrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; count: bigint }>
    >`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
      FROM "ClinicalRecord"
      WHERE status = 'SIGNED'
        AND "createdAt" >= ${range.gte}
        AND "createdAt" <= ${range.lte}
        AND (${orgId}::text IS NULL OR "organizationId" = ${orgId})
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({ date: r.day, count: Number(r.count) }));
  }
}
