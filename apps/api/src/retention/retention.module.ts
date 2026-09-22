import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

/**
 * 🧹 Retención de datos personales (docs/PLAN_RASTREO_PACIENTE.md §12 #4).
 * PrismaModule y SystemLogModule son globales: no hace falta importarlos.
 */
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
