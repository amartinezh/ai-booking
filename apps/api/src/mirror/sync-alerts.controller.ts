import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import {
  CurrentUser,
  type JwtUserPayload,
} from '../common/current-user.decorator';
import { MirrorAlertService } from './mirror-alert.service';

/**
 * 📣 «Probar» de la lista de avisos de la Bandeja (docs/PLAN_AVISOS_AGENDADORES.md, N9).
 *
 * Fuera de `/mirror` a propósito: el proxy del servidor deja salir a internet
 * `/api/mirror*` (es del agente); esto solo lo llama el panel por la red interna.
 * Solo el administrador de la clínica; la clínica y quién lo pidió salen del TOKEN,
 * y la persona se busca DENTRO de esa clínica.
 */
@Controller('sync-alerts')
@UseGuards(RolesGuard)
export class SyncAlertsController {
  constructor(private readonly alertas: MirrorAlertService) {}

  @Post('recipients/:id/test')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN')
  async probar(
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const recipientId = typeof id === 'string' ? id.trim() : '';
    if (!recipientId || recipientId.length > 64) {
      return { success: false, error: 'Falta la persona.' };
    }
    return this.alertas.probar(
      organizationId,
      recipientId,
      user?.email ?? user?.userId ?? 'un administrador',
    );
  }
}
