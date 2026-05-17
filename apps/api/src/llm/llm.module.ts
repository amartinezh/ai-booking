import { Module } from '@nestjs/common';
import { LlmFactoryService } from './llm-factory.service';
import { AiConfigService } from './ai-config.service';
import { AiConfigController } from './ai-config.controller';

@Module({
  controllers: [AiConfigController],
  providers: [LlmFactoryService, AiConfigService],
  exports: [LlmFactoryService, AiConfigService],
})
export class LlmModule {}
