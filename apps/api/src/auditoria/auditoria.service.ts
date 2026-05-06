// @ts-nocheck
import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditoriaService {
    private readonly logger = new Logger(AuditoriaService.name);

    constructor(private prisma: PrismaService) { }

    /**
     * Lista los logs de auditoría de una organización.
     * Por defecto solo trae fallos y abandonos (lo accionable).
     */
    async listarLogs(params: {
        organizationId: string;
        onlyPending?: boolean;
        limit?: number;
    }) {
        const { organizationId, onlyPending = false, limit = 200 } = params;

        return this.prisma.interactionLog.findMany({
            where: {
                organizationId,
                status: { in: ['FAILED', 'ABANDONED'] },
                ...(onlyPending && { contactedAt: null }),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /**
     * Marca un log como contactado por un funcionario.
     * Valida que el log pertenezca a la organización del usuario.
     */
    async marcarContactado(params: {
        logId: string;
        organizationId: string;
        contactedBy: string;
        notes?: string;
    }) {
        const { logId, organizationId, contactedBy, notes } = params;

        const log = await this.prisma.interactionLog.findUnique({
            where: { id: logId },
        });

        if (!log) {
            throw new NotFoundException(`Log ${logId} no encontrado`);
        }

        // 🔐 SEGURIDAD: solo permitir si pertenece a la org del usuario
        if (log.organizationId !== organizationId) {
            throw new ForbiddenException('No tiene acceso a este registro');
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
}