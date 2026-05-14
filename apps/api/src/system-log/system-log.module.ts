import { Global, Module } from '@nestjs/common';
import { SystemLogService } from './system-log.service';
import { SystemLogController } from './system-log.controller';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Módulo de auditoría centralizada. Es @Global para que cualquier otro
 * módulo pueda inyectar SystemLogService sin importarlo explícitamente.
 *
 * PrismaModule también es global → no requiere import aquí.
 */
@Global()
@Module({
  providers: [SystemLogService, GlobalExceptionFilter],
  controllers: [SystemLogController],
  exports: [SystemLogService, GlobalExceptionFilter],
})
export class SystemLogModule {}
