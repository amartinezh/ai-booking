'use client';

import { useMemo, useState } from 'react';
import AdminTicketRow, { type AdminTicket } from './AdminTicketRow';

type Filter = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export default function SupportAdminClient({
    tickets,
    showAll,
}: {
    tickets: AdminTicket[];
    showAll: boolean;
}) {
    const [filter, setFilter] = useState<Filter>('ALL');
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return tickets.filter((t) => {
            if (filter !== 'ALL' && t.status !== filter) return false;
            if (!q) return true;
            return (
                t.title.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q) ||
                t.organization.name.toLowerCase().includes(q) ||
                t.reporter.email.toLowerCase().includes(q)
            );
        });
    }, [tickets, filter, query]);

    const counts = useMemo(() => {
        return tickets.reduce(
            (acc, t) => {
                acc[t.status]++;
                return acc;
            },
            { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 } as Record<string, number>,
        );
    }, [tickets]);

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Mesa de Ayuda — Global</h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        Tickets reportados por las clínicas del SaaS. Tomá la atención y deja un informe claro al cerrar.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <a
                        href={showAll ? '/super-admin/support' : '/super-admin/support?view=all'}
                        className="px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 ring-1 ring-inset ring-indigo-200 rounded-lg transition-colors"
                    >
                        {showAll ? 'Ver solo activos' : 'Ver todos (incl. solucionados)'}
                    </a>
                </div>
            </header>

            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                    onClick={() => setFilter(filter === 'OPEN' ? 'ALL' : 'OPEN')}
                    className={`text-left bg-white rounded-xl p-4 ring-1 transition-all ${
                        filter === 'OPEN' ? 'ring-slate-500 shadow-md' : 'ring-zinc-200 hover:ring-slate-300'
                    }`}
                >
                    <p className="text-xs font-medium text-zinc-500">Abiertos (sin tomar)</p>
                    <p className="text-2xl font-bold text-slate-700 mt-1">{counts.OPEN}</p>
                </button>
                <button
                    onClick={() => setFilter(filter === 'IN_PROGRESS' ? 'ALL' : 'IN_PROGRESS')}
                    className={`text-left bg-white rounded-xl p-4 ring-1 transition-all ${
                        filter === 'IN_PROGRESS' ? 'ring-yellow-500 shadow-md' : 'ring-yellow-200 hover:ring-yellow-300'
                    }`}
                >
                    <p className="text-xs font-medium text-yellow-700">En atención</p>
                    <p className="text-2xl font-bold text-yellow-800 mt-1">{counts.IN_PROGRESS}</p>
                </button>
                <button
                    onClick={() => setFilter(filter === 'RESOLVED' ? 'ALL' : 'RESOLVED')}
                    disabled={!showAll && counts.RESOLVED === 0}
                    className={`text-left bg-white rounded-xl p-4 ring-1 transition-all ${
                        filter === 'RESOLVED' ? 'ring-green-500 shadow-md' : 'ring-green-200 hover:ring-green-300'
                    } disabled:opacity-50 disabled:hover:ring-green-200 disabled:cursor-not-allowed`}
                >
                    <p className="text-xs font-medium text-green-700">Solucionados</p>
                    <p className="text-2xl font-bold text-green-800 mt-1">{counts.RESOLVED}</p>
                </button>
            </section>

            <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-400">
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
                        <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z" />
                    </svg>
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por título, clínica, usuario o contenido..."
                    className="block w-full p-2.5 pl-10 text-sm text-zinc-900 border border-zinc-300 rounded-lg bg-white focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>

            <section className="space-y-4">
                {filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl ring-1 ring-zinc-200 p-10 text-center">
                        <div className="text-4xl mb-3">✅</div>
                        <h3 className="text-base font-semibold text-zinc-900">
                            {tickets.length === 0
                                ? 'No hay tickets en este momento'
                                : 'Ningún ticket coincide con tu búsqueda'}
                        </h3>
                        <p className="text-sm text-zinc-500 mt-1">
                            {tickets.length === 0
                                ? 'Cuando una clínica reporte una falla aparecerá aquí.'
                                : 'Ajustá los filtros o limpiá la búsqueda.'}
                        </p>
                    </div>
                ) : (
                    filtered.map((t) => <AdminTicketRow key={t.id} ticket={t} />)
                )}
            </section>
        </div>
    );
}
