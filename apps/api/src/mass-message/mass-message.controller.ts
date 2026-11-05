import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  proximaVentanaDeComunicados,
  puedeEnviarComunicadoAhora,
} from '@agenia/shared';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import {
  CurrentUser,
  type JwtUserPayload,
} from '../common/current-user.decorator';
import { MassMessageAiService } from './mass-message-ai.service';
import { MassMessageMetaService } from './mass-message-meta.service';
import { MassMessageSenderService } from './mass-message-sender.service';

/**
 * 📢 Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md). Solo ORG_ADMIN.
 *
 * Armar las listas, guardar el borrador y subir la imagen pasan por server
 * actions de `apps/web` (Prisma directo, como el padrón). Aquí vive lo que
 * necesita las credenciales de WhatsApp o de la IA de la clínica: verificar la
 * plantilla con Meta, las revisiones con IA, la prueba, confirmar el envío y
 * controlarlo. El envío mismo lo hace la vuelta de `MassMessageSenderService`.
 */
@Controller('mass-messages')
@UseGuards(RolesGuard)
@Roles('ORG_ADMIN')
export class MassMessageController {
  constructor(
    private readonly ai: MassMessageAiService,
    private readonly meta: MassMessageMetaService,
    private readonly sender: MassMessageSenderService,
  ) {}

  private org(organizationId: string | null | undefined): string {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return organizationId;
  }

  /** Lo que la pantalla muestra arriba: plantillas, número, IA y horario. */
  @Get('estado')
  async estado(@CurrentTenant() organizationId: string) {
    const org = this.org(organizationId);
    const ahora = new Date();
    const [texto, imagen, numero, ia] = await Promise.all([
      this.meta.verificarPlantilla(org, 'MASS_MESSAGE_TEXT'),
      this.meta.verificarPlantilla(org, 'MASS_MESSAGE_IMAGE'),
      this.meta.estadoDelNumero(org),
      this.ai.disponible(org),
    ]);
    return {
      plantillas: { texto, imagen },
      numero,
      ia,
      horario: {
        abierto: puedeEnviarComunicadoAhora(ahora),
        proximaApertura: proximaVentanaDeComunicados(ahora).toISOString(),
      },
    };
  }

  @Post('contactos/mapeo-ia')
  @HttpCode(HttpStatus.OK)
  mapeoIa(
    @CurrentTenant() organizationId: string,
    @Body() body: { encabezados?: string[]; filas?: string[][] },
  ) {
    return this.ai.mapearColumnas(this.org(organizationId), {
      encabezados: Array.isArray(body?.encabezados) ? body.encabezados : [],
      filas: Array.isArray(body?.filas) ? body.filas : [],
    });
  }

  @Post('texto/revision-ia')
  @HttpCode(HttpStatus.OK)
  revisionTexto(
    @CurrentTenant() organizationId: string,
    @Body() body: { texto?: string },
  ) {
    return this.ai.revisarTexto(
      this.org(organizationId),
      String(body?.texto ?? ''),
    );
  }

  @Post('envios/:id/imagen/revision-ia')
  @HttpCode(HttpStatus.OK)
  revisionImagen(
    @CurrentTenant() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.ai.revisarImagen(this.org(organizationId), id);
  }

  @Get('envios/:id/previa')
  previa(@CurrentTenant() organizationId: string, @Param('id') id: string) {
    return this.sender.previa(this.org(organizationId), id);
  }

  @Post('envios/:id/prueba')
  @HttpCode(HttpStatus.OK)
  prueba(
    @CurrentTenant() organizationId: string,
    @Param('id') id: string,
    @Body() body: { telefono?: string; nombre?: string },
  ) {
    return this.sender.enviarPrueba(
      this.org(organizationId),
      id,
      String(body?.telefono ?? ''),
      body?.nombre ?? null,
    );
  }

  @Post('envios/:id/iniciar')
  @HttpCode(HttpStatus.OK)
  iniciar(
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { confirmacion?: number },
  ) {
    return this.sender.iniciar(
      this.org(organizationId),
      id,
      { userId: user.userId, email: user.email },
      Number(body?.confirmacion),
    );
  }

  @Post('envios/:id/pausar')
  @HttpCode(HttpStatus.OK)
  async pausar(
    @CurrentTenant() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.sender.pausar(this.org(organizationId), id);
    return { ok: true };
  }

  @Post('envios/:id/reanudar')
  @HttpCode(HttpStatus.OK)
  async reanudar(
    @CurrentTenant() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.sender.reanudar(this.org(organizationId), id);
    return { ok: true };
  }

  @Post('envios/:id/cancelar')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @CurrentTenant() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.sender.cancelar(this.org(organizationId), id);
    return { ok: true };
  }

  @Post('envios/:id/reintentar')
  @HttpCode(HttpStatus.OK)
  reintentar(@CurrentTenant() organizationId: string, @Param('id') id: string) {
    return this.sender.reintentarFallidos(this.org(organizationId), id);
  }
}
