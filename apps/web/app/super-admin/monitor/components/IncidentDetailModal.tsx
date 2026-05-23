'use client';

import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { IncidentRow } from '@/app/actions/monitor';
import {
  fmtDuration,
  fmtLocal,
  statusLabel,
  statusTextClass,
} from './status-ui';

export default function IncidentDetailModal({
  incident,
  serviceName,
  onClose,
}: {
  incident: IncidentRow;
  serviceName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const durationMs = incident.resolvedAt
    ? new Date(incident.resolvedAt).getTime() -
      new Date(incident.startedAt).getTime()
    : Date.now() - new Date(incident.startedAt).getTime();

  const copyText = [
    `Servicio: ${serviceName} (${incident.serviceKey})`,
    `Estado: ${incident.status}`,
    `Inicio: ${fmtLocal(incident.startedAt)}`,
    `Fin: ${incident.resolvedAt ? fmtLocal(incident.resolvedAt) : 'Aún en curso'}`,
    `Duración: ${fmtDuration(durationMs)}${incident.resolvedAt ? '' : ' (en curso)'}`,
    `HTTP: ${incident.httpStatus ?? '—'}`,
    `Código: ${incident.errorCode ?? '—'}`,
    `Latencia: ${incident.latencyMs != null ? `${incident.latencyMs} ms` : '—'}`,
    `Error: ${incident.errorMessage ?? '—'}`,
  ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard puede fallar sin https/localhost; ignorar silenciosamente */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
              {serviceName}
            </h3>
            <span className={`text-sm font-semibold ${statusTextClass(incident.status)}`}>
              {statusLabel(incident.status)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          <Row label="Inicio" value={fmtLocal(incident.startedAt)} />
          <Row
            label="Fin"
            value={
              incident.resolvedAt ? fmtLocal(incident.resolvedAt) : 'Aún en curso'
            }
          />
          <Row
            label="Duración"
            value={`${fmtDuration(durationMs)}${incident.resolvedAt ? '' : ' (en curso)'}`}
          />
          <Row label="HTTP" value={incident.httpStatus?.toString() ?? '—'} />
          <Row label="Código" value={incident.errorCode ?? '—'} mono />
          <Row
            label="Latencia"
            value={incident.latencyMs != null ? `${incident.latencyMs} ms` : '—'}
            mono
          />

          <div>
            <p className="text-zinc-500 dark:text-zinc-400 mb-1">Mensaje de error</p>
            <pre className="font-mono text-xs whitespace-pre-wrap break-words rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3 text-zinc-800 dark:text-zinc-200 max-h-48 overflow-auto">
              {incident.errorMessage ?? '—'}
            </pre>
          </div>
        </div>

        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
          <button
            onClick={copy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiado' : 'Copiar al portapapeles'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span
        className={`text-zinc-900 dark:text-white text-right ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
