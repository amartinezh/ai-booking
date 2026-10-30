import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SurveyExperience } from '@agenia/database';
import { horaLocalAUtc } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  GenerateSurveyInput,
  SubmitSurveyInput,
  SurveyPublicView,
} from './dto/survey.types';
import {
  computeAnswerStatus,
  computeUserMood,
  DetailedSurveyQuery,
  DetailedSurveyRow,
  LimitedSurveyQuery,
  LimitedSurveyRow,
  moodToRatingWhere,
  PaginatedSurveys,
  SurveyExport,
  SurveyFilters,
  SurveyStats,
} from './dto/survey-report.types';
import { buildSurveyStats } from './survey-stats';

// Ventana de validez del enlace de un solo uso.
const SURVEY_TTL_HOURS = 24;
// Tope de caracteres del comentario libre, defensa básica anti-abuso.
const MAX_FEEDBACK_LENGTH = 2000;
// Tope del texto de búsqueda.
const MAX_SEARCH_LENGTH = 100;
// Tope de filas de una descarga.
export const SURVEY_EXPORT_LIMIT = 5000;
// Tope de encuestas que entran al cálculo de estadísticas (solo columnas
// pequeñas; muy por encima de lo que junta una clínica en un año).
const SURVEY_STATS_LIMIT = 50_000;

const EXPERIENCES = Object.values(SurveyExperience) as string[];

// Columnas de la fila de la clínica: sin chatSummary, cédula ni ids internos.
const LIMITED_SELECT = {
  id: true,
  createdAt: true,
  answeredAt: true,
  isUsed: true,
  expiresAt: true,
  rating: true,
  wouldRecommend: true,
  experience: true,
  feedback: true,
  resolutionStatus: true,
  patient: { select: { fullName: true, whatsappId: true } },
} satisfies Prisma.ChatSurveySelect;

