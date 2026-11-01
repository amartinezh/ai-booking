import { Module } from '@nestjs/common';
import { ResumenDocumentosService } from './resumen-documentos.service';
import { ResumenEnlacesService } from './resumen-enlaces.service';
import {
  ResumenDocumentosController,
  ResumenPublicoController,
} from './resumen-documentos.controller';

/**
 * 🩺 Resumen de la atención, Fase 2 (docs/PLAN_RESUMEN_ATENCION.md §3.5 y
 * §3.9): los documentos en PDF e imagen y la página del paciente. La lectura
 * del HIS (Fase 1) vive en `mirror/`. Prisma, el cifrado y la bitácora del
 * sistema son módulos globales.
 */
@Module({
  controllers: [ResumenDocumentosController, ResumenPublicoController],
  providers: [ResumenDocumentosService, ResumenEnlacesService],
})
export class AttentionSummaryModule {}
