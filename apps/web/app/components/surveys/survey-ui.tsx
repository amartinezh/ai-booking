// Helpers visuales compartidos por las dos vistas de encuestas (Super Admin y
// Clinic Admin): badges de ánimo, estrellas y badges de estado de resolución.
import { Star } from 'lucide-react';
import type { ResolutionStatus, UserMood } from '@/app/actions/surveys.types';

// ── Ánimo (userMood) ─────────────────────────────────────────────
export const MOOD_META: Record<
  UserMood,
  { label: string; emoji: string; badge: string; rowBg: string }
> = {
  HAPPY: {
    label: 'Feliz',
    emoji: '😊',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    rowBg: 'bg-emerald-50/50 dark:bg-emerald-900/10',
  },
  NEUTRAL: {
    label: 'Neutral',
    emoji: '😐',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    rowBg: 'bg-amber-50/50 dark:bg-amber-900/10',
  },
  NEGATIVE: {
    label: 'Negativo',
    emoji: '😞',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    rowBg: 'bg-red-50/50 dark:bg-red-900/10',
  },
};

export function MoodBadge({ mood }: { mood: UserMood | null }) {
  if (!mood) {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        Sin responder
      </span>
    );
  }
  const m = MOOD_META[mood];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.badge}`}>
      <span aria-hidden>{m.emoji}</span>
      {m.label}
    </span>
  );
}

/** Fondo suave de fila según el ánimo (verde/feliz, rojo/negativo, …). */
export function moodRowClass(mood: UserMood | null): string {
  return mood ? MOOD_META[mood].rowBg : '';
}

// ── Estrellas ────────────────────────────────────────────────────
export function Stars({ rating }: { rating: number | null }) {
  if (rating == null) {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} de 5`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Star
          key={v}
          className={`h-4 w-4 ${v <= rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-300 dark:text-zinc-600'}`}
        />
      ))}
    </span>
  );
}

// ── Estado de resolución ─────────────────────────────────────────
export const RESOLUTION_META: Record<ResolutionStatus, { label: string; badge: string }> = {
  BOOKED: {
    label: 'Agendado',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  QUEUED: {
    label: 'En cola',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  BLOCKED_INSULT: {
    label: 'Bloqueado',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  SYSTEM_ERROR: {
    label: 'Error técnico',
    badge: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  },
};

export function ResolutionBadge({ status }: { status: ResolutionStatus }) {
  const r = RESOLUTION_META[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.badge}`}>
      {r.label}
    </span>
  );
}
