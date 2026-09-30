import { Module } from '@nestjs/common';
import { InteractionLogService } from './interaction-log.service';
import { ChannelActivityService } from './channel-activity.service';

/**
 * Módulo de auditoría.
 *
 * Nota: PrismaModule es global (declarado en app.module.ts), por eso
 * NO se importa explícitamente acá. NestJS lo provee automáticamente.
 */
@Module({
  providers: [InteractionLogService, ChannelActivityService],
  exports: [InteractionLogService, ChannelActivityService],
})
export class InteractionLogModule {}
