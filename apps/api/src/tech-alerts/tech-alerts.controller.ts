import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
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
import { TechAlertConfigService } from './tech-alert-config.service';
import { TechAlertService } from './tech-alert.service';
import type {
  TechAlertActor,
  TechAlertSettingsInput,
} from './tech-alerts.types';

/**
 * 🚨 Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md §3.8).
 *
 * TODO el controlador es SUPER_ADMIN: es el canal con el equipo técnico, no de
 * ninguna clínica. Un ORG_ADMIN recibe 403 en cada ruta. La ruta no está en la
 * lista blanca del proxy: solo la alcanza el panel por la red interna.
 *
 * El actor de la auditoría sale SIEMPRE del token, nunca del body.
 */
@Controller('tech-alerts')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class TechAlertsController {
  constructor(
    private readonly config: TechAlertConfigService,
    private readonly alerts: TechAlertService,
  ) {}

  @Get('config')
  getConfig() {
    return this.config.getPublic();
  }

  @Put('config')
  updateConfig(
    @Body() body: TechAlertSettingsInput,
    @CurrentUser() user: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.config.updateSettings(body ?? {}, actorDe(user, req));
  }

  /** Conecta el bot con su token de BotFather (o lo renueva). */
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

  /** Genera el código de vinculación del grupo. */
  @Post('link')
  startLink(@CurrentUser() user: JwtUserPayload, @Req() req: Request) {
    return this.config.startLink(actorDe(user, req));
  }

  /** «Buscar el grupo»: lee el bot una vez y vincula el grupo que escribió el código. */
  @Post('link/find')
  findLink(@CurrentUser() user: JwtUserPayload, @Req() req: Request) {
    return this.config.findLink(actorDe(user, req));
  }

  @Post('test')
  test() {
    return this.config.sendTest();
  }

  @Post('mute')
  mute(
    @Body() body: { opcion?: unknown },
    @CurrentUser() user: JwtUserPayload,
    @Req() req: Request,
  ) {
    return this.config.mute(body?.opcion, actorDe(user, req));
  }

  @Delete('mute')
  unmute(@CurrentUser() user: JwtUserPayload, @Req() req: Request) {
    return this.config.unmute(actorDe(user, req));
  }

  /** La bitácora. */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.alerts.listar({
      status,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
      offset: offset ? parseInt(offset, 10) || undefined : undefined,
    });
  }
}

function actorDe(
  user: JwtUserPayload | undefined,
  req: Request,
): TechAlertActor {
  const reenviada = req.headers?.['x-forwarded-for'];
  const ip =
    (Array.isArray(reenviada) ? reenviada[0] : reenviada)
      ?.split(',')[0]
      ?.trim() ||
    req.ip ||
    null;
  return { userId: user?.userId ?? null, email: user?.email ?? null, ip };
}
