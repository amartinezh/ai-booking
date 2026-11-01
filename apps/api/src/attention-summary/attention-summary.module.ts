import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { ResumenDocumentosService } from './resumen-documentos.service';
import { ResumenEnlacesService } from './resumen-enlaces.service';
import { ResumenEnvioService } from './resumen-envio.service';
import { ResumenChatService } from './resumen-chat.service';
import { ResumenWhatsappService } from './resumen-whatsapp.service';
import {
  ResumenDocumentosController,
  ResumenPublicoController,
} from './resumen-documentos.controller';

/**
 * 🩺 Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md): los documentos en
 * PDF e imagen y la página del paciente (Fase 2), y el envío por WhatsApp
 * (Fase 4): el programador del aviso y lo que pasa en el chat al tocar el
 * botón. La lectura del HIS (Fase 1) vive en `mirror/`. Prisma, el cifrado,
 * Redis y la bitácora del sistema son módulos globales.
 *
 * Exporta `ResumenChatService` para el asistente (ChatbotModule), que le pasa
 * el toque del botón y los textos antes de su flujo. Este módulo no importa al
 * asistente: no hay ciclo.
 */
@Module({
  imports: [HttpModule, WhatsappConfigModule],
  controllers: [ResumenDocumentosController, ResumenPublicoController],
  providers: [
    ResumenDocumentosService,
    ResumenEnlacesService,
    ResumenWhatsappService,
    ResumenEnvioService,
    ResumenChatService,
  ],
  exports: [ResumenChatService],
})
export class AttentionSummaryModule {}
