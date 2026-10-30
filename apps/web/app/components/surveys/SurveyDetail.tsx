'use client';

// 🔎 Detalle de una encuesta: todas sus respuestas, el comentario completo y
// (solo Super Admin) la clínica, la cédula y el resumen del chat. Se navega a
// la anterior/siguiente de la página con los botones o con ← →.

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { SurveyRowView } from '@/app/actions/surveys.types';
import { formatAppointmentLong } from '@/lib/date';
import { ExperienceBadge, RecommendBadge, ResolutionBadge, Stars, StatusBadge } from './survey-ui';

const RATING_LABELS = ['', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] items-start gap-3 border-b border-zinc-100 py-2.5 last:border-0 dark:border-zinc-800">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{titulo}</dt>
      <dd className="text-sm text-zinc-800 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

export default function SurveyDetail({
  row,
  onClose,
  onPrev,
  onNext,
}: {
  row: SurveyRowView;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const cerrarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cerrarRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // Con estrellas: completa o solo estrellas.
  const respondida = row.status === 'ANSWERED' || row.status === 'PARTIAL';
  const soloEstrellas = row.status === 'PARTIAL';
  const anterior = row.status === 'ANSWERED' && row.experience == null && row.wouldRecommend == null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="detalle-encuesta">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-zinc-900/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Encuesta</p>
            <h2 id="detalle-encuesta" className="truncate text-lg font-bold text-zinc-900 dark:text-white">
              {row.patientName}
            </h2>
            <p className="text-sm text-zinc-500">{row.whatsappPhone ?? 'Sin teléfono'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!onPrev}
              aria-label="Encuesta anterior"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              aria-label="Encuesta siguiente"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <button
              ref={cerrarRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar detalle"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {!respondida ? (
            <div className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              <StatusBadge status={row.status} />
              <p className="mt-2">
                {row.status === 'PENDING'
                  ? 'El paciente aún puede responder: el enlace vale 24 horas desde que se envió.'
                  : 'El paciente no respondió en las 24 horas que vale el enlace.'}
              </p>
            </div>
          ) : (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Respuestas</h3>
              <dl>
                <Dato titulo="Asistente virtual">
                  <span className="flex flex-wrap items-center gap-2">
                    <Stars rating={row.rating} size="md" />
                    {row.rating != null && <span className="text-zinc-500">{RATING_LABELS[row.rating]}</span>}
                  </span>
                </Dato>
                <Dato titulo="¿Recomendaría la IPS?">
                  <RecommendBadge value={row.wouldRecommend} />
                </Dato>
                <Dato titulo="¿Cómo le fue?">
                  <ExperienceBadge value={row.experience} />
                </Dato>
              </dl>
              {soloEstrellas && (
                <p className="mt-2 text-xs text-zinc-500">
                  Calificó al asistente y no envió las preguntas sobre el hospital. Puede completarlas mientras el enlace
                  esté vigente (24 horas desde el envío).
                </p>
              )}
              {anterior && (
                <p className="mt-2 text-xs text-zinc-500">
                  Respondida antes de que la encuesta tuviera las preguntas sobre la IPS: solo trae las estrellas.
                </p>
              )}
            </section>
          )}

          {respondida && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Comentario</h3>
              {row.message ? (
                <blockquote className="whitespace-pre-wrap break-words rounded-xl border-l-4 border-blue-300 bg-blue-50/50 p-3 text-sm text-zinc-800 dark:border-blue-700 dark:bg-blue-900/10 dark:text-zinc-100">
                  {row.message}
                </blockquote>
              ) : (
                <p className="text-sm text-zinc-400">No dejó comentario.</p>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Contexto</h3>
            <dl>
              <Dato titulo="Gestión">
                <ResolutionBadge status={row.resolutionStatus} />
              </Dato>
              <Dato titulo="Enviada">{formatAppointmentLong(row.createdAt)}</Dato>
              {row.answeredAt && <Dato titulo="Respondida">{formatAppointmentLong(row.answeredAt)}</Dato>}
              {row.organizationName && <Dato titulo="Clínica">{row.organizationName}</Dato>}
              {row.cedula !== undefined && <Dato titulo="Cédula">{row.cedula || '—'}</Dato>}
              {row.chatSummary !== undefined && <Dato titulo="Resumen del chat">{row.chatSummary || '—'}</Dato>}
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}
