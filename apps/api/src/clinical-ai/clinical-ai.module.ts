import { Module } from '@nestjs/common';
import { ClinicalAiService } from './clinical-ai.service';
import { ClinicalAiController } from './clinical-ai.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [ClinicalAiController],
  providers: [ClinicalAiService],
  exports: [ClinicalAiService],
})
export class ClinicalAiModule {}
