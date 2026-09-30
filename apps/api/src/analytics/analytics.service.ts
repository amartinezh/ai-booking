import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@agenia/database';
import { horaLocalAUtc } from '@agenia/shared';

/** Zona de los filtros y del volumen diario. Multi-tenant: Organization.timezone. */
const TIME_ZONE = 'America/Bogota';

/** `yyyy-mm-dd` → medianoche de ESE día en Bogotá (instante UTC). null si no es fecha. */
function inicioDelDia(fecha: string, diasExtra = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  return horaLocalAUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]) + diasExtra,
    0,
    TIME_ZONE,
  );
}

/** Día de Bogotá de un instante, como `yyyy-mm-dd` (en-CA da ese formato). */
const diaLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(
    organizationId: string,
    startDate?: string,
    endDate?: string,
  ) {
    // Días completos de Bogotá: antes se cortaba a medianoche UTC (7 p. m.
    // en Colombia) y las citas de la noche caían en el día equivocado.
    const startTime: Prisma.DateTimeFilter = {};
    const desde = startDate ? inicioDelDia(startDate) : null;
    const finExcl = endDate ? inicioDelDia(endDate, 1) : null;
    if (desde) startTime.gte = desde;
    if (finExcl) startTime.lte = new Date(finExcl.getTime() - 1);

    const where: Prisma.AppointmentWhereInput = {
      organizationId,
      ...(startDate || endDate ? { scheduleSlot: { startTime } } : {}),
    };

    // 1. KPIs
    const totalAppointments = await this.prisma.appointment.count({ where });
    const completedAppointments = await this.prisma.appointment.count({
      where: { ...where, status: 'COMPLETED' },
    });
    const cancelledAppointments = await this.prisma.appointment.count({
      where: { ...where, status: 'CANCELLED' },
    });

    // 2. Specialty Distribution
    const specialtyDistributionRaw = await this.prisma.appointment.findMany({
      where,
      select: {
        scheduleSlot: {
          select: {
            service: { select: { name: true } },
          },
        },
      },
    });
    const specialtyMap: Record<string, number> = {};
    specialtyDistributionRaw.forEach((apt) => {
      const name = apt.scheduleSlot?.service?.name || 'Unknown';
      specialtyMap[name] = (specialtyMap[name] || 0) + 1;
    });
    const specialtyDistribution = Object.entries(specialtyMap).map(
      ([name, count]) => ({ name, count }),
    );

    // 3. EPS Quota
    const epsDistributionRaw = await this.prisma.appointment.findMany({
      where,
      select: { eps: { select: { name: true } } },
    });
    const epsMap: Record<string, number> = {};
    epsDistributionRaw.forEach((apt) => {
      const name = apt.eps?.name || 'Particular / Sin EPS';
      epsMap[name] = (epsMap[name] || 0) + 1;
    });
    const epsDistribution = Object.entries(epsMap).map(([name, count]) => ({
      name,
      count,
    }));

    // 4. Origin Distribution
    const originDistributionRaw = await this.prisma.appointment.groupBy({
      by: ['origin'],
      where: where,
      _count: { _all: true },
    });
    const originDistribution = originDistributionRaw.map((o) => ({
      name: o.origin,
      count: o._count._all,
    }));

    // 5. Temporal Volume (Daily)
    const temporalRaw = await this.prisma.appointment.findMany({
      where,
      select: { scheduleSlot: { select: { startTime: true } } },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
    });

    const temporalMap: Record<string, number> = {};
    temporalRaw.forEach((apt) => {
      if (apt.scheduleSlot?.startTime) {
        const dateStr = diaLocal.format(apt.scheduleSlot.startTime);
        temporalMap[dateStr] = (temporalMap[dateStr] || 0) + 1;
      }
    });
    const temporalVolume = Object.entries(temporalMap).map(([date, count]) => ({
      date,
      count,
    }));

    return {
      kpis: {
        total: totalAppointments,
        completed: completedAppointments,
        cancelled: cancelledAppointments,
      },
      charts: {
        specialtyDistribution,
        epsDistribution,
        originDistribution,
        temporalVolume,
      },
    };
  }
}
