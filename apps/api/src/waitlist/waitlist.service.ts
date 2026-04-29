// @ts-nocheck
import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ChatbotService } from '../chatbot/chatbot.service';

@Injectable()
export class WaitlistService {
    private readonly logger = new Logger(WaitlistService.name);
    private readonly CONFIRMATION_TTL_MINUTES = 30;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        @Inject(forwardRef(() => ChatbotService))
        private chatbotService: ChatbotService,
    ) { }

    // ════════════════════════════════════════════════════════════
    // 1. UNIRSE A LA LISTA DE ESPERA
    // ════════════════════════════════════════════════════════════
    async joinWaitlist(params: {
        patientId: string;
        serviceId: string;
        epsId: string | null;
        whatsappId: string;
        organizationId: string;
    }): Promise<{ success: boolean; position: number }> {
        const { patientId, serviceId, epsId, whatsappId, organizationId } = params;

        // Evitar duplicados: si ya está esperando lo mismo, devolver su posición actual
        const existing = await this.prisma.waitlistEntry.findFirst({
            where: { patientId, serviceId, organizationId, status: 'WAITING' },
        });

        if (existing) {
            const position = await this.getPosition(existing.id, serviceId, epsId, organizationId);
            return { success: true, position };
        }

        const entry = await this.prisma.waitlistEntry.create({
            data: { patientId, serviceId, epsId, whatsappId, organizationId },
        });

        const position = await this.getPosition(entry.id, serviceId, epsId, organizationId);
        this.logger.log(`Paciente ${patientId} en waitlist posición ${position}`);
        return { success: true, position };
    }

    // ════════════════════════════════════════════════════════════
    // 2. NOTIFICAR CUANDO UN SLOT SE LIBERA
    // ════════════════════════════════════════════════════════════
    async notifyWaitlist(params: {
        slotId: string;
        serviceId: string;
        epsId: string | null;
        organizationId: string;
        doctorName: string;
        slotDate: Date;
    }): Promise<void> {
        const { slotId, serviceId, epsId, organizationId, doctorName, slotDate } = params;

        // Buscar al primer candidato FIFO compatible (universal o de la EPS específica)
        const candidate = await this.prisma.waitlistEntry.findFirst({
            where: {
                serviceId,
                organizationId,
                status: 'WAITING',
                OR: [{ epsId: null }, { epsId }],
            },
            include: { patient: true, service: true },
            orderBy: { createdAt: 'asc' },
        });

        if (!candidate) {
            this.logger.log(`No hay candidatos en waitlist para servicio ${serviceId}`);
            return;
        }

        const expiresAt = new Date(Date.now() + this.CONFIRMATION_TTL_MINUTES * 60 * 1000);

        await this.prisma.waitlistEntry.update({
            where: { id: candidate.id },
            data: {
                status: 'NOTIFIED',
                notifiedAt: new Date(),
                expiresAt,
                metadata: {
                    pendingSlotId: slotId,
                    doctorName,
                    slotDate: slotDate.toISOString(),
                },
            },
        });

        // Delegar el envío del mensaje al ChatbotService (mantiene consistencia de tono)
        await this.chatbotService.notifyWaitlistCandidate({
            whatsappId: candidate.whatsappId,
            organizationId,
            nombre: candidate.patient.fullName,
            especialidad: candidate.service.name,
            doctor: doctorName,
            slotDate,
        });

        this.logger.log(`Notificación enviada a ${candidate.patient.fullName}`);
    }

    // ════════════════════════════════════════════════════════════
    // 3. CONFIRMAR O RECHAZAR DESDE EL CHATBOT
    // ════════════════════════════════════════════════════════════
    async confirmFromWaitlist(params: {
        whatsappId: string;
        organizationId: string;
        confirmed: boolean;
    }): Promise<{ slotId: string | null; patientId: string | null }> {
        const { whatsappId, organizationId, confirmed } = params;

        const entry = await this.prisma.waitlistEntry.findFirst({
            where: { whatsappId, organizationId, status: 'NOTIFIED' },
            include: { patient: true },
        });

        if (!entry) return { slotId: null, patientId: null };

        const metadata = entry.metadata as any;
        const slotId = metadata?.pendingSlotId as string;

        if (confirmed) {
            await this.prisma.waitlistEntry.update({
                where: { id: entry.id },
                data: { status: 'CONFIRMED' },
            });
            return { slotId, patientId: entry.patientId };
        }

        // Rechazó: marcar como cancelado y ofrecer al siguiente
        await this.prisma.waitlistEntry.update({
            where: { id: entry.id },
            data: { status: 'CANCELLED' },
        });

        await this.notifyWaitlist({
            slotId,
            serviceId: entry.serviceId,
            epsId: entry.epsId,
            organizationId,
            doctorName: metadata?.doctorName,
            slotDate: new Date(metadata?.slotDate),
        });

        return { slotId: null, patientId: null };
    }

    // ════════════════════════════════════════════════════════════
    // 4. CRON: EXPIRAR ENTRADAS SIN CONFIRMACIÓN (cada 5 min)
    // ════════════════════════════════════════════════════════════
    @Cron(CronExpression.EVERY_5_MINUTES)
    async expireStaleNotifications(): Promise<void> {
        const expired = await this.prisma.waitlistEntry.findMany({
            where: {
                status: 'NOTIFIED',
                expiresAt: { lt: new Date() },
            },
            include: { patient: true },
        });

        for (const entry of expired) {
            this.logger.log(`Expirando waitlist de ${entry.patient.fullName}`);
            const metadata = entry.metadata as any;

            await this.prisma.waitlistEntry.update({
                where: { id: entry.id },
                data: { status: 'EXPIRED' },
            });

            // Avisar al paciente que perdió el cupo
            try {
                await this.chatbotService.sendOutboundMessage(
                    entry.whatsappId,
                    `Lo sentimos, el tiempo para confirmar el cupo expiró. ⏰\n\nSi aún desea una cita, escríbame "Hola" y lo agregaremos nuevamente. 😊`,
                );
            } catch (e) {
                this.logger.warn(`No se pudo notificar expiración a ${entry.whatsappId}`);
            }

            // Ofrecer el slot al siguiente candidato
            if (metadata?.pendingSlotId) {
                await this.notifyWaitlist({
                    slotId: metadata.pendingSlotId,
                    serviceId: entry.serviceId,
                    epsId: entry.epsId,
                    organizationId: entry.organizationId,
                    doctorName: metadata.doctorName,
                    slotDate: new Date(metadata.slotDate),
                });
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    // HELPER: POSICIÓN EN LA LISTA
    // ════════════════════════════════════════════════════════════
    private async getPosition(
        entryId: string,
        serviceId: string,
        epsId: string | null,
        organizationId: string,
    ): Promise<number> {
        const entry = await this.prisma.waitlistEntry.findUnique({ where: { id: entryId } });
        if (!entry) return 1;

        const ahead = await this.prisma.waitlistEntry.count({
            where: {
                serviceId,
                organizationId,
                status: 'WAITING',
                OR: [{ epsId: null }, { epsId }],
                id: { not: entryId },
                createdAt: { lt: entry.createdAt },
            },
        });
        return ahead + 1;
    }
}