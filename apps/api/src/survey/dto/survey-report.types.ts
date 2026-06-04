import { Prisma, ResolutionStatus } from '@antigravity/database';

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
// Parámetros de consulta (parseados desde el query string en el controller)
// ───────────────────────────────────────────────────────────────
export type SurveySortField = 'createdAt' | 'rating';
export type SortDir = 'asc' | 'desc';

export interface DetailedSurveyQuery {
  page: number;
  pageSize: number;
  sortBy: SurveySortField;
  sortDir: SortDir;
  startDate?: string;
  endDate?: string;
  organizationId?: string;
  mood?: UserMood;
  resolutionStatus?: ResolutionStatus;
}

export interface LimitedSurveyQuery {
  page: number;
  pageSize: number;
  sortBy: SurveySortField;
  sortDir: SortDir;
}

// ───────────────────────────────────────────────────────────────
// Filas de salida (DTOs serializables — fechas en ISO string)
// ───────────────────────────────────────────────────────────────

// 🔓 Super Admin: 100% del detalle.
export interface DetailedSurveyRow {
  id: string;
  createdAt: string;
  rating: number | null;
  userMood: UserMood | null;
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

// 🔒 Clinic Admin: payload minimalista. SIN chatSummary, expiresAt, ids internos, etc.
export interface LimitedSurveyRow {
  id: string;
  createdAt: string;
  patientName: string;
  whatsappPhone: string | null;
  rating: number | null;
  userMood: UserMood | null;
  message: string | null;
}

export interface PaginatedSurveys<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
