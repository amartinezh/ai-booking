import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@antigravity/database';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(private prisma: PrismaService) {}

  // 1. LÓGICA DE BÚSQUEDA H.I.S
  async getAvailableSlots(
    serviceName: string,
    epsId?: string | null,
    organizationId?: string,
    // Ventana de fecha preferida por el paciente ("mañana", "el lunes"...).
    // Opcional: sin ella, la consulta es idéntica a la histórica (próximos cupos).
    dateWindow?: { desde: Date; hasta: Date } | null,
  ): Promise<any[]> {
    const now = new Date();

    // Con ventana, acotamos a [max(desde, ahora) .. hasta] para no ofrecer
    // horas pasadas si el paciente pidió "hoy". Sin ventana, conducta de siempre.
    const startTimeFilter = dateWindow
      ? {
          gte: dateWindow.desde > now ? dateWindow.desde : now,
          lte: dateWindow.hasta,
        }
      : { gt: now };

    const rawSlots = await this.prisma.scheduleSlot.findMany({
      where: {
        organizationId: organizationId, // 🏢 AISLAMIENTO DE TENANT
        isAvailable: true,
        startTime: startTimeFilter,
        service: {
          name: { contains: serviceName, mode: 'insensitive' },
        },
        // Filtro clave: El slot debe ser universal (null) o ser exclusivo para la EPS del paciente
        OR: [{ allowedEpsId: null }, { allowedEpsId: epsId }],
      },
      include: { doctor: true, service: true },
      orderBy: { startTime: 'asc' },
      take: 10, // Retornamos los próximos 10 cupos
    });

    // Mapeamos para que Gemini lo pueda entender fácil
    return rawSlots.map((slot) => ({
      slotId: slot.id,
      fecha: slot.startTime,
      doctor: slot.doctor.fullName,
      servicio: slot.service.name,
    }));
  }

  // 2. LÓGICA DE TRANSACCIÓN
  async bookAppointment(
    patientId: string,
    scheduleSlotId: string,
    epsId?: string | null,
    origin: 'WHATSAPP' | 'MANUAL' = 'WHATSAPP',
    organizationId?: string,
  ): Promise<{ success: boolean; message?: string; appointmentId?: string }> {
    try {
      let appointmentId: string | undefined;
      await this.prisma.$transaction(async (tx) => {
        const slot = await tx.scheduleSlot.findUnique({
          where: { id: scheduleSlotId },
        });

        if (
          !slot ||
          !slot.isAvailable ||
          (organizationId && slot.organizationId !== organizationId)
        ) {
          throw new Error('SLOT_TAKEN_OR_INVALID');
        }

        // 2. Marcar slot como Ocupado
        await tx.scheduleSlot.update({
          where: { id: scheduleSlotId },
          data: { isAvailable: false },
        });

        // 3. Crear el record de Cita conectado al Slot
        const appointment = await tx.appointment.create({
          data: {
            scheduleSlotId,
            patientId,
            epsId,
            origin,
            organizationId: organizationId || slot.organizationId, // 🏢 TENANT ISOLATION
          },
        });
        appointmentId = appointment.id;
      });

      return { success: true, appointmentId };
    } catch (error: any) {
      // El catch atrapará si el constraint @unique choca o si lanzamos SLOT_TAKEN
      if (
        error.message === 'SLOT_TAKEN' ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        this.logger.warn(
          `Colisión detectada: El slot ${scheduleSlotId} acaba de ser tomado.`,
        );
        return {
          success: false,
          message:
            'Lo sentimos, el horario acaba de ser reservado por otro paciente.',
        };
      }
      this.logger.error('Error crítico al guardar la cita', error);
      throw error;
    }
  }

  // 3. CONTROL DE ASISTENCIA
  async updateAttendance(
    appointmentId: string,
    status: any,
    organizationId?: string,
  ): Promise<any> {
    // Verificamos antes para evitar NotFoundExceptions por isolation o seguridad
    const apt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
    });
    if (!apt)
      throw new Error('Cita no encontrada o no pertenece a tu Organización.');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { attendanceStatus: status },
      include: {
        patient: true,
        scheduleSlot: { include: { doctor: true, service: true } },
      },
    });

    return {
      success: true,
      data: updated,
    };
  }
}
