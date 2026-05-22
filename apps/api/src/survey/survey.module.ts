import { Module } from '@nestjs/common';
import { SurveyService } from './survey.service';
import { SurveyController } from './survey.controller';
import {
  ClinicSurveyController,
  SuperadminSurveyController,
} from './survey-admin.controller';

/**
 * Módulo de Encuestas de Satisfacción (CSAT) post-chat.
 *
 * PrismaModule es global (declarado en app.module.ts), por eso no se importa
 * explícitamente. SurveyService se exporta para que ChatbotModule pueda
 * generar tokens al cerrar cada flujo conversacional.
 */
@Module({
  controllers: [
    SurveyController,
    SuperadminSurveyController,
    ClinicSurveyController,
  ],
  providers: [SurveyService],
  exports: [SurveyService],
})
export class SurveyModule {}
