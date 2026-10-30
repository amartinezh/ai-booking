// Tipos compartidos de los reportes de la encuesta de satisfacción (no van en
// surveys.ts porque los archivos 'use server' sólo pueden exportar funciones
// async). Reflejan los DTO de apps/api/src/survey/dto/survey-report.types.ts.

export type UserMood = 'NEGATIVE' | 'NEUTRAL' | 'HAPPY';
export type ResolutionStatus = 'BOOKED' | 'QUEUED' | 'BLOCKED_INSULT' | 'SYSTEM_ERROR' | 'CANCELLED';
export type SurveyExperience = 'GOOD' | 'FAIR' | 'BAD' | 'NO_ANSWER';
export type SurveyAnswerStatus = 'ANSWERED' | 'PENDING' | 'EXPIRED';
export type SurveySortField = 'createdAt' | 'answeredAt' | 'rating' | 'patient';
export type SortDir = 'asc' | 'desc';
export type Granularidad = 'hour' | 'day' | 'month';

/** Quién consulta: la clínica (solo lo suyo, sin datos internos) o el Super Admin (todo). */
export type SurveyScope = 'clinic' | 'global';

export interface SurveyFilters {
  startDate?: string;
  endDate?: string;
  q?: string;
  status?: SurveyAnswerStatus;
  rating?: number;
  mood?: UserMood;
  recommend?: 'YES' | 'NO';
  experience?: SurveyExperience;
  withComment?: boolean;
  resolutionStatus?: ResolutionStatus;
  /** Solo Super Admin. */
  organizationId?: string;
}

export interface SurveyListQuery extends SurveyFilters {
  page: number;
  pageSize: number;
  sortBy: SurveySortField;
  sortDir: SortDir;
}

/** Fila que muestra el panel, igual para las dos vistas. */
export interface SurveyRowView {
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
  /** Solo Super Admin. */
  cedula?: string | null;
  chatSummary?: string | null;
  organizationName?: string;
}

export interface SurveyListResult {
  rows: SurveyRowView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SurveyExportResult {
  rows: SurveyRowView[];
  total: number;
  truncated: boolean;
}

export interface SurveyIndicators {
  sent: number;
  answered: number;
  averageRating: number | null;
  recommendRate: number | null;
  goodRate: number | null;
}

export interface SurveyStats extends SurveyIndicators {
  pending: number;
  expired: number;
  responseRate: number | null;
  comments: number;
  ratingDistribution: number[];
  recommend: { yes: number; no: number };
  experience: Record<SurveyExperience, number>;
  byResolution: (SurveyIndicators & { status: ResolutionStatus })[];
  trend: {
    granularity: Granularidad;
    points: (SurveyIndicators & { bucket: string })[];
    /** Por semana (bucket = el lunes) cuando el rango va por día y pasa de 14 días. */
    weekly?: (SurveyIndicators & { bucket: string })[];
  };
  truncated: boolean;
}

// ── Lo que devuelve la API ──────────────────────────────────────

export interface ApiDetailedSurveyRow {
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
  organization: { id: string; name: string };
}

export interface ApiLimitedSurveyRow {
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
