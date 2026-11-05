import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { MassMessageAiService } from './mass-message-ai.service';
import { MassMessageMetaService } from './mass-message-meta.service';
import { MassMessageOptOutService } from './mass-message-opt-out.service';
import { MassMessageSenderService } from './mass-message-sender.service';
import { MassMessageController } from './mass-message.controller';

/**
 * 📢 Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md): comunicados de la clínica
 * por WhatsApp, para todas las clínicas. Aparte de `MassNoticeModule` (los avisos
 * del hospital de Anserma), que no se toca.
 *
 * Exporta `MassMessageOptOutService` para el asistente («no más comunicados»).
 * No importa `ChatbotModule`: el asistente importa este módulo, no al revés.
 * `PrismaModule` y `SystemLogModule` son globales.
 */
@Module({
  imports: [LlmModule, WhatsappConfigModule],
  controllers: [MassMessageController],
  providers: [
    MassMessageAiService,
    MassMessageMetaService,
    MassMessageSenderService,
    MassMessageOptOutService,
  ],
  exports: [MassMessageOptOutService],
})
export class MassMessageModule {}
