import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LlmModule } from '../llm/llm.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Diagnóstico de conectividad de integraciones (Gemini + Meta).
 *
 * Reutiliza `LlmModule` (LlmFactoryService) y `WhatsappConfigModule`
 * (WhatsappCredentialsService) para resolver credenciales cifradas por
 * organización, y `HttpModule` para el GET de verificación a la Graph API.
 */
@Module({
  imports: [HttpModule, LlmModule, WhatsappConfigModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  // Exportado para que MonitorModule reutilice la lógica de diagnóstico
  // (Gemini + Meta) sin recrearla.
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
