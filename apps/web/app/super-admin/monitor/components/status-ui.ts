// Helpers visuales compartidos por las cards y el gráfico del monitor.

export type ServiceStatus = 'UP' | 'DOWN' | 'DEGRADED';

export const STATUS_COLOR: Record<string, string> = {
  UP: '#10b981',
  DEGRADED: '#f59e0b',
  DOWN: '#ef4444',
};

/** Color por línea/servicio en el gráfico (estable por orden de servicio). */
export const SERVICE_LINE_COLORS = ['#6366f1', '#0ea5e9', '#ec4899', '#14b8a6', '#f97316'];

export function statusLabel(status: string): string {
  if (status === 'UP') return 'Operativo';
  if (status === 'DEGRADED') return 'Degradado';
  if (status === 'DOWN') return 'Caído';
  return status;
}

/** Tailwind classes para el punto de estado (con pulse en UP). */
export function statusDotClass(status: string): string {
  if (status === 'UP') return 'bg-emerald-500 animate-pulse';
  if (status === 'DEGRADED') return 'bg-amber-500';
  return 'bg-red-500';
}

export function statusTextClass(status: string): string {
  if (status === 'UP') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'DEGRADED') return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Duración legible: "18 min", "2 h 14 min", "45 s". */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h} h ${remM} min` : `${h} h`;
}

/** Fecha/hora en zona local del navegador (es-CO). */
export function fmtLocal(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
