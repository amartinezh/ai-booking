import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { IntegrationsService } from './integrations.service';
import type {
  GeminiDiagnosisResult,
  LlmDiagnosisResult,
  MetaDiagnosisResult,
} from './dto/diagnostics.types';

/**
 * Herramientas de diagnóstico en tiempo real de las integraciones externas
 * de la clínica (Gemini y Meta). Todos los endpoints son ORG_ADMIN y operan
 * estrictamente sobre el `organizationId` del token — nunca aceptan
 * credenciales por parámetro.
 */
@Controller('integrations')
@UseGuards(RolesGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('diagnose/gemini')
  @Roles('ORG_ADMIN')
  async diagnoseGemini(
    @CurrentTenant() organizationId: string,
  ): Promise<GeminiDiagnosisResult> {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.integrations.diagnoseGemini(organizationId);
  }

  /**
   * Diagnóstico genérico del proveedor de IA activo (Gemini / OpenAI / Claude).
   * El nuevo "Probar Servicio" del dashboard pega aquí; la respuesta incluye
   * provider+model para que la UI muestre qué servicio se probó realmente.
   */
  @Get('diagnose/llm')
  @Roles('ORG_ADMIN')
  async diagnoseLlm(
    @CurrentTenant() organizationId: string,
  ): Promise<LlmDiagnosisResult> {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.integrations.diagnoseLlm(organizationId);
  }

  @Get('diagnose/meta')
  @Roles('ORG_ADMIN')
  async diagnoseMeta(
    @CurrentTenant() organizationId: string,
  ): Promise<MetaDiagnosisResult> {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.integrations.diagnoseMeta(organizationId);
  }
}
