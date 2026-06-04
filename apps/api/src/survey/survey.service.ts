import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';
import {
  GenerateSurveyInput,
  SubmitSurveyInput,
  SurveyPublicView,
} from './dto/survey.types';
import {
  computeUserMood,
  DetailedSurveyQuery,
  DetailedSurveyRow,
  LimitedSurveyQuery,
  LimitedSurveyRow,
  moodToRatingWhere,
  PaginatedSurveys,
} from './dto/survey-report.types';

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
  async submitSurvey(
    id: string,
    input: SubmitSurveyInput,
  ): Promise<{ success: true }> {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException(
        'La calificación debe ser un entero entre 1 y 5.',
      );
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
      throw new NotFoundException(
        'El enlace de la encuesta es inválido, ya se usó o expiró.',
      );
    }

    this.logger.log(`Encuesta ${id} calificada con ${rating}/5.`);
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  // REPORTE SUPER ADMIN — detalle global (paginado + ordenado + filtros)
  // Trae el 100% del detalle con joins a Paciente y Organización.
  // NUNCA devuelve todos los registros crudos: take/skip obligatorios.
  // ══════════════════════════════════════════════════════════════
  async findDetailedForSuperAdmin(
    query: DetailedSurveyQuery,
  ): Promise<PaginatedSurveys<DetailedSurveyRow>> {
    const { page, pageSize, skip } = this.normalizePagination(
      query.page,
      query.pageSize,
    );

    const where: Prisma.ChatSurveyWhereInput = {
      ...this.buildDateRange(query.startDate, query.endDate),
    };
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.resolutionStatus) where.resolutionStatus = query.resolutionStatus;
    if (query.mood) where.rating = moodToRatingWhere(query.mood);

    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chatSurvey.count({ where }),
      this.prisma.chatSurvey.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          rating: true,
          feedback: true,
          chatSummary: true,
          resolutionStatus: true,
          isUsed: true,
          patient: {
            select: {
              id: true,
              fullName: true,
              whatsappId: true,
              cedula: true,
            },
          },
          organization: { select: { id: true, name: true } },
        },
      }),
    ]);

    return this.paginate(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        rating: r.rating,
        userMood: computeUserMood(r.rating),
        feedback: r.feedback,
        chatSummary: r.chatSummary,
        resolutionStatus: r.resolutionStatus,
        isUsed: r.isUsed,
        patient: r.patient
          ? {
              id: r.patient.id,
              fullName: r.patient.fullName,
              whatsappId: r.patient.whatsappId,
              cedula: r.patient.cedula,
            }
          : null,
        organization: { id: r.organization.id, name: r.organization.name },
      })),
      total,
      page,
      pageSize,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // REPORTE CLINIC ADMIN — payload minimalista, SCOPED a una clínica
  // Sólo nombre, teléfono, calificación, mensaje y ánimo. Oculta campos
  // internos (chatSummary, expiresAt, ids, etc.). El scoping por orgId lo
  // garantiza el controller (token === :orgId); aquí lo reforzamos en el WHERE.
  // ══════════════════════════════════════════════════════════════
  async findLimitedForClinic(
    organizationId: string,
    query: LimitedSurveyQuery,
  ): Promise<PaginatedSurveys<LimitedSurveyRow>> {
    const { page, pageSize, skip } = this.normalizePagination(
      query.page,
      query.pageSize,
    );

    const where: Prisma.ChatSurveyWhereInput = { organizationId };
    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chatSurvey.count({ where }),
      this.prisma.chatSurvey.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          rating: true,
          feedback: true,
          patient: { select: { fullName: true, whatsappId: true } },
        },
      }),
    ]);

    return this.paginate(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        patientName: r.patient?.fullName ?? 'Paciente anónimo',
        whatsappPhone: r.patient?.whatsappId ?? null,
        rating: r.rating,
        userMood: computeUserMood(r.rating),
        message: r.feedback,
      })),
      total,
      page,
      pageSize,
    );
  }

  // ── Helpers de consulta compartidos ──────────────────────────

  private normalizePagination(page?: number, pageSize?: number) {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeSize = Math.min(100, Math.max(5, Math.floor(pageSize || 25)));
    return {
      page: safePage,
      pageSize: safeSize,
      skip: (safePage - 1) * safeSize,
    };
  }

  // Allowlist de campos ordenables → evita inyección de columnas arbitrarias.
  private buildOrderBy(
    sortBy: string | undefined,
    sortDir: string | undefined,
  ): Prisma.ChatSurveyOrderByWithRelationInput {
    const dir: Prisma.SortOrder = sortDir === 'asc' ? 'asc' : 'desc';
    const field = sortBy === 'rating' ? 'rating' : 'createdAt';
    return { [field]: dir };
  }

  private buildDateRange(
    startDate?: string,
    endDate?: string,
  ): Prisma.ChatSurveyWhereInput {
    const range: Prisma.DateTimeFilter = {};
    if (startDate) {
      const d = new Date(startDate);
      if (!isNaN(d.getTime())) range.gte = d;
    }
    if (endDate) {
      const d = new Date(endDate);
      if (!isNaN(d.getTime())) {
        // Incluye todo el día final.
        d.setHours(23, 59, 59, 999);
        range.lte = d;
      }
    }
    return Object.keys(range).length > 0 ? { createdAt: range } : {};
  }

  private paginate<T>(
    rows: T[],
    total: number,
    page: number,
    pageSize: number,
  ): PaginatedSurveys<T> {
    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
