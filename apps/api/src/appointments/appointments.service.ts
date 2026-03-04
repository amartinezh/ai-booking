import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@antigravity/database';

@Injectable()
export class AppointmentsService {
    private readonly logger = new Logger(AppointmentsService.name);

    constructor(private prisma: PrismaService) { }

    // 1. LÓGICA DE BÚSQUEDA: Genera slots y filtra los ocupados
    async getAvailableSlots(specialty: string): Promise<Date[]> {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(8, 0, 0, 0);

        const dayAfter = new Date();
        dayAfter.setDate(dayAfter.getDate() + 2);
        dayAfter.setHours(10, 0, 0, 0);

        const potentialSlots = [tomorrow, dayAfter];

        const bookedAppointments = await this.prisma.appointment.findMany({
            where: {
                specialty,
                date: { in: potentialSlots },
                status: 'SCHEDULED',
            },
            select: { date: true },
        });

        const bookedDates = bookedAppointments.map((app) => app.date.getTime());

        return potentialSlots.filter((slot) => !bookedDates.includes(slot.getTime()));
    }

    // 2. LÓGICA DE TRANSACCIÓN: Intenta agendar y maneja la colisión
    async bookAppointment(
        userId: string,
        specialty: string,
        date: Date,
        bookedViaAi: boolean = false // 🛑 NUEVO: Recibimos la bandera (por defecto false)
    ): Promise<{ success: boolean; message?: string }> {
        try {
            await this.prisma.appointment.create({
                data: {
                    date,
                    specialty,
                    userId,
                    bookedViaAi, // 🛑 NUEVO: Lo guardamos en PostgreSQL
                },
            });
            return { success: true };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                this.logger.warn(`Colisión detectada: El slot ${date} para ${specialty} acaba de ser tomado.`);
                return { success: false, message: 'Lo sentimos, ese horario acaba de ser reservado por otra persona.' };
            }
            this.logger.error('Error crítico al guardar la cita', error);
            throw error;
        }
    }
}