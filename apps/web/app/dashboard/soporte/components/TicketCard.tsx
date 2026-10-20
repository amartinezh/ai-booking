'use client';

import { useState } from 'react';
import type { SupportTicket } from '@agenia/database';
import StatusBadge from './StatusBadge';
import { formatAppointmentShort } from '@/lib/date';
import { EtiquetasDelCaso, NotasDelCaso, NumeroDelCaso, type NotaDelCaso } from './CasoDetalles';

const fmt = (d: Date | string) => formatAppointmentShort(d);

/** El caso con lo que se le agregó después (desde el asistente de Telegram). */
export type CasoConNotas = SupportTicket & { notes?: NotaDelCaso[] };

export default function TicketCard({ ticket }: { ticket: CasoConNotas }) {
    const [expanded, setExpanded] = useState(ticket.status === 'RESOLVED' ? false : false);

    const ringByStatus =
        ticket.status === 'RESOLVED'
            ? 'ring-green-200'
            : ticket.status === 'IN_PROGRESS'
                ? 'ring-yellow-200'
                : 'ring-zinc-200';

    return (
        <article
            className={`bg-white rounded-2xl ring-1 ${ringByStatus} shadow-sm hover:shadow-md transition-all p-5`}
        >
            <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-zinc-900 truncate" title={ticket.title}>
                        {ticket.title}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                        Reportado el {fmt(ticket.createdAt)}
                    </p>
                    <div className="mt-1.5">
                        <EtiquetasDelCaso channel={ticket.channel} priority={ticket.priority} />
                    </div>
                </div>
                <div className="shrink-0">
                    <StatusBadge status={ticket.status} startedAt={ticket.startedAt} />
                </div>
            </header>

            <p className={`mt-3 text-sm text-zinc-700 whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>
                {ticket.description}
            </p>

            <NotasDelCaso notas={ticket.notes ?? []} titulo="Lo que agregaste después" />

            {ticket.status === 'RESOLVED' && ticket.resolutionNote && (
                <div className="mt-4 p-4 rounded-xl bg-green-50 ring-1 ring-green-200">
                    <div className="flex items-center gap-2 mb-1.5">
                        <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                            <path
                                fillRule="evenodd"
                                d="M16.704 5.296a1 1 0 010 1.414l-7.99 7.99a1 1 0 01-1.415 0L3.296 10.7a1 1 0 011.414-1.414l3.293 3.293 7.283-7.283a1 1 0 011.418 0z"
                                clipRule="evenodd"
                            />
                        </svg>
                        <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">
                            Respuesta del equipo de soporte
                        </p>
                        {ticket.resolvedAt && (
                            <span className="text-[11px] text-green-700">· {fmt(ticket.resolvedAt)}</span>
                        )}
                    </div>
                    <p className="text-sm text-green-900 whitespace-pre-line">{ticket.resolutionNote}</p>
                </div>
            )}

            <footer className="mt-3 flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                >
                    {expanded ? 'Ver menos' : 'Ver detalles completos'}
                </button>
                <NumeroDelCaso numero={ticket.number} />
            </footer>
        </article>
    );
}
