import { Module } from '@nestjs/common';
import { ClinicalAiService } from './clinical-ai.service';
import { ClinicalAiController } from './clinical-ai.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [ClinicalAiController],
  providers: [ClinicalAiService],
  exports: [ClinicalAiService],
})
export class ClinicalAiModule {}
