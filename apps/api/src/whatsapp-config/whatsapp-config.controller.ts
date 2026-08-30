import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappTemplateService } from './whatsapp-template.service';
import type { WhatsappTemplateKind } from '@agenia/database';
import type { SaveWhatsappConfigInput } from './dto/whatsapp-config.types';

@Controller('whatsapp-config')
@UseGuards(RolesGuard)
export class WhatsappConfigController {
  constructor(
    private readonly whatsapp: WhatsappConfigService,
    private readonly templates: WhatsappTemplateService,
  ) {}

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

  // ── Plantillas aprobadas (envíos fuera de la ventana de 24 h) ───────────
  //
  // El tenant sale SIEMPRE del token (@CurrentTenant), nunca del body ni de la
  // ruta: así una clínica no puede leer ni tocar las plantillas de otra.

  @Get('templates')
  @Roles('ORG_ADMIN')
  async listTemplates(@CurrentTenant() organizationId: string) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.templates.listForOrg(organizationId);
  }

  @Post('templates')
  @Roles('ORG_ADMIN')
  async upsertTemplate(
    @CurrentTenant() organizationId: string,
    @Body()
    body: {
      kind: WhatsappTemplateKind;
      name: string;
      language?: string;
      requestsContactInfo?: boolean;
      isActive?: boolean;
    },
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.templates.upsertForOrg(organizationId, body);
  }

  @Delete('templates/:kind')
  @Roles('ORG_ADMIN')
  async removeTemplate(
    @CurrentTenant() organizationId: string,
    @Param('kind') kind: WhatsappTemplateKind,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.templates.removeForOrg(organizationId, kind);
  }
}
