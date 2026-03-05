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
        patientId: string, // 🛑 NUEVO: Ahora pasamos patientId en lugar de userId
        specialty: string,
        date: Date,
        bookedViaAi: boolean = false
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Lógica para asignar al primer doctor disponible de esa especialidad 👨‍⚕️
            // Para mantener la simplicidad, tomaremos el primer doctor de la BD 
            // que tenga la especialidad solicitada (en producción sería más complejo).
            const doctor = await this.prisma.doctorProfile.findFirst({
                where: { specialty, isActive: true }
            });

            await this.prisma.appointment.create({
                data: {
                    date,
                    specialty,
                    patientId, // 🛑 Inyectamos el ID del paciente, no del User genérico.
                    doctorId: doctor ? doctor.id : null, // Asignamos doctor si hay
                    bookedViaAi,
                },
            });
            return { success: true };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                this.logger.warn(`Colisión detectada: El slot ${date} para ${specialty} acaba de ser tomado.`);
                return { success: false, message: 'Lo sentimos, el horario o el doctor acaba de ser reservado.' };
            }
            this.logger.error('Error crítico al guardar la cita', error);
            throw error;
        }
    }
}