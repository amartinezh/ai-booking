import type { SupportTicketChannel, SupportTicketPriority } from '@agenia/database';
import { numeroDeCaso } from '@agenia/shared';
import { formatAppointmentShort } from '@/lib/date';

const fmt = (d: Date | string) => formatAppointmentShort(d);

/** Lo que se le agregó a un caso después de abrirlo (hoy, desde el asistente de Telegram). */
export type NotaDelCaso = {
    id: string;
    text: string;
    kind: string;
    channel: SupportTicketChannel;
    createdAt: Date | string;
    author?: { email: string } | null;
};

/** «#58»: como lo nombran el asistente, el grupo del equipo técnico y el panel. */
export function NumeroDelCaso({ numero }: { numero: number }) {
    return <span className="text-[11px] font-mono font-semibold text-zinc-500">{numeroDeCaso(numero)}</span>;
}

/** Prioridad alta (frena la atención de pacientes) y si se abrió por Telegram. */
export function EtiquetasDelCaso({
    channel,
    priority,
}: {
    channel: SupportTicketChannel;
    priority: SupportTicketPriority;
}) {
    if (channel !== 'TELEGRAM' && priority !== 'HIGH') return null;
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            {priority === 'HIGH' && (
                <span
                    title="Frena la atención de pacientes"
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                >
                    Prioridad alta
                </span>
            )}
            {channel === 'TELEGRAM' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200">
                    Por Telegram
                </span>
            )}
        </span>
    );
}

/** Lo que se agregó después de abrir el caso, en orden. */
export function NotasDelCaso({ notas, titulo }: { notas: NotaDelCaso[]; titulo: string }) {
    if (notas.length === 0) return null;
    return (
        <div className="mt-4 p-4 rounded-xl bg-sky-50/60 ring-1 ring-sky-100">
            <p className="text-xs font-semibold text-sky-800 uppercase tracking-wide mb-2">{titulo}</p>
            <ul className="space-y-2">
                {notas.map((n) => (
                    <li key={n.id} className="text-sm text-zinc-800">
                        <p className="text-[11px] text-zinc-500">
                            {fmt(n.createdAt)}
                            {n.channel === 'TELEGRAM' ? ' · por Telegram' : ' · por el panel'}
                            {n.author?.email ? ` · ${n.author.email}` : ''}
                        </p>
                        <p className="whitespace-pre-line">{n.text}</p>
                    </li>
                ))}
            </ul>
        </div>
    );
}
