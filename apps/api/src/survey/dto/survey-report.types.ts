import { Prisma, ResolutionStatus, SurveyExperience } from '@agenia/database';
import type { Granularidad } from '@agenia/shared';

// ───────────────────────────────────────────────────────────────
// 😀 CLASIFICACIÓN DE ÁNIMO (userMood) DERIVADA DE LA CALIFICACIÓN
//   1-2  → NEGATIVE (Rojo)
//   3    → NEUTRAL  (Amarillo)
//   4-5  → HAPPY    (Verde)
// ───────────────────────────────────────────────────────────────
export enum UserMood {
  NEGATIVE = 'NEGATIVE',
  NEUTRAL = 'NEUTRAL',
  HAPPY = 'HAPPY',
}

/** Deriva el ánimo a partir del rating. null si aún no hay calificación. */
export function computeUserMood(
  rating: number | null | undefined,
): UserMood | null {
  if (rating == null) return null;
  if (rating <= 2) return UserMood.NEGATIVE;
  if (rating === 3) return UserMood.NEUTRAL;
  return UserMood.HAPPY;
}

/** Traduce un filtro por ánimo a un rango de rating para el WHERE de Prisma. */
export function moodToRatingWhere(mood: UserMood): Prisma.IntNullableFilter {
  switch (mood) {
    case UserMood.NEGATIVE:
      return { gte: 1, lte: 2 };
    case UserMood.NEUTRAL:
      return { equals: 3 };
    case UserMood.HAPPY:
      return { gte: 4, lte: 5 };
  }
}

// ───────────────────────────────────────────────────────────────
// Estado de la encuesta
//   ANSWERED → completa: el paciente envió también las preguntas de la IPS
//   PARTIAL  → solo estrellas: calificó al asistente (se guarda al tocar la
//              estrella) y no envió el resto; mientras el enlace siga vigente
//              puede completarla
//   PENDING  → el enlace sigue abierto y aún no calificó
//   EXPIRED  → venció sin ninguna respuesta
// ───────────────────────────────────────────────────────────────
export const SURVEY_ANSWER_STATUSES = [
  'ANSWERED',
  'PARTIAL',
  'PENDING',
  'EXPIRED',
] as const;
export type SurveyAnswerStatus = (typeof SURVEY_ANSWER_STATUSES)[number];

export function computeAnswerStatus(
  isUsed: boolean,
  expiresAt: Date,
  now: Date = new Date(),
  rating: number | null = null,
): SurveyAnswerStatus {
  if (isUsed) return 'ANSWERED';
  if (rating != null) return 'PARTIAL';
  return expiresAt.getTime() > now.getTime() ? 'PENDING' : 'EXPIRED';
}

// ───────────────────────────────────────────────────────────────
// Parámetros de consulta (parseados desde el query string en el controller)
// ───────────────────────────────────────────────────────────────
export const SURVEY_SORT_FIELDS = [
  'createdAt',
  'answeredAt',
  'rating',
  'patient',
] as const;
export type SurveySortField = (typeof SURVEY_SORT_FIELDS)[number];
export type SortDir = 'asc' | 'desc';

/** Filtros comunes a la lista, las estadísticas y la descarga. */
export interface SurveyFilters {
  /** Día de envío, `YYYY-MM-DD` en la hora de la clínica (incluido). */
  startDate?: string;
  /** Día de envío, `YYYY-MM-DD` en la hora de la clínica (incluido completo). */
  endDate?: string;
  /** Busca en nombre, cédula, teléfono y comentario. */
  q?: string;
  status?: SurveyAnswerStatus;
  /** Estrellas exactas (1 a 5). */
  rating?: number;
  mood?: UserMood;
  wouldRecommend?: boolean;
  experience?: SurveyExperience;
  /** Solo las que dejaron comentario. */
  withComment?: boolean;
  resolutionStatus?: ResolutionStatus;
  /** Solo Super Admin: la vista de la clínica la fija el token. */
  organizationId?: string;
}

export interface SurveyListQuery extends SurveyFilters {
  page: number;
  pageSize: number;
  sortBy: SurveySortField;
  sortDir: SortDir;
}

