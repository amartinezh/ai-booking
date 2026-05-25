// Tipos compartidos de los reportes CSAT (no van en surveys.ts porque los
// archivos 'use server' sólo pueden exportar funciones async).

export type UserMood = 'NEGATIVE' | 'NEUTRAL' | 'HAPPY';
export type ResolutionStatus = 'BOOKED' | 'QUEUED' | 'BLOCKED_INSULT' | 'SYSTEM_ERROR' | 'CANCELLED';
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

export type DetailedSurveysResult = PaginatedSurveys<DetailedSurveyRow>;
export type LimitedSurveysResult = PaginatedSurveys<LimitedSurveyRow>;
