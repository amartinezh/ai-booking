import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { MedicosNuevosService } from './medicos-nuevos.service';

/**
 * 🩺 El botón «Crear y homologar» de la Bandeja (2026-10-24).
 *
 * Fuera de `/mirror` a propósito: el proxy del servidor deja salir a internet
 * `/api/mirror*` (es del agente); esto solo lo llama el panel por la red interna.
 * Solo el administrador de la clínica; la clínica y quién lo hizo salen del TOKEN.
 */
@Controller('his-doctors')
@UseGuards(RolesGuard)
export class MedicosNuevosController {
  constructor(private readonly medicosNuevos: MedicosNuevosService) {}

  @Post('onboard')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN')
  async onboard(
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { externalKey?: unknown; whatsappOn?: unknown },
  ): Promise<
    | { success: true; accion: 'CREAR' | 'ENLAZAR'; nombre: string }
    | { success: false; error: string }
  > {
    const externalKey =
      typeof body?.externalKey === 'string' ? body.externalKey.trim() : '';
    if (!externalKey || externalKey.length > 40) {
      return {
        success: false,
        error: 'Falta el código del médico en el hospital.',
      };
    }
    const r = await this.medicosNuevos.homologar(organizationId, externalKey, {
      // Lo que no sea exactamente `true` entra apagado: nada le sale al paciente.
      whatsappOn: body?.whatsappOn === true,
      actor: user?.email ?? user?.userId ?? 'un administrador',
      via: 'BANDEJA',
    });
    return r.ok
      ? { success: true, accion: r.accion, nombre: r.nombre }
      : { success: false, error: r.motivo };
  }
}
