// Helpers visuales compartidos por las dos vistas de encuestas (Super Admin y
// Clinic Admin): estrellas, respuestas, estado del enlace y gestión.
// Los textos de cada respuesta salen de lib/encuestas/etiquetas.ts (los usa
// también la descarga) para que pantalla y archivo digan lo mismo.
import { Star, ThumbsDown, ThumbsUp } from 'lucide-react';
import type {
  ResolutionStatus,
  SurveyAnswerStatus,
  SurveyExperience,
  UserMood,
} from '@/app/actions/surveys.types';
import {
  ESTADO_LABEL,
  EXPERIENCIA_LABEL,
  GESTION_LABEL,
} from '@/lib/encuestas/etiquetas';

const pill = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold';

// ── Ánimo (userMood) ─────────────────────────────────────────────
export const MOOD_META: Record<UserMood, { label: string; emoji: string; badge: string }> = {
  HAPPY: {
    label: 'Feliz',
    emoji: '😊',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  NEUTRAL: {
    label: 'Neutral',
    emoji: '😐',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  NEGATIVE: {
    label: 'Negativo',
    emoji: '😞',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
};

// ── Estrellas ────────────────────────────────────────────────────
export function Stars({ rating, size = 'sm' }: { rating: number | null; size?: 'sm' | 'md' }) {
  if (rating == null) {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  const cls = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Star
          key={v}
          aria-hidden
          className={`${cls} ${v <= rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-300 dark:text-zinc-600'}`}
        />
      ))}
    </span>
  );
}

// ── ¿Recomendaría la IPS? ────────────────────────────────────────
export function RecommendBadge({ value }: { value: boolean | null }) {
  if (value == null) return <span className="text-xs text-zinc-400">—</span>;
  return value ? (
    <span className={`${pill} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300`}>
      <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> Sí
    </span>
  ) : (
    <span className={`${pill} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300`}>
      <ThumbsDown className="h-3.5 w-3.5" aria-hidden /> No
    </span>
  );
}

// ── ¿Cómo le fue en su experiencia? ──────────────────────────────
export const EXPERIENCE_META: Record<SurveyExperience, { emoji: string; badge: string; bar: string }> = {
  GOOD: {
    emoji: '😊',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
  FAIR: {
    emoji: '😐',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    bar: 'bg-amber-400',
  },
  BAD: {
    emoji: '😞',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    bar: 'bg-red-500',
  },
  NO_ANSWER: {
    emoji: '🤐',
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    bar: 'bg-zinc-400 dark:bg-zinc-500',
  },
};

export function ExperienceBadge({ value }: { value: SurveyExperience | null }) {
  if (!value) return <span className="text-xs text-zinc-400">—</span>;
  const m = EXPERIENCE_META[value];
  return (
    <span className={`${pill} ${m.badge}`}>
      <span aria-hidden>{m.emoji}</span>
      {EXPERIENCIA_LABEL[value]}
    </span>
  );
}

// ── Estado del enlace ────────────────────────────────────────────
const STATUS_BADGE: Record<SurveyAnswerStatus, string> = {
  ANSWERED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  PARTIAL: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  PENDING: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  EXPIRED: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

export function StatusBadge({ status }: { status: SurveyAnswerStatus }) {
  return <span className={`${pill} ${STATUS_BADGE[status]}`}>{ESTADO_LABEL[status]}</span>;
}

/** Fondo suave de fila según la experiencia (o las estrellas en las anteriores). */
export function rowTint(experience: SurveyExperience | null, mood: UserMood | null): string {
  const tono = experience ?? (mood === 'HAPPY' ? 'GOOD' : mood === 'NEUTRAL' ? 'FAIR' : mood === 'NEGATIVE' ? 'BAD' : null);
  switch (tono) {
    case 'BAD':
      return 'bg-red-50/60 dark:bg-red-900/10';
    case 'FAIR':
      return 'bg-amber-50/50 dark:bg-amber-900/10';
    default:
      return '';
  }
}

// ── Gestión que cerró el chat ────────────────────────────────────
const RESOLUTION_BADGE: Record<ResolutionStatus, string> = {
  BOOKED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800',
  QUEUED: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800',
  CANCELLED: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
  BLOCKED_INSULT: 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800',
  SYSTEM_ERROR: 'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700',
};

export function ResolutionBadge({ status }: { status: ResolutionStatus }) {
  return <span className={`${pill} font-medium ${RESOLUTION_BADGE[status]}`}>{GESTION_LABEL[status]}</span>;
}
