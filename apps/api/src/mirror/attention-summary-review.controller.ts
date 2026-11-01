import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import {
  CurrentUser,
  type JwtUserPayload,
} from '../common/current-user.decorator';
import { MirrorAttentionSummaryService } from './mirror-attention-summary.service';

/**
 * 🩺 Revisar un resumen de la atención contra el HIS (cierre de la Fase 1,
 * docs/PLAN_RESUMEN_ATENCION.md §8).
 *
 * Fuera de `/mirror` a propósito: el proxy del servidor deja salir a internet
 * `/api/mirror*`, que es del agente. Esto solo lo llama el panel por la red
 * interna. Solo el administrador de la clínica; la clínica y quién lo abre
 * salen del TOKEN, nunca de la petición.
 */
@Controller('attention-summaries')
@UseGuards(RolesGuard)
export class AttentionSummaryReviewController {
  constructor(private readonly resumenes: MirrorAttentionSummaryService) {}

  @Get(':id')
  @Roles('ORG_ADMIN')
  abrir(
    @CurrentTenant() organizationId: string | null | undefined,
    @CurrentUser() user: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin clínica.');
    return this.resumenes.abrirParaRevisar(organizationId, id, {
      userId: user.userId,
      email: user.email,
    });
  }
}
