// @ts-nocheck
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditoriaService {
    private readonly logger = new Logger(AuditoriaService.name);

    constructor(private prisma: PrismaService) { }

    async marcarContactado(
        logId: string,
        contactedBy: string,
        notes?: string,
    ) {
        const log = await this.prisma.interactionLog.findUnique({
            where: { id: logId },
        });

        if (!log) {
            throw new NotFoundException(`InteractionLog ${logId} no encontrado`);
        }

        return this.prisma.interactionLog.update({
            where: { id: logId },
            data: {
                contactedAt: new Date(),
                contactedBy,
                contactNotes: notes || null,
            },
        });
    }

    async listarLogs(params: {
        organizationId: string;
        onlyFailures?: boolean;
        onlyPending?: boolean;
        limit?: number;
    }) {
        const { organizationId, onlyFailures = true, onlyPending = false, limit = 200 } = params;

        return this.prisma.interactionLog.findMany({
            where: {
                organizationId,
                ...(onlyFailures && { status: 'FAILED' }),
                ...(onlyPending && { contactedAt: null }),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }
}