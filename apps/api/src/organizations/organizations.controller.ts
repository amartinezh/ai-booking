import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { OrganizationsService } from './organizations.service';
import type {
  AuditActor,
  PurgeOrganizationInput,
} from './dto/organizations.types';

/**
 * 🏢 Acciones críticas del Super Admin sobre organizaciones (clínicas).
 *
 * Protegido por RolesGuard + JWT como el resto de la API. Sólo SUPER_ADMIN.
 */
@Controller('organizations')
@UseGuards(RolesGuard)
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  // POST /organizations/:id/purge
  // Body: { purgePassword: string }
  // Hard delete transaccional e irreversible + auditoría inmutable.
  @Post(':id/purge')
  @Roles('SUPER_ADMIN')
  purge(
    @Param('id') id: string,
    @Body() body: PurgeOrganizationInput,
    @Req() req: Request,
  ) {
    return this.service.purge(id, body?.purgePassword, this.extractActor(req));
  }

  // GET /organizations/:id/quick-stats
  // Resumen estadístico optimizado (solo agregaciones).
  @Get(':id/quick-stats')
  @Roles('SUPER_ADMIN')
  quickStats(@Param('id') id: string) {
    return this.service.quickStats(id);
  }

  /** Hidrata el actor desde el JWT (lo puso RolesGuard) y la IP de la request. */
  private extractActor(req: Request): AuditActor {
    const user = (req as any).user ?? {};
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;

    return {
      actorId: user.userId ?? null,
      actorEmail: user.email ?? null,
      ipAddress: ipAddress ?? null,
    };
  }
}