const DETAILED_SELECT = {
  id: true,
  createdAt: true,
  answeredAt: true,
  isUsed: true,
  expiresAt: true,
  rating: true,
  wouldRecommend: true,
  experience: true,
  feedback: true,
  chatSummary: true,
  resolutionStatus: true,
  patient: {
    select: { id: true, fullName: true, whatsappId: true, cedula: true },
  },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.ChatSurveySelect;

type LimitedRecord = Prisma.ChatSurveyGetPayload<{
  select: typeof LIMITED_SELECT;
}>;
type DetailedRecord = Prisma.ChatSurveyGetPayload<{
  select: typeof DETAILED_SELECT;
}>;

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
      organizationName: survey.organization?.name ?? 'el hospital',
    };
  }

  // ══════════════════════════════════════════════════════════════
  // PASO 1 — LA ESTRELLA SE GUARDA SOLA, al tocarla.
  // Es lo más fácil de responder y va primero: si el paciente se va sin
  // contestar lo demás, su calificación del asistente queda. NO cierra la
  // encuesta (isUsed sigue en false): mientras el enlace esté vigente puede
  // cambiar la estrella o completar el resto. Una encuesta ya enviada
  // completa no se puede reescribir (mismo WHERE de la regla de oro).
  // ══════════════════════════════════════════════════════════════
  async saveRating(id: string, rawRating: unknown): Promise<{ success: true }> {
    const rating = this.validRating(rawRating);
    const now = new Date();
    const result = await this.prisma.chatSurvey.updateMany({
      where: { id, isUsed: false, expiresAt: { gt: now } },
      data: { rating, answeredAt: now },
    });
    if (result.count === 0) {
      throw new NotFoundException(
        'El enlace de la encuesta es inválido, ya se usó o expiró.',
      );
    }
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  // PASO 2 — ENVÍO COMPLETO — REGLA DE ORO
  // Sólo persiste si isUsed == false && expiresAt > now(). Marca isUsed = true
  // de forma atómica (updateMany con guardas en el WHERE) para que un doble
  // submit concurrente no pueda escribir dos veces.
  // Exige las tres respuestas: estrellas del asistente (las reenvía el
  // formulario, ya guardadas en el paso 1), «¿Recomendaría la IPS?» y
  // «¿Cómo le fue?» (que tiene «No responde»).
  // ══════════════════════════════════════════════════════════════
  async submitSurvey(
    id: string,
    input: SubmitSurveyInput,
  ): Promise<{ success: true }> {
    const rating = this.validRating(input.rating);

    if (typeof input.wouldRecommend !== 'boolean') {
      throw new BadRequestException(
        'Falta la respuesta a «¿Recomendaría la IPS?» (sí o no).',
      );
    }

    if (
      typeof input.experience !== 'string' ||
      !EXPERIENCES.includes(input.experience)
    ) {
      throw new BadRequestException(
        'Falta la respuesta a «¿Cómo le fue en su experiencia?».',
      );
    }
    const experience = input.experience;

    const feedback =
      typeof input.feedback === 'string' && input.feedback.trim().length > 0
        ? input.feedback.trim().slice(0, MAX_FEEDBACK_LENGTH)
        : null;

    const now = new Date();
    // Update atómico condicionado: el WHERE re-verifica la regla de oro.
    const result = await this.prisma.chatSurvey.updateMany({
      where: {
        id,
        isUsed: false,
        expiresAt: { gt: now },
      },
      data: {
        rating,
        wouldRecommend: input.wouldRecommend,
        experience,
        feedback,
        answeredAt: now,
        isUsed: true,
      },
    });

    // count === 0 → o no existe, o ya se usó, o expiró. No filtramos cuál.
    if (result.count === 0) {
      throw new NotFoundException(
        'El enlace de la encuesta es inválido, ya se usó o expiró.',
      );
    }

    this.logger.log(
      `Encuesta ${id} respondida: ${rating}/5, recomendaría=${input.wouldRecommend ? 'sí' : 'no'}, experiencia=${experience}.`,
    );
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
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chatSurvey.count({ where }),
      this.prisma.chatSurvey.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: DETAILED_SELECT,
      }),
    ]);

    const now = new Date();
    return this.paginate(
      rows.map((r) => this.toDetailedRow(r, now)),
      total,
      page,
      pageSize,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // REPORTE CLINIC ADMIN — SCOPED a una clínica
  // Nombre, teléfono, respuestas, comentario y la gestión que cerró el chat.
  // Oculta chatSummary, cédula, expiresAt e ids internos. La búsqueda sí
  // encuentra por cédula (quien la escribe ya la tiene), pero no la devuelve.
  // El scoping por orgId lo garantiza el controller (token === :orgId); aquí
  // lo reforzamos en el WHERE.
  // ══════════════════════════════════════════════════════════════
  async findLimitedForClinic(
    organizationId: string,
    query: LimitedSurveyQuery,
  ): Promise<PaginatedSurveys<LimitedSurveyRow>> {
    const { page, pageSize, skip } = this.normalizePagination(
      query.page,
      query.pageSize,
    );
    const where = this.buildWhere({ ...query, organizationId });
    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chatSurvey.count({ where }),
      this.prisma.chatSurvey.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: LIMITED_SELECT,
      }),
    ]);

    const now = new Date();
    return this.paginate(
      rows.map((r) => this.toLimitedRow(r, now)),
      total,
      page,
      pageSize,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // DESCARGA — las filas filtradas, hasta SURVEY_EXPORT_LIMIT.
  // ══════════════════════════════════════════════════════════════
  async exportDetailedForSuperAdmin(
    query: DetailedSurveyQuery,
  ): Promise<SurveyExport<DetailedSurveyRow>> {
    const where = this.buildWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chatSurvey.count({ where }),
      this.prisma.chatSurvey.findMany({
        where,
        orderBy: this.buildOrderBy(query.sortBy, query.sortDir),
        take: SURVEY_EXPORT_LIMIT,
        select: DETAILED_SELECT,
      }),
    ]);
    const now = new Date();
    return {
      rows: rows.map((r) => this.toDetailedRow(r, now)),
      total,
      truncated: total > rows.length,
    };
  }

  async exportLimitedForClinic(
    organizationId: string,
    query: LimitedSurveyQuery,
  ): Promise<SurveyExport<LimitedSurveyRow>> {
    const where = this.buildWhere({ ...query, organizationId });
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chatSurvey.count({ where }),
      this.prisma.chatSurvey.findMany({
        where,
        orderBy: this.buildOrderBy(query.sortBy, query.sortDir),
        take: SURVEY_EXPORT_LIMIT,
        select: LIMITED_SELECT,
      }),
    ]);
    const now = new Date();
    return {
      rows: rows.map((r) => this.toLimitedRow(r, now)),
      total,
      truncated: total > rows.length,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // ESTADÍSTICAS — sobre las mismas encuestas que muestra la lista.
  // La vista de la clínica pasa SIEMPRE su organizationId.
  // ══════════════════════════════════════════════════════════════
  async getStats(
    filters: SurveyFilters,
    now: Date = new Date(),
  ): Promise<SurveyStats> {
    const where = this.buildWhere(filters, now);
    const [rows, comments, total] = await this.prisma.$transaction([
      this.prisma.chatSurvey.findMany({
        where,
        take: SURVEY_STATS_LIMIT,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          isUsed: true,
          expiresAt: true,
          rating: true,
          wouldRecommend: true,
          experience: true,
          resolutionStatus: true,
        },
      }),
      this.prisma.chatSurvey.count({
        where: { AND: [where, { feedback: { not: null } }] },
      }),
      this.prisma.chatSurvey.count({ where }),
    ]);

    return buildSurveyStats(rows, {
      comments,
      startDate: this.validDay(filters.startDate),
      endDate: this.validDay(filters.endDate),
      now,
      truncated: total > rows.length,
    });
  }

  /** Estrellas de 1 a 5, o 400. */
  private validRating(raw: unknown): number {
    const rating = Number(raw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException(
        'La calificación debe ser un entero entre 1 y 5.',
      );
    }
    return rating;
  }

  // ── Construcción de filas ────────────────────────────────────

  private toDetailedRow(r: DetailedRecord, now: Date): DetailedSurveyRow {
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      answeredAt: r.answeredAt?.toISOString() ?? null,
      status: computeAnswerStatus(r.isUsed, r.expiresAt, now, r.rating),
      rating: r.rating,
      userMood: computeUserMood(r.rating),
      wouldRecommend: r.wouldRecommend,
      experience: r.experience,
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
    };
  }

  private toLimitedRow(r: LimitedRecord, now: Date): LimitedSurveyRow {
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      answeredAt: r.answeredAt?.toISOString() ?? null,
      status: computeAnswerStatus(r.isUsed, r.expiresAt, now, r.rating),
      patientName: r.patient?.fullName ?? 'Paciente anónimo',
      whatsappPhone: r.patient?.whatsappId ?? null,
      rating: r.rating,
      userMood: computeUserMood(r.rating),
      wouldRecommend: r.wouldRecommend,
      experience: r.experience,
      message: r.feedback,
      resolutionStatus: r.resolutionStatus,
    };
  }

  // ── Helpers de consulta compartidos ──────────────────────────

  /**
   * WHERE de los filtros. Cada condición va en su propio elemento de `AND`
   * para que dos filtros sobre la misma columna (estrellas exactas y ánimo)
   * se sumen en lugar de pisarse.
   */
  private buildWhere(
    f: SurveyFilters,
    now: Date = new Date(),
  ): Prisma.ChatSurveyWhereInput {
    const and: Prisma.ChatSurveyWhereInput[] = [];

    if (f.organizationId) and.push({ organizationId: f.organizationId });

    const fechas = this.buildDateRange(f.startDate, f.endDate);
    if (fechas) and.push({ createdAt: fechas });

    if (f.resolutionStatus) and.push({ resolutionStatus: f.resolutionStatus });
    if (f.mood) and.push({ rating: moodToRatingWhere(f.mood) });
    if (
      f.rating &&
      Number.isInteger(f.rating) &&
      f.rating >= 1 &&
      f.rating <= 5
    )
      and.push({ rating: f.rating });
    if (typeof f.wouldRecommend === 'boolean')
      and.push({ wouldRecommend: f.wouldRecommend });
    if (f.experience) and.push({ experience: f.experience });
    if (f.withComment) and.push({ feedback: { not: null } });

    if (f.status === 'ANSWERED') and.push({ isUsed: true });
    else if (f.status === 'PARTIAL')
      and.push({ isUsed: false, rating: { not: null } });
    else if (f.status === 'PENDING')
      and.push({ isUsed: false, rating: null, expiresAt: { gt: now } });
    else if (f.status === 'EXPIRED')
      and.push({ isUsed: false, rating: null, expiresAt: { lte: now } });

    const q = f.q?.trim().slice(0, MAX_SEARCH_LENGTH);
    if (q) {
      const texto = { contains: q, mode: 'insensitive' as const };
      const or: Prisma.ChatSurveyWhereInput[] = [
        { patient: { is: { fullName: texto } } },
        { feedback: texto },
      ];
      const digitos = q.replace(/\D/g, '');
      if (digitos.length >= 3) {
        or.push(
          { patient: { is: { cedula: { contains: digitos } } } },
          { patient: { is: { whatsappId: { contains: digitos } } } },
        );
      }
      and.push({ OR: or });
    }

    if (and.length === 0) return {};
    if (and.length === 1) return and[0];
    return { AND: and };
  }

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
  // Las encuestas sin responder van al final en cualquier sentido, y a igual
  // valor manda la más reciente.
  private buildOrderBy(
    sortBy: string | undefined,
    sortDir: string | undefined,
  ): Prisma.ChatSurveyOrderByWithRelationInput[] {
    const dir: Prisma.SortOrder = sortDir === 'asc' ? 'asc' : 'desc';
    switch (sortBy) {
      case 'rating':
        return [
          { rating: { sort: dir, nulls: 'last' } },
          { createdAt: 'desc' },
        ];
      case 'answeredAt':
        return [
          { answeredAt: { sort: dir, nulls: 'last' } },
          { createdAt: 'desc' },
        ];
      case 'patient':
        return [{ patient: { fullName: dir } }, { createdAt: 'desc' }];
      default:
        return [{ createdAt: dir }];
    }
  }

  /** `YYYY-MM-DD` válido o undefined. */
  private validDay(day?: string): string | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day?.trim() ?? '');
    if (!m) return undefined;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
      ? `${m[1]}-${m[2]}-${m[3]}`
      : undefined;
  }

  /**
   * Días de envío en la hora de la clínica: del inicio del primer día al
   * final del último (los contenedores corren en UTC; CLAUDE.md, fechas).
   */
  private buildDateRange(
    startDate?: string,
    endDate?: string,
  ): Prisma.DateTimeFilter | null {
    const range: Prisma.DateTimeFilter = {};
    const ini = this.validDay(startDate);
    const fin = this.validDay(endDate);
    if (ini) {
      const [y, m, d] = ini.split('-').map(Number);
      range.gte = horaLocalAUtc(y, m, d, 0);
    }
    if (fin) {
      const [y, m, d] = fin.split('-').map(Number);
      // Medianoche del día siguiente, excluida: Date.UTC normaliza el día 32.
      const sig = new Date(Date.UTC(y, m - 1, d + 1));
      range.lt = horaLocalAUtc(
        sig.getUTCFullYear(),
        sig.getUTCMonth() + 1,
        sig.getUTCDate(),
        0,
      );
    }
    return Object.keys(range).length > 0 ? range : null;
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
