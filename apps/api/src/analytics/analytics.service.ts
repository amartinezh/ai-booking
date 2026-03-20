import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(startDate?: string, endDate?: string) {
    const where: any = {};
    if (startDate || endDate) {
      where.scheduleSlot = { startTime: {} };
      if (startDate) {
        where.scheduleSlot.startTime.gte = new Date(`${startDate}T00:00:00.000Z`);
      }
      if (endDate) {
        where.scheduleSlot.startTime.lte = new Date(`${endDate}T23:59:59.999Z`);
      }
    }

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
             service: { select: { name: true } }
          }
        }
      }
    });
    const specialtyMap: Record<string, number> = {};
    specialtyDistributionRaw.forEach(apt => {
        const name = apt.scheduleSlot?.service?.name || 'Unknown';
        specialtyMap[name] = (specialtyMap[name] || 0) + 1;
    });
    const specialtyDistribution = Object.entries(specialtyMap).map(([name, count]) => ({ name, count }));

    // 3. EPS Quota
    const epsDistributionRaw = await this.prisma.appointment.findMany({
      where,
      select: { eps: { select: { name: true } } }
    });
    const epsMap: Record<string, number> = {};
    epsDistributionRaw.forEach(apt => {
        const name = apt.eps?.name || 'Particular / Sin EPS';
        epsMap[name] = (epsMap[name] || 0) + 1;
    });
    const epsDistribution = Object.entries(epsMap).map(([name, count]) => ({ name, count }));

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
    temporalRaw.forEach(apt => {
        if(apt.scheduleSlot?.startTime) {
            const dateStr = apt.scheduleSlot.startTime.toISOString().split('T')[0];
            temporalMap[dateStr] = (temporalMap[dateStr] || 0) + 1;
        }
    });
    const temporalVolume = Object.entries(temporalMap).map(([date, count]) => ({ date, count }));

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
