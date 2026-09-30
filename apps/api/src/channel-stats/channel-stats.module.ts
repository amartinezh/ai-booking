import { Module } from '@nestjs/common';
import { ChannelStatsController } from './channel-stats.controller';
import { ChannelStatsService } from './channel-stats.service';

/** 📈 «Canales en vivo». `PrismaModule` es global, no se importa aquí. */
@Module({
  controllers: [ChannelStatsController],
  providers: [ChannelStatsService],
})
export class ChannelStatsModule {}
