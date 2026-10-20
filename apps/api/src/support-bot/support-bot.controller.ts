import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import {
  CurrentUser,
  type JwtUserPayload,
} from '../common/current-user.decorator';
import { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotSessionService } from './support-bot-session.service';
import { SupportBotService } from './support-bot.service';
import type {
  SupportBotActor,
  SupportBotSettingsInput,
} from './support-bot.types';

/**
 * La tarjeta «Asistente de soporte en Telegram» de Soporte
 * (docs/PLAN_BOT_SOPORTE.md §3.1): el personal de la clínica genera aquí el
 * código de CADA conversación, ve la que tiene abierta, la cierra y decide si
 * quiere los avisos de sus casos. El paciente no (S2). Todo sale del token:
 * nadie puede pedir el código de otro.
 */
@Controller('support-bot/me')
@UseGuards(RolesGuard)
@Roles('ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER')
export class SupportBotPanelController {
  constructor(
    private readonly sesiones: SupportBotSessionService,
    private readonly bot: SupportBotService,
  ) {}

  @Get()
  estado(@CurrentUser() user: JwtUserPayload) {
    return this.sesiones.estadoPara(user.userId);
  }

  @Post('code')
  codigo(@CurrentUser() user: JwtUserPayload) {
    return this.sesiones.generarCodigo(user.userId);
  }

  @Post('close')
  async cerrar(@CurrentUser() user: JwtUserPayload) {
    const chat = await this.sesiones.cerrarDesdePanel(user.userId);
    if (chat) await this.bot.avisarCierreDesdePanel(chat);
    return this.sesiones.estadoPara(user.userId);
  }

  @Put('notices')
  async avisos(
    @Body() body: { activos?: unknown },
    @CurrentUser() user: JwtUserPayload,
  ) {
    if (typeof body?.activos !== 'boolean') {
      throw new BadRequestException('«activos» debe ser verdadero o falso.');
    }
    await this.sesiones.cambiarAvisos(user.userId, body.activos);
    return this.sesiones.estadoPara(user.userId);
  }
}

/**
 * La configuración del asistente (§3.7). TODO el controlador es SUPER_ADMIN; la
 * ruta no está en la lista blanca del proxy: solo la alcanza el panel por la red
 * interna. El actor de la auditoría sale SIEMPRE del token.
 */
@Controller('support-bot/admin')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class SupportBotAdminController {
  constructor(
    private readonly config: SupportBotConfigService,
    private readonly sesiones: SupportBotSessionService,
  ) {}

  @Get('config')
  getConfig() {
    return this.config.getPublic();
  }

  @Put('config')
  updateConfig(
    @Body() body: SupportBotSettingsInput,
    @CurrentUser() user: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.config.updateSettings(body ?? {}, actorDe(user, req));
  }

  @Post('connect')
  connect(
    @Body() body: { botToken?: unknown },
    @CurrentUser() user: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.config.connect(body?.botToken, actorDe(user, req));
  }

  @Delete('connect')
  disconnect(@CurrentUser() user: JwtUserPayload, @Req() req: Request) {
    return this.config.disconnect(actorDe(user, req));
  }

  /** Código del super admin para probar el asistente como una clínica (modo prueba). */
  @Post('test-code')
  codigoDePrueba(
    @Body() body: { organizationId?: unknown },
    @CurrentUser() user: JwtUserPayload,
  ) {
    if (typeof body?.organizationId !== 'string' || !body.organizationId) {
      throw new BadRequestException(
        'Elija la clínica con la que quiere probar.',
      );
    }
    return this.sesiones.generarCodigo(user.userId, {
      testOrganizationId: body.organizationId,
    });
  }
}

function actorDe(user: JwtUserPayload, req: Request): SupportBotActor {
  return { userId: user.userId, email: user.email ?? null, ip: req.ip ?? null };
}
