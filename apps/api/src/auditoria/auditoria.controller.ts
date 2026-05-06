// @ts-nocheck
import {
    Controller,
    Get,
    Post,
    Param,
    Body,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // si tienes auth

@Controller('auditoria')
// @UseGuards(JwtAuthGuard) // descomentar cuando tengas auth
export class AuditoriaController {
    constructor(private readonly auditoriaService: AuditoriaService) { }

    @Get()
    async listar(
        @Query('organizationId') organizationId: string,
        @Query('onlyPending') onlyPending?: string,
    ) {
        return this.auditoriaService.listarLogs({
            organizationId,
            onlyPending: onlyPending === 'true',
        });
    }

    @Post(':id/contactar')
    async marcarContactado(
        @Param('id') id: string,
        @Body() body: { notes?: string; contactedBy?: string },
    ) {
        // En producción, contactedBy debería venir del JWT del usuario logueado
        const contactedBy = body.contactedBy || 'sistema';
        return this.auditoriaService.marcarContactado(id, contactedBy, body.notes);
    }
}