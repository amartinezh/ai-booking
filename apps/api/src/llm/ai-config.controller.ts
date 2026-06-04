import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LlmProvider } from '@agenia/database';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { AiConfigService } from './ai-config.service';
import type { SaveAiConfigInput } from './dto/ai-config.types';
import { PROVIDER_MODELS } from './interfaces/llm-provider.interface';

const VALID_PROVIDERS: LlmProvider[] = ['GEMINI', 'CHATGPT', 'CLAUDE', 'NONE'];

@Controller('ai-config')
@UseGuards(RolesGuard)
export class AiConfigController {
  constructor(private readonly aiConfig: AiConfigService) {}

  /** Lista de modelos disponibles por proveedor — usado por la UI. */
  @Get('catalog')
  @Roles('ORG_ADMIN', 'SUPER_ADMIN')
  catalog() {
    return { providers: PROVIDER_MODELS };
  }

  @Get()
  @Roles('ORG_ADMIN')
  async getMine(@CurrentTenant() organizationId: string) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.aiConfig.getPublic(organizationId);
  }

  @Post()
  @Roles('ORG_ADMIN')
  async upsertMine(
    @CurrentTenant() organizationId: string,
    @Body() body: SaveAiConfigInput,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    this.validate(body);
    return this.aiConfig.upsert(organizationId, body);
  }

  private validate(body: SaveAiConfigInput) {
    if (!body || !VALID_PROVIDERS.includes(body.activeProvider)) {
      throw new BadRequestException('activeProvider inválido.');
    }
  }
}
