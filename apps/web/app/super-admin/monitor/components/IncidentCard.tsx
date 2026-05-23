'use client';

import type { IncidentRow } from '@/app/actions/monitor';
import { fmtDuration, fmtLocal, statusLabel } from './status-ui';

/** Card de un incidente del histórico (MODO A). */
export default function IncidentCard({
  incident,
  serviceName,
  onOpen,
}: {
  incident: IncidentRow;
  serviceName: string;
  onOpen: () => void;
}) {
  const isOpen = !incident.resolvedAt;
  const isDown = incident.status === 'DOWN';

  const durationMs = incident.resolvedAt
    ? new Date(incident.resolvedAt).getTime() -
      new Date(incident.startedAt).getTime()
    : Date.now() - new Date(incident.startedAt).getTime();

  const borderColor = isDown
    ? 'border-l-red-500'
    : 'border-l-amber-500';

  return (
    <div
      className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 border-l-4 ${borderColor} bg-white dark:bg-zinc-900 shadow-sm p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{isDown ? '🔴' : '🟡'}</span>
          <span className="font-semibold text-zinc-900 dark:text-white">
            {statusLabel(incident.status)}
          </span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-700 dark:text-zinc-300 truncate">
            {serviceName}
          </span>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
          {fmtLocal(incident.startedAt)} →{' '}
          {isOpen ? (
            <span className="font-semibold text-red-600 dark:text-red-400">
              activo
            </span>
          ) : (
            fmtLocal(incident.resolvedAt)
          )}
        </span>
      </div>

      <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Duración: {fmtDuration(durationMs)}
        {isOpen ? ' (en curso)' : ' · ✅ Resuelto'}
      </div>

      {incident.errorMessage && (
        <p
          className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-500 truncate"
          title={incident.errorMessage}
        >
          {incident.errorCode ? `[${incident.errorCode}] ` : ''}
          {incident.errorMessage}
        </p>
      )}

      <button
        onClick={onOpen}
        className="mt-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Ver detalle completo →
      </button>
    </div>
  );
}
