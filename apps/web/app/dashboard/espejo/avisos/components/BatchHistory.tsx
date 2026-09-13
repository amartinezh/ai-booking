'use client';

import { formatAppointmentCompact, formatDateShort } from '@/lib/date';
import type { AvisosBatchView } from '@/app/actions/avisos';

const ESTADO_ESTILO: Record<string, string> = {
    BORRADOR: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
    ENVIANDO: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
    ENVIADO: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
    CANCELADO: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
};

/**
 * Historial de lotes. Tan importante como el envío mismo (§6 del plan): es
 * lo único que permite responder "¿a quién le escribimos, cuándo y qué le
 * dijimos?" seis meses después.
 */
export default function BatchHistory({
    batches,
    onOpen,
}: {
    batches: AvisosBatchView[];
    onOpen: (batchId: string) => void;
}) {
    if (batches.length === 0) {
        return (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Todavía no se ha armado ningún aviso.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            {batches.map((b) => (
                <button
                    key={b.id}
                    onClick={() => onOpen(b.id)}
                    className="w-full text-left rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-rose-300 dark:hover:border-rose-800 transition-colors"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {b.doctorLabel ?? 'Sin médico indicado'}
                            </span>
                            {b.serviceLabel && (
                                <span className="ml-2 text-sm text-zinc-500">· {b.serviceLabel}</span>
                            )}
                        </div>
                        <span
                            className={`text-xs font-semibold px-2 py-1 rounded-full ${ESTADO_ESTILO[b.status] ?? ''}`}
                        >
                            {b.status}
                        </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>Citas: {formatAppointmentCompact(b.dateFrom)} – {formatAppointmentCompact(b.dateTo)}</span>
                        <span>Armado: {formatDateShort(b.createdAt)}</span>
                        {b.sentAt && <span>Enviado: {formatDateShort(b.sentAt)}</span>}
                    </div>
                    <div className="mt-2 flex gap-4 text-sm">
                        <span className="text-zinc-700 dark:text-zinc-300">{b.candidates} candidatos</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{b.sent} enviados</span>
                        {b.failed > 0 && (
                            <span className="text-rose-600 dark:text-rose-400">{b.failed} fallidos</span>
                        )}
                        {b.skipped > 0 && (
                            <span className="text-zinc-500">{b.skipped} omitidos</span>
                        )}
                    </div>
                </button>
            ))}
        </div>
    );
}
