'use server';

// Server actions de la encuesta de satisfacción. Consumen los endpoints de
// NestJS (paginación/orden/filtros + scoping multi-tenant) reenviando la
// cookie de sesión, igual que el resto de acciones que hablan con el backend.
//
// Dos alcances con la MISMA pantalla:
//   - 'clinic': ORG_ADMIN, solo su clínica (el backend vuelve a comprobarlo).
//   - 'global': SUPER_ADMIN, todas las clínicas y el detalle completo.

import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import { registrarDescarga } from './pantallas';
import type {
  ApiDetailedSurveyRow,
  ApiLimitedSurveyRow,
  SurveyExportResult,
  SurveyFilters,
  SurveyListQuery,
  SurveyListResult,
  SurveyRowView,
  SurveyScope,
  SurveyStats,
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

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && `${v}`.length > 0) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function filterParams(f: SurveyFilters, scope: SurveyScope) {
  return {
    startDate: f.startDate,
    endDate: f.endDate,
    q: f.q?.trim() || undefined,
    status: f.status,
    rating: f.rating,
    mood: f.mood,
    recommend: f.recommend,
    experience: f.experience,
    withComment: f.withComment ? 'true' : undefined,
    resolutionStatus: f.resolutionStatus,
    // La clínica nunca elige organización: la fija su sesión.
    organizationId: scope === 'global' ? f.organizationId : undefined,
  };
}

function listParams(q: SurveyListQuery, scope: SurveyScope) {
  return {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
    ...filterParams(q, scope),
  };
}

/** Comprueba el rol y devuelve la ruta base del backend para ese alcance. */
async function basePath(scope: SurveyScope): Promise<string> {
  const session = await getSession();
  if (scope === 'global') {
    if (!session || session.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');
    return '/superadmin/surveys';
  }
  if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
    throw new Error('Acceso denegado');
  }
  // El backend re-valida que este orgId coincida con el del token.
  return `/organizations/${session.organizationId}/surveys`;
}

function fromDetailed(r: ApiDetailedSurveyRow): SurveyRowView {
  return {
    id: r.id,
    createdAt: r.createdAt,
    answeredAt: r.answeredAt,
    status: r.status,
    patientName: r.patient?.fullName ?? 'Paciente anónimo',
    whatsappPhone: r.patient?.whatsappId ?? null,
    rating: r.rating,
    userMood: r.userMood,
    wouldRecommend: r.wouldRecommend,
    experience: r.experience,
    message: r.feedback,
    resolutionStatus: r.resolutionStatus,
    cedula: r.patient?.cedula ?? null,
    chatSummary: r.chatSummary,
    organizationName: r.organization.name,
  };
}

function fromLimited(r: ApiLimitedSurveyRow): SurveyRowView {
  return { ...r };
}

function toView(scope: SurveyScope, rows: unknown[]): SurveyRowView[] {
  return scope === 'global'
    ? (rows as ApiDetailedSurveyRow[]).map(fromDetailed)
    : (rows as ApiLimitedSurveyRow[]).map(fromLimited);
}

// 📋 Lista paginada.
export async function getSurveys(scope: SurveyScope, query: SurveyListQuery): Promise<SurveyListResult> {
  const base = await basePath(scope);
  const path = scope === 'global' ? `${base}/detailed` : `${base}/limited`;
  const res = await callBackend<Omit<SurveyListResult, 'rows'> & { rows: unknown[] }>(
    `${path}${toQueryString(listParams(query, scope))}`,
  );
  return { ...res, rows: toView(scope, res.rows) };
}

// 📊 Estadísticas de las encuestas filtradas.
export async function getSurveyStats(scope: SurveyScope, filters: SurveyFilters): Promise<SurveyStats> {
  const base = await basePath(scope);
  return callBackend<SurveyStats>(`${base}/stats${toQueryString(filterParams(filters, scope))}`);
}

// 📥 Descarga: las filas filtradas (con tope). Lleva datos de pacientes:
// queda en la Actividad de usuarios.
export async function exportSurveys(scope: SurveyScope, query: SurveyListQuery): Promise<SurveyExportResult> {
  const base = await basePath(scope);
  const res = await callBackend<{ rows: unknown[]; total: number; truncated: boolean }>(
    `${base}/export${toQueryString(listParams(query, scope))}`,
  );
  await registrarDescarga('ENCUESTAS', { filas: res.rows.length });
  return { ...res, rows: toView(scope, res.rows) };
}
