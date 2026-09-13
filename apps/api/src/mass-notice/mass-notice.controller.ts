import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { MassNoticeService } from './mass-notice.service';

/**
 * Endpoints HTTP de los avisos masivos — EXCLUSIVO del driver
 * cnt-sanvicente-anserma (ver PLAN_AVISOS_MASIVOS.md). Armar el lote, elegir
 * destinatarios y escribir la nota adicional pasa por server actions de
 * `apps/web` (acceso directo a Prisma, igual que el padrón); este controlador
 * expone ÚNICAMENTE el paso que necesita credenciales de WhatsApp y no puede
 * vivir en el web — el envío real.
 */
@Controller('mass-notice')
@UseGuards(RolesGuard)
export class MassNoticeController {
  constructor(private readonly massNotice: MassNoticeService) {}

  @Post(':batchId/send')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN', 'BOOKING_AGENT')
  async send(
    @CurrentTenant() organizationId: string,
    @Param('batchId') batchId: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.massNotice.sendBatch(batchId, organizationId);
  }
}
