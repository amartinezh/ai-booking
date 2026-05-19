import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { WhatsappConfigService } from './whatsapp-config.service';
import type { SaveWhatsappConfigInput } from './dto/whatsapp-config.types';

@Controller('whatsapp-config')
@UseGuards(RolesGuard)
export class WhatsappConfigController {
  constructor(private readonly whatsapp: WhatsappConfigService) {}

  @Get()
  @Roles('ORG_ADMIN')
  async getMine(@CurrentTenant() organizationId: string) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.whatsapp.getPublic(organizationId);
  }

  @Post()
  @Roles('ORG_ADMIN')
  async upsertMine(
    @CurrentTenant() organizationId: string,
    @Body() body: SaveWhatsappConfigInput,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.whatsapp.upsert(organizationId, body);
  }
}
