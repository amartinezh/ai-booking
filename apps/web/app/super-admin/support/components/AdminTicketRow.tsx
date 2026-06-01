/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useTransition } from 'react';
import StatusBadge from '../../../dashboard/soporte/components/StatusBadge';
import { startTicketAttention } from '@/app/actions/support';
import ResolveTicketModal from './ResolveTicketModal';
import BrandLogo from '@/app/components/BrandLogo';
import { formatAppointmentShort } from '@/lib/date';

const fmt = (d: Date | string) => formatAppointmentShort(d);

export type AdminTicket = {
    id: string;
    title: string;
    description: string;
    status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
    startedAt: Date | string | null;
    resolvedAt: Date | string | null;
    resolutionNote: string | null;
    createdAt: Date | string;
    reporter: { email: string; role: string };
    organization: { id: string; name: string; logoUrl: string | null };
};

export default function AdminTicketRow({ ticket }: { ticket: AdminTicket }) {
    const [expanded, setExpanded] = useState(false);
    const [modal, setModal] = useState<null | 'resolve' | 'edit'>(null);
    const [isPending, startTransition] = useTransition();

    const handleStart = () => {
        startTransition(async () => {
            const res = await startTicketAttention(ticket.id);
            if (!res.success) alert(res.error);
        });
    };

    return (
        <>
            <article className="bg-white rounded-2xl ring-1 ring-zinc-200 shadow-sm p-5">
                <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="inline-flex items-center gap-2 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold ring-1 ring-inset ring-indigo-200">
                                {ticket.organization.logoUrl ? (
                                    <img src={ticket.organization.logoUrl} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
                                ) : (
                                    <BrandLogo size={14} alt={ticket.organization.name} />
                                )}
                                {ticket.organization.name}
                            </span>
                            <span className="text-xs text-zinc-500">·</span>
                            <span className="text-xs text-zinc-600">
                                Reportado por <span className="font-medium text-zinc-800">{ticket.reporter.email}</span>
                            </span>
                            <span className="text-xs text-zinc-400">({ticket.reporter.role})</span>
                        </div>
                        <h3 className="text-base font-semibold text-zinc-900">{ticket.title}</h3>
                        <p className="text-xs text-zinc-500 mt-0.5">Creado el {fmt(ticket.createdAt)}</p>
                    </div>
                    <div className="shrink-0">
                        <StatusBadge status={ticket.status} startedAt={ticket.startedAt} />
                    </div>
                </header>

                <p className={`mt-3 text-sm text-zinc-700 whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>
                    {ticket.description}
                </p>
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
                >
                    {expanded ? 'Ver menos' : 'Ver detalles completos'}
                </button>

                {ticket.status === 'RESOLVED' && ticket.resolutionNote && (
                    <div className="mt-4 p-4 rounded-xl bg-green-50 ring-1 ring-green-200">
                        <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">
                                Respuesta enviada {ticket.resolvedAt && `· ${fmt(ticket.resolvedAt)}`}
                            </p>
                        </div>
                        <p className="text-sm text-green-900 whitespace-pre-line">{ticket.resolutionNote}</p>
                    </div>
                )}

                <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-100">
                    <span className="text-[11px] font-mono text-zinc-400">#{ticket.id.slice(0, 8)}</span>

                    <div className="flex flex-wrap gap-2">
                        {ticket.status === 'OPEN' && (
                            <button
                                type="button"
                                onClick={handleStart}
                                disabled={isPending}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-yellow-900 bg-yellow-100 hover:bg-yellow-200 ring-1 ring-inset ring-yellow-300 disabled:opacity-50 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M6.3 2.84A1 1 0 004 3.7v12.6a1 1 0 001.5.86l11-6.3a1 1 0 000-1.72l-11-6.3z" />
                                </svg>
                                Iniciar atención
                            </button>
                        )}

                        {ticket.status === 'IN_PROGRESS' && (
                            <button
                                type="button"
                                onClick={() => setModal('resolve')}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path
                                        fillRule="evenodd"
                                        d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0L3.3 10.7a1 1 0 011.4-1.4l3.3 3.3 7.3-7.3a1 1 0 011.4 0z"
                                        clipRule="evenodd"
                                    />
                                </svg>
                                Marcar Solucionado
                            </button>
                        )}

                        {ticket.status === 'RESOLVED' && (
                            <button
                                type="button"
                                onClick={() => setModal('edit')}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 ring-1 ring-inset ring-indigo-200 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                                Editar respuesta
                            </button>
                        )}
                    </div>
                </footer>
            </article>

            {modal && (
                <ResolveTicketModal
                    ticketId={ticket.id}
                    mode={modal}
                    initialNote={modal === 'edit' ? ticket.resolutionNote : ''}
                    onClose={() => setModal(null)}
                />
            )}
        </>
    );
}
