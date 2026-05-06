// @ts-nocheck
import {
    Controller,
    Get,
    Post,
    Param,
    Body,
    Query,
} from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';

@Controller('auditoria')
export class AuditoriaController {
    constructor(private readonly auditoriaService: AuditoriaService) { }

    /**
     * GET /auditoria?organizationId=...&onlyPending=true
     *
     * NOTA TEMPORAL: organizationId viene como query param.
     * Cuando exista JwtAuthGuard, debe venir del token (req.user.organizationId).
     */
    @Get()
    async listar(
        @Query('organizationId') organizationId: string,
        @Query('onlyPending') onlyPending?: string,
    ) {
        if (!organizationId) {
            return [];
        }

        return this.auditoriaService.listarLogs({
            organizationId,
            onlyPending: onlyPending === 'true',
        });
    }

    /**
     * POST /auditoria/:id/contactar
     * Body: { notes?: string, organizationId: string, contactedBy: string }
     *
     * NOTA TEMPORAL: contactedBy y organizationId vienen en body.
     * Cuando exista JwtAuthGuard, deben venir del token.
     */
    @Post(':id/contactar')
    async marcarContactado(
        @Param('id') id: string,
        @Body() body: { notes?: string; organizationId: string; contactedBy?: string },
    ) {
        return this.auditoriaService.marcarContactado({
            logId: id,
            organizationId: body.organizationId,
            contactedBy: body.contactedBy || 'sistema',
            notes: body.notes,
        });
    }
}