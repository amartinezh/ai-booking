import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { TelegramConfigService } from './telegram-config.service';
import type { SaveTelegramConfigInput } from './telegram.types';

/**
 * Canal de Telegram desde el panel (Configuración → Integraciones).
 *
 * El tenant sale SIEMPRE del token (@CurrentTenant), nunca del body ni de la
 * ruta: una clínica no puede ver ni tocar el bot de otra.
 */
@Controller('telegram-config')
@UseGuards(RolesGuard)
export class TelegramConfigController {
  constructor(private readonly telegram: TelegramConfigService) {}

  @Get()
  @Roles('ORG_ADMIN')
  async getMine(@CurrentTenant() organizationId: string) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.telegram.getPublic(organizationId);
  }

  /** Conecta con el token de BotFather (o reconecta con uno nuevo). */
  @Post()
  @Roles('ORG_ADMIN')
  async connect(
    @CurrentTenant() organizationId: string,
    @Body() body: SaveTelegramConfigInput,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.telegram.connect(organizationId, body?.botToken);
  }

  @Post('verify')
  @Roles('ORG_ADMIN')
  async verify(@CurrentTenant() organizationId: string) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.telegram.verify(organizationId);
  }

  @Delete()
  @Roles('ORG_ADMIN')
  async disconnect(@CurrentTenant() organizationId: string) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.telegram.disconnect(organizationId);
  }
}
