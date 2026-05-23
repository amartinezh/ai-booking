'use server';

// Server actions del 📡 Monitor de Servicios (SUPER_ADMIN).
// Replican el patrón de `integrations.ts`: reenvían la cookie auth_token al
// backend NestJS. Toda la lógica de checks e incidentes vive en el backend.

import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

// ── Tipos compartidos con el backend (monitor.service.ts) ─────────────────────

export interface LiveServiceResult {
  key: string;
  displayName: string;
  group: string;
  status: 'UP' | 'DOWN' | 'DEGRADED';
  latencyMs: number | null;
  httpStatus?: number | null;
  errorMessage?: string | null;
  errorCode?: string | null;
}

export interface LiveCheckResponse {
  timestamp: string;
  services: LiveServiceResult[];
}

export interface IncidentRow {
  id: string;
  serviceKey: string;
  status: string;
  startedAt: string;
  resolvedAt: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentListResult {
  rows: IncidentRow[];
  total: number;
}

export interface IncidentSummary {
  periodDays: number;
  total: number;
  open: number;
  resolved: number;
  avgDurationMs: number | null;
}

export interface MonitorMeta {
  bgEnabled: boolean;
  bgIntervalMinutes: number;
  liveIntervalSeconds: number;
  services: { key: string; displayName: string; group: string }[];
}

export interface IncidentQuery {
  from?: string;
  to?: string;
  services?: string[];
  status?: 'all' | 'open' | 'resolved';
  search?: string;
  limit?: number;
  offset?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function requireSuperAdmin(): Promise<boolean> {
  const session = await getSession();
  return !!session && session.role === 'SUPER_ADMIN';
}

async function callBackend<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  const res = await fetch(`${INTERNAL_API_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Cookie: `auth_token=${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    ...init,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backend ${res.status}: ${err}`);
  }
  return res.json() as Promise<T>;
}

// ── acciones ────────────────────────────────────────────────────────────────

/** MODO B: ejecuta un check en vivo. NO persiste nada. */
export async function liveCheck(): Promise<LiveCheckResponse> {
  if (!(await requireSuperAdmin())) {
    return { timestamp: new Date().toISOString(), services: [] };
  }
  return callBackend<LiveCheckResponse>('/monitor/live-check');
}

export async function getMonitorMeta(): Promise<MonitorMeta | null> {
  if (!(await requireSuperAdmin())) return null;
  try {
    return await callBackend<MonitorMeta>('/monitor/config');
  } catch {
    return null;
  }
}

export async function listIncidents(
  query: IncidentQuery = {},
): Promise<IncidentListResult> {
  if (!(await requireSuperAdmin())) return { rows: [], total: 0 };
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.services?.length) params.set('service', query.services.join(','));
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return callBackend<IncidentListResult>(
    `/monitor/incidents${qs ? `?${qs}` : ''}`,
  );
}

export async function getIncidentSummary(
  period = '30d',
): Promise<IncidentSummary | null> {
  if (!(await requireSuperAdmin())) return null;
  try {
    return await callBackend<IncidentSummary>(
      `/monitor/incidents/summary?period=${encodeURIComponent(period)}`,
    );
  } catch {
    return null;
  }
}

/** Limpieza manual de incidentes resueltos anteriores a `beforeISO`. */
export async function clearIncidents(
  beforeISO: string,
): Promise<{ deleted: number } | { error: string }> {
  if (!(await requireSuperAdmin())) return { error: 'Acceso denegado.' };
  try {
    return await callBackend<{ deleted: number }>(
      `/monitor/incidents?before=${encodeURIComponent(beforeISO)}`,
      { method: 'DELETE' },
    );
  } catch (e: any) {
    return { error: e?.message ?? 'Error al limpiar incidentes.' };
  }
}
