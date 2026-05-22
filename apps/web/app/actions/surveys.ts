'use server';

// Server actions de reportes CSAT. Consumen los endpoints OPTIMIZADOS de NestJS
// (paginación/orden/filtros + scoping multi-tenant) reenviando la cookie de
// sesión, igual que el resto de acciones que hablan con el backend.

import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import type {
  DetailedSurveyQuery,
  DetailedSurveysResult,
  LimitedSurveyQuery,
  LimitedSurveysResult,
} from './surveys.types';

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

async function callBackend<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  const res = await fetch(`${INTERNAL_API_URL}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Cookie: `auth_token=${token}` } : {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[surveys] GET ${path} -> ${res.status}: ${err}`);
    throw new Error(`Backend ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && `${v}`.length > 0) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// 🌎 Super Admin — detalle global.
export async function getDetailedSurveys(
  query: DetailedSurveyQuery,
): Promise<DetailedSurveysResult> {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') {
    throw new Error('Acceso denegado');
  }
  const qs = toQueryString({
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
    startDate: query.startDate,
    endDate: query.endDate,
    organizationId: query.organizationId,
    mood: query.mood,
    resolutionStatus: query.resolutionStatus,
  });
  return callBackend<DetailedSurveysResult>(`/superadmin/surveys/detailed${qs}`);
}

// 🏥 Clinic Admin — scoped a su propia clínica (orgId del token de sesión).
export async function getClinicSurveys(
  query: LimitedSurveyQuery,
): Promise<LimitedSurveysResult> {
  const session = await getSession();
  if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
    throw new Error('Acceso denegado');
  }
  const qs = toQueryString({
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  });
  // El backend re-valida que este orgId coincida con el del token.
  return callBackend<LimitedSurveysResult>(
    `/organizations/${session.organizationId}/surveys/limited${qs}`,
  );
}
