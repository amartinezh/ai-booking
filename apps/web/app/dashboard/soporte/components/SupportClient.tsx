'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import type { SupportTicket } from '@agenia/database';
import type { EstadoAsistente } from '@/app/actions/support-bot.types';
import NewTicketModal from './NewTicketModal';
import TicketCard from './TicketCard';
import AsistenteTelegramCard from './AsistenteTelegramCard';

export default function SupportClient({
    tickets,
    mostrarAyuda = false,
    asistente = null,
}: {
    tickets: SupportTicket[];
    /** Botón al centro de ayuda. Por ahora solo para el administrador de la clínica. */
    mostrarAyuda?: boolean;
    /** El asistente de soporte por Telegram; sin él (o apagado) no hay tarjeta. */
    asistente?: EstadoAsistente | null;
}) {
    const [isOpen, setIsOpen] = useState(false);

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
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Soporte / Ayuda</h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        Reporta una falla o solicítale algo al equipo técnico. Aquí verás el estado de cada solicitud.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {mostrarAyuda && (
                        <Link
                            href="/dashboard/soporte/ayuda"
                            title="Guías de cada opción del menú, con buscador"
                            className="inline-flex items-center gap-2 bg-white hover:bg-zinc-50 text-zinc-800 ring-1 ring-zinc-200 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors"
                        >
                            <BookOpen className="w-4 h-4 text-blue-600" />
                            Ayuda
                        </Link>
                    )}
                    <button
                        onClick={() => setIsOpen(true)}
                        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                            className="w-4 h-4"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Reportar Falla / Nueva Solicitud
                    </button>
                </div>
            </header>

            {asistente?.disponible && <AsistenteTelegramCard estadoInicial={asistente} />}

            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white rounded-xl ring-1 ring-zinc-200 p-4">
                    <p className="text-xs font-medium text-zinc-500">Abiertas</p>
                    <p className="text-2xl font-bold text-slate-700 mt-1">{counts.OPEN}</p>
                </div>
                <div className="bg-white rounded-xl ring-1 ring-yellow-200 p-4">
                    <p className="text-xs font-medium text-yellow-700">En atención</p>
                    <p className="text-2xl font-bold text-yellow-800 mt-1">{counts.IN_PROGRESS}</p>
                </div>
                <div className="bg-white rounded-xl ring-1 ring-green-200 p-4">
                    <p className="text-xs font-medium text-green-700">Solucionadas</p>
                    <p className="text-2xl font-bold text-green-800 mt-1">{counts.RESOLVED}</p>
                </div>
            </section>

            <section>
                {tickets.length === 0 ? (
                    <div className="bg-white rounded-2xl ring-1 ring-zinc-200 p-10 text-center">
                        <div className="text-4xl mb-3">🛟</div>
                        <h3 className="text-base font-semibold text-zinc-900">Aún no has reportado nada</h3>
                        <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
                            Si algo no funciona como esperas o necesitas apoyo del equipo técnico, abre tu primera
                            solicitud desde el botón de arriba.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {tickets.map((t) => (
                            <TicketCard key={t.id} ticket={t} />
                        ))}
                    </div>
                )}
            </section>

            <NewTicketModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </div>
    );
}
