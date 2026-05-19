import { Module } from '@nestjs/common';
import { GlobalStatsController } from './global-stats.controller';
import { GlobalStatsService } from './global-stats.service';

@Module({
  controllers: [GlobalStatsController],
  providers: [GlobalStatsService],
})
export class GlobalStatsModule {}
