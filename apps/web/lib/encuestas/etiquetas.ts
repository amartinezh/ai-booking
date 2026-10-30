/**
 * ⭐ Encuesta de satisfacción — textos y formatos que comparten la pantalla de
 * consulta y la descarga. Puro, para probarlo.
 */
import { DEFAULT_TIMEZONE } from '@/lib/date';
import type {
  Granularidad,
  ResolutionStatus,
  SurveyAnswerStatus,
  SurveyExperience,
} from '@/app/actions/surveys.types';

export const EXPERIENCIA_LABEL: Record<SurveyExperience, string> = {
  GOOD: 'Buena',
  FAIR: 'Regular',
  BAD: 'Mala',
  NO_ANSWER: 'No responde',
};

export const EXPERIENCIAS: SurveyExperience[] = ['GOOD', 'FAIR', 'BAD', 'NO_ANSWER'];

export const ESTADO_LABEL: Record<SurveyAnswerStatus, string> = {
  ANSWERED: 'Completa',
  PARTIAL: 'Solo estrellas',
  PENDING: 'Enlace abierto',
  EXPIRED: 'Venció sin respuesta',
};

/** La gestión con la que se cerró el chat y se envió la encuesta. */
export const GESTION_LABEL: Record<ResolutionStatus, string> = {
  BOOKED: 'Agendó o cambió cita',
  QUEUED: 'Lista de espera',
  CANCELLED: 'Canceló cita',
  BLOCKED_INSULT: 'Cerrado por insultos',
  SYSTEM_ERROR: 'Error técnico',
};

export const GESTIONES: ResolutionStatus[] = ['BOOKED', 'CANCELLED', 'QUEUED', 'SYSTEM_ERROR', 'BLOCKED_INSULT'];

export const RECOMIENDA_LABEL = (v: boolean | null): string => (v == null ? '' : v ? 'Sí' : 'No');

/** 0.8734 → «87 %». null → «—». */
export function porcentaje(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)} %`;
}

/** 4.6 → «4,6». */
export function decimal(v: number | null | undefined, decimales = 1): string {
  return v == null ? '—' : v.toFixed(decimales).replace('.', ',');
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Etiqueta corta de un tramo de la gráfica: «30 oct», «oct 2026» o «9 a. m.». */
export function etiquetaTramo(bucket: string, granularidad: Granularidad): string {
  const [fecha, hora] = bucket.split('T');
  const [y, m, d] = fecha.split('-').map(Number);
  if (granularidad === 'hour' && hora != null) {
    const h = Number(hora);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  }
  if (granularidad === 'month') return `${MESES[m - 1]} ${y}`;
  return `${d} ${MESES[m - 1]}`;
}

// ── Periodos ──────────────────────────────────────────────────────

export type Periodo = '7d' | '30d' | 'mes' | 'mes-anterior' | '90d' | 'anio' | 'todo' | 'personalizado';

export const PERIODOS: { value: Periodo; label: string }[] = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mes-anterior', label: 'Mes anterior' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'anio', label: 'Este año' },
  { value: 'todo', label: 'Todo' },
  { value: 'personalizado', label: 'Personalizado…' },
];

const dos = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${dos(m)}-${dos(d)}`;

/** Fecha de hoy (`YYYY-MM-DD`) en la hora de la clínica, no en la del navegador ni en UTC. */
export function hoyLocal(now: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  const partes: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)) {
    partes[p.type] = p.value;
  }
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function restarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Fechas (incluidas) de un periodo; `todo` y `personalizado` no traen fechas. */
export function rangoDePeriodo(
  periodo: Periodo,
  now: Date = new Date(),
): { startDate?: string; endDate?: string } {
  const hoy = hoyLocal(now);
  const [y, m] = hoy.split('-').map(Number);
  switch (periodo) {
    case '7d':
      return { startDate: restarDias(hoy, 6), endDate: hoy };
    case '30d':
      return { startDate: restarDias(hoy, 29), endDate: hoy };
    case '90d':
      return { startDate: restarDias(hoy, 89), endDate: hoy };
    case 'mes':
      return { startDate: iso(y, m, 1), endDate: hoy };
    case 'mes-anterior': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const ultimo = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { startDate: iso(py, pm, 1), endDate: iso(py, pm, ultimo) };
    }
    case 'anio':
      return { startDate: iso(y, 1, 1), endDate: hoy };
    default:
      return {};
  }
}