export type DetailedSurveyQuery = SurveyListQuery;
export type LimitedSurveyQuery = Omit<SurveyListQuery, 'organizationId'>;

// ───────────────────────────────────────────────────────────────
// Filas de salida (DTOs serializables — fechas en ISO string)
// ───────────────────────────────────────────────────────────────

// 🔓 Super Admin: 100% del detalle.
export interface DetailedSurveyRow {
  id: string;
  createdAt: string;
  answeredAt: string | null;
  status: SurveyAnswerStatus;
  rating: number | null;
  userMood: UserMood | null;
  wouldRecommend: boolean | null;
  experience: SurveyExperience | null;
  feedback: string | null;
  chatSummary: string | null;
  resolutionStatus: ResolutionStatus;
  isUsed: boolean;
  patient: {
    id: string;
    fullName: string;
    whatsappId: string | null;
    cedula: string;
  } | null;
  organization: {
    id: string;
    name: string;
  };
}

// 🔒 Clinic Admin: sin chatSummary, cédula, expiresAt ni ids internos.
// `resolutionStatus` sí viaja: es la gestión que cerró el chat (agendó,
// canceló, lista de espera…), no un dato del paciente.
export interface LimitedSurveyRow {
  id: string;
  createdAt: string;
  answeredAt: string | null;
  status: SurveyAnswerStatus;
  patientName: string;
  whatsappPhone: string | null;
  rating: number | null;
  userMood: UserMood | null;
  wouldRecommend: boolean | null;
  experience: SurveyExperience | null;
  message: string | null;
  resolutionStatus: ResolutionStatus;
}

export interface PaginatedSurveys<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Descarga: las filas que cumplen los filtros, hasta un tope. */
export interface SurveyExport<T> {
  rows: T[];
  total: number;
  /** true si había más filas que el tope y se cortó. */
  truncated: boolean;
}

// ───────────────────────────────────────────────────────────────
// Estadísticas
// ───────────────────────────────────────────────────────────────

/** Indicadores de un grupo de encuestas (todas, una gestión o un tramo de tiempo). */
export interface SurveyIndicators {
  sent: number;
  /** Con al menos las estrellas (completas + solo estrellas). */
  answered: number;
  /** Promedio de estrellas del asistente; null sin calificaciones. */
  averageRating: number | null;
  /** Sí / (Sí + No); null si nadie respondió la pregunta. */
  recommendRate: number | null;
  /** Buena / (Buena + Regular + Mala), sin contar «No responde». */
  goodRate: number | null;
}

export interface SurveyStats extends SurveyIndicators {
  /** Completas: enviaron también las preguntas de la IPS. */
  complete: number;
  /** Solo estrellas: calificaron al asistente y no enviaron el resto. */
  starsOnly: number;
  /** Sin ninguna respuesta, con el enlace abierto. */
  pending: number;
  /** Sin ninguna respuesta, vencidas. */
  expired: number;
  /** Respondidas (con estrellas) / enviadas. */
  responseRate: number | null;
  /**
   * Promedio de estrellas de quienes respondieron también las preguntas de la
   * IPS y de quienes solo dieron estrellas: si difieren mucho, los porcentajes
   * de la IPS no representan a todos los que respondieron.
   */
  averageRatingWithIps: number | null;
  averageRatingStarsOnly: number | null;
  /** Respondidas con comentario. */
  comments: number;
  /** Cantidad por estrellas, de 1 a 5 (índice 0 = 1 estrella). */
  ratingDistribution: number[];
  recommend: { yes: number; no: number };
  experience: Record<SurveyExperience, number>;
  byResolution: (SurveyIndicators & { status: ResolutionStatus })[];
  trend: {
    granularity: Granularidad;
    points: (SurveyIndicators & { bucket: string })[];
    /**
     * Por semana (lunes a domingo, `bucket` = el lunes), solo si el rango va
     * por día y pasa de 14 días: con pocas respuestas al día los porcentajes
     * diarios saltan de 0 a 100 %.
     */
    weekly?: (SurveyIndicators & { bucket: string })[];
  };
  /** true si hubo más encuestas que el tope de cálculo. */
  truncated: boolean;
}
