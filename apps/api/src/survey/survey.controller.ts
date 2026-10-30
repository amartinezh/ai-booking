import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { SurveyService } from './survey.service';
import type { SubmitSurveyInput, SurveyPublicView } from './dto/survey.types';

// ⚠️ Endpoints PÚBLICOS a propósito: el paciente abre el enlace desde WhatsApp
// sin sesión. La seguridad NO está en un guard de rol sino en el token de un
// solo uso (el UUID) + la regla de oro (isUsed/expiresAt) que valida el service.
@Controller('surveys')
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  // GET /surveys/:id → valida el token para el gate del frontend.
  // Si el token no es válido (no existe / usado / expirado) responde 404,
  // que el frontend traduce a redirect('/').
  @Get(':id')
  async getSurvey(@Param('id') id: string): Promise<SurveyPublicView> {
    const survey = await this.surveyService.getValidSurvey(id);
    if (!survey) {
      throw new NotFoundException('Encuesta no disponible.');
    }
    return survey;
  }

  // POST /surveys/:id/rating → paso 1: guarda solo la estrella, sin cerrar la
  // encuesta. Regla de oro dentro del service.
  @Post(':id/rating')
  @HttpCode(HttpStatus.OK)
  async saveRating(
    @Param('id') id: string,
    @Body() body: { rating?: unknown },
  ): Promise<{ success: true }> {
    return this.surveyService.saveRating(id, body?.rating);
  }

  // POST /surveys/:id → paso 2: el envío completo. Regla de oro dentro del service.
  @Post(':id')
  @HttpCode(HttpStatus.OK)
  async submitSurvey(
    @Param('id') id: string,
    @Body() body: SubmitSurveyInput,
  ): Promise<{ success: true }> {
    return this.surveyService.submitSurvey(id, body);
  }
}
