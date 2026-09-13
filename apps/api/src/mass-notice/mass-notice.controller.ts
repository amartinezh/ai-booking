import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { MassNoticeService } from './mass-notice.service';
import { MirrorNoticeService } from '../mirror/mirror-notice.service';

/**
 * Endpoints HTTP de los avisos masivos — EXCLUSIVO del driver
 * cnt-sanvicente-anserma (ver PLAN_AVISOS_MASIVOS.md). Armar el lote, elegir
 * destinatarios y escribir la nota adicional pasa por server actions de
 * `apps/web` (acceso directo a Prisma, igual que el padrón); este controlador
 * expone los pasos que necesitan credenciales de WhatsApp o el canal del
 * agente y no pueden vivir en el web — el envío real, y (Fase 2) pedirle al
 * agente la lista de citas de un médico.
 *
 * `MirrorNoticeService` vive en `mirror/` (mismo dueño que `NoticeRosterRequest`)
 * pero estos dos endpoints los llama STAFF con JWT, no el agente — por eso se
 * exponen aquí, con `RolesGuard`, y no en `MirrorController` (`MirrorAgentGuard`).
 */
@Controller('mass-notice')
@UseGuards(RolesGuard)
export class MassNoticeController {
  constructor(
    private readonly massNotice: MassNoticeService,
    private readonly mirrorNotice: MirrorNoticeService,
  ) {}

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

  /**
   * Paso 1 de la fuente espejo (§5): "tráeme las citas del Dr. X entre el 25
   * y el 26". Crea la petición; el agente la resuelve en su siguiente vuelta
   * (~30 s) — la pantalla hace polling con `GET .../notice-request/:id`.
   */
  @Post(':batchId/notice-request')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN', 'BOOKING_AGENT')
  async createNoticeRequest(
    @CurrentTenant() organizationId: string,
    @Param('batchId') batchId: string,
    @Body()
    body: { doctorExternalKey?: string; fromIso?: string; toIso?: string },
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    if (!body?.doctorExternalKey || !body?.fromIso || !body?.toIso) {
      throw new ForbiddenException(
        'doctorExternalKey, fromIso y toIso son obligatorios.',
      );
    }
    return this.mirrorNotice.createRequest(organizationId, {
      batchId,
      doctorExternalKey: body.doctorExternalKey,
      fromIso: body.fromIso,
      toIso: body.toIso,
    });
  }

  @Get('notice-request/:requestId')
  @Roles('ORG_ADMIN', 'BOOKING_AGENT')
  async getNoticeRequestStatus(
    @CurrentTenant() organizationId: string,
    @Param('requestId') requestId: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    const status = await this.mirrorNotice.getRequestStatus(
      organizationId,
      requestId,
    );
    if (!status) throw new NotFoundException('Petición no encontrada.');
    return status;
  }
}
