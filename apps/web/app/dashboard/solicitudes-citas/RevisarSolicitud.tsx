'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { SOLICITUD_CITAS } from '@agenia/shared';
import { decidirSolicitudCitas } from './actions';

/**
 * Decisión sobre una solicitud PENDIENTE: aprobar (con cuántas citas
 * adicionales y una nota opcional) o rechazar (con el motivo). El listado lo
 * refresca el server component (revalidatePath).
 */
export default function RevisarSolicitud({
    requestId,
    adicionalesPedidas,
    periodo,
}: {
    requestId: string;
    adicionalesPedidas: number | null;
    /** «ese día» o «ese mes», para el texto de ayuda. */
    periodo: string;
}) {
    const [modo, setModo] = useState<'APPROVED' | 'REJECTED' | null>(null);
    const [adicionales, setAdicionales] = useState(
        Math.min(SOLICITUD_CITAS.MAX_ADICIONALES, Math.max(1, adicionalesPedidas ?? 1)),
    );
    const [nota, setNota] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const decidir = () => {
        if (!modo) return;
        setError(null);
        startTransition(async () => {
            const res = await decidirSolicitudCitas(requestId, {
                decision: modo,
                adicionales: modo === 'APPROVED' ? adicionales : undefined,
                nota,
            });
            if (!res.success) setError(res.error);
        });
    };

    if (!modo) {
        return (
            <div className="flex flex-col gap-1.5">
                <button
                    type="button"
                    onClick={() => setModo('APPROVED')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                    <Check className="h-3.5 w-3.5" /> Aprobar
                </button>
                <button
                    type="button"
                    onClick={() => setModo('REJECTED')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 dark:ring-rose-900 transition-colors hover:bg-rose-50 dark:hover:bg-rose-900/20"
                >
                    <X className="h-3.5 w-3.5" /> Rechazar
                </button>
            </div>
        );
    }

    return (
        <div className="w-60 space-y-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs">
            <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                {modo === 'APPROVED' ? 'Aprobar solicitud' : 'Rechazar solicitud'}
            </p>
            {modo === 'APPROVED' && (
                <label className="block">
                    <span className="text-zinc-600 dark:text-zinc-300">Citas adicionales para {periodo}</span>
                    <select
                        value={adicionales}
                        onChange={(e) => setAdicionales(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 dark:text-white"
                    >
                        {Array.from({ length: SOLICITUD_CITAS.MAX_ADICIONALES }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                                {n} {n === 1 ? 'cita' : 'citas'}
                                {n === adicionalesPedidas ? ' (lo que pidió)' : ''}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <label className="block">
                <span className="text-zinc-600 dark:text-zinc-300">
                    {modo === 'APPROVED' ? 'Nota (opcional)' : 'Motivo del rechazo'}
                </span>
                <textarea
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={3}
                    maxLength={SOLICITUD_CITAS.MAX_NOTA_REVISION}
                    placeholder={modo === 'APPROVED' ? 'Ej.: orden de terapia física adjunta' : 'Ej.: no presenta orden médica'}
                    className="mt-1 w-full resize-none rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 dark:text-white"
                />
            </label>
            {modo === 'APPROVED' && (
                <p className="text-[11px] leading-snug text-zinc-500">
                    El asistente le permitirá agendar {adicionales === 1 ? '1 cita más' : `${adicionales} citas más`} para{' '}
                    {periodo}. Avísele al paciente, o agéndele usted desde Agendamiento.
                </p>
            )}
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={decidir}
                    disabled={isPending}
                    className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-50 ${
                        modo === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                    }`}
                >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Confirmar
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setModo(null);
                        setError(null);
                    }}
                    disabled={isPending}
                    className="rounded-lg px-3 py-1.5 font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                >
                    Volver
                </button>
            </div>
        </div>
    );
}
