import { SupportTicketStatus } from '@antigravity/database';
import { formatAppointmentShort } from '@/lib/date';

const fmt = (d: Date | string) => formatAppointmentShort(d);

export default function StatusBadge({
    status,
    startedAt,
}: {
    status: SupportTicketStatus;
    startedAt?: Date | string | null;
}) {
    if (status === 'OPEN') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                Abierto
            </span>
        );
    }

    if (status === 'IN_PROGRESS') {
        return (
            <div className="inline-flex flex-col items-start gap-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                    En atención
                </span>
                {startedAt && (
                    <span className="text-[11px] font-medium text-yellow-700">
                        En atención desde: {fmt(startedAt)}
                    </span>
                )}
            </div>
        );
    }

    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 ring-1 ring-inset ring-green-300">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Solucionado
        </span>
    );
}
