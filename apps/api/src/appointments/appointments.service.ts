import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@antigravity/database';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(private prisma: PrismaService) {}

  // 1. LÓGICA DE BÚSQUEDA H.I.S: Busca slots pre-creados reales.
  async getAvailableSlots(
    serviceName: string,
    epsId?: string | null,
  ): Promise<any[]> {
    // En un HIS real, solo se ofrecen slots a partir de mañana, para un servicio en particular
    const now = new Date();

    // Consultamos la BD buscando huecos disponibles
    const rawSlots = await this.prisma.scheduleSlot.findMany({
      where: {
        isAvailable: true,
        startTime: { gt: now },
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

  // 2. LÓGICA DE TRANSACCIÓN: Intenta agendar ocupando el Slot Físico
  async bookAppointment(
    patientId: string,
    scheduleSlotId: string,
    epsId?: string | null,
    origin: 'WHATSAPP' | 'MANUAL' = 'WHATSAPP',
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // Utilizamos el motor transaccional de Prisma para evitar concurrencia
      await this.prisma.$transaction(async (tx) => {
        // 1. Verificar si sigue libre y bloquear la fila momentáneamente si la BD lo soporta
        const slot = await tx.scheduleSlot.findUnique({
          where: { id: scheduleSlotId },
        });

        if (!slot || !slot.isAvailable) {
          throw new Error('SLOT_TAKEN');
        }

        // 2. Marcar slot como Ocupado
        await tx.scheduleSlot.update({
          where: { id: scheduleSlotId },
          data: { isAvailable: false },
        });

        // 3. Crear el record de Cita conectado al Slot
        await tx.appointment.create({
          data: {
            scheduleSlotId,
            patientId,
            epsId,
            origin,
          },
        });
      });

      return { success: true };
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
}
