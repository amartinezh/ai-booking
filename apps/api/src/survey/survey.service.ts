import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GenerateSurveyInput,
  SubmitSurveyInput,
  SurveyPublicView,
} from './dto/survey.types';

// Ventana de validez del enlace de un solo uso.
const SURVEY_TTL_HOURS = 24;
// Tope de caracteres del comentario libre, defensa básica anti-abuso.
const MAX_FEEDBACK_LENGTH = 2000;

@Injectable()
export class SurveyService {
  private readonly logger = new Logger(SurveyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════════
  // GENERACIÓN DEL TOKEN (lo llama el ChatbotService al cerrar un flujo)
  // Inserta el registro y devuelve el UUID que ES el token del enlace.
  // ══════════════════════════════════════════════════════════════
  async generateSurveyToken(input: GenerateSurveyInput): Promise<string> {
    const expiresAt = new Date(Date.now() + SURVEY_TTL_HOURS * 60 * 60 * 1000);

    const survey = await this.prisma.chatSurvey.create({
      data: {
        patientId: input.patientId ?? null,
        organizationId: input.organizationId,
        resolutionStatus: input.resolutionStatus,
        chatSummary: input.chatSummary?.slice(0, MAX_FEEDBACK_LENGTH) ?? null,
        expiresAt,
      },
      select: { id: true },
    });

    return survey.id;
  }

  // ══════════════════════════════════════════════════════════════
  // LECTURA SEGURA PARA EL GATE (token válido = existe + !isUsed + !expirado)
  // Devuelve null si el token no debe permitir el acceso. Sin lanzar: el
  // frontend traduce null → redirect('/').
  // ══════════════════════════════════════════════════════════════
  async getValidSurvey(id: string): Promise<SurveyPublicView | null> {
    if (!id) return null;

    const survey = await this.prisma.chatSurvey.findUnique({
      where: { id },
      select: {
        id: true,
        isUsed: true,
        expiresAt: true,
        resolutionStatus: true,
        chatSummary: true,
        organization: { select: { name: true } },
      },
    });

    if (!survey) return null;
    if (survey.isUsed) return null;
    if (survey.expiresAt.getTime() <= Date.now()) return null;

    return {
      id: survey.id,
      resolutionStatus: survey.resolutionStatus,
      chatSummary: survey.chatSummary,
      organizationName: survey.organization?.name ?? 'la clínica',
    };
  }

  // ══════════════════════════════════════════════════════════════
  // ENVÍO DE LA CALIFICACIÓN — REGLA DE ORO
  // Sólo persiste si isUsed == false && expiresAt > now(). Marca isUsed = true
  // de forma atómica (updateMany con guardas en el WHERE) para que un doble
  // submit concurrente no pueda escribir dos veces.
  // ══════════════════════════════════════════════════════════════
  async submitSurvey(id: string, input: SubmitSurveyInput): Promise<{ success: true }> {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('La calificación debe ser un entero entre 1 y 5.');
    }

    const feedback =
      typeof input.feedback === 'string' && input.feedback.trim().length > 0
        ? input.feedback.trim().slice(0, MAX_FEEDBACK_LENGTH)
        : null;

    // Update atómico condicionado: el WHERE re-verifica la regla de oro.
    const result = await this.prisma.chatSurvey.updateMany({
      where: {
        id,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      data: {
        rating,
        feedback,
        isUsed: true,
      },
    });

    // count === 0 → o no existe, o ya se usó, o expiró. No filtramos cuál.
    if (result.count === 0) {
      throw new NotFoundException('El enlace de la encuesta es inválido, ya se usó o expiró.');
    }

    this.logger.log(`Encuesta ${id} calificada con ${rating}/5.`);
    return { success: true };
  }
}
