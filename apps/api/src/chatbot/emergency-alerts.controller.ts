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
import { AlertaEmergenciaService } from './alerta-emergencia.service';

/**
 * 🚑 «Enviar prueba» de Configuración › Datos de la clínica › Alertas de posible
 * emergencia (docs/GUARDRAIL_EMERGENCIAS.md). Solo lo llama el panel por la red
 * interna: el proxy del servidor no deja salir esta ruta a internet. Solo el
 * administrador; la clínica y quién lo pidió salen del TOKEN, y la persona se busca
 * DENTRO de esa clínica.
 */
@Controller('emergency-alerts')
@UseGuards(RolesGuard)
export class EmergencyAlertsController {
  constructor(private readonly alertas: AlertaEmergenciaService) {}

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
