'use client';

import type { LiveServiceResult } from '@/app/actions/monitor';
import {
  fmtLatency,
  statusDotClass,
  statusLabel,
  statusTextClass,
} from './status-ui';

/** Card de estado en vivo de un servicio (MODO B). */
export default function LiveStatusCard({
  service,
}: {
  service: LiveServiceResult;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4 transition-colors duration-300">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
          {service.displayName}
        </span>
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${statusDotClass(
            service.status,
          )}`}
          aria-label={statusLabel(service.status)}
        />
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`font-mono text-lg font-bold ${statusTextClass(
            service.status,
          )}`}
        >
          {fmtLatency(service.latencyMs)}
        </span>
        <span className={`text-xs font-medium ${statusTextClass(service.status)}`}>
          {statusLabel(service.status)}
        </span>
      </div>

      {service.status !== 'UP' && service.errorMessage && (
        <p className="mt-2 font-mono text-[11px] leading-snug text-red-600 dark:text-red-400 break-words line-clamp-3">
          {service.errorMessage}
        </p>
      )}
    </div>
  );
}
