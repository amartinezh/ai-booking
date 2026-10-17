'use client';

import { useState, useTransition } from 'react';
import { Timer } from 'lucide-react';
import { setMyReminderMinLead } from '@/app/actions/settings';
import { ANTICIPACION_RECORDATORIO, textoAnticipacion } from '@agenia/shared';

/**
 * ⏱️ Anticipación mínima del recordatorio automático (2026-10-17): si a la cita
 * le faltan menos minutos, el cron no la recuerda. Pensado para las citas que el
 * hospital agenda el mismo día, minutos antes, con el paciente ya ahí. Guarda al
 * instante, como los interruptores; si falla, vuelve a lo que de verdad quedó.
 */
export default function ReminderLeadTimeSetting({ initialMinutes }: { initialMinutes: number }) {
    const [minutos, setMinutos] = useState(initialMinutes);
    const [error, setError] = useState<string | null>(null);
    const [guardado, setGuardado] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Un valor guardado que no esté entre las opciones (p. ej. puesto a mano) se
    // muestra igual, para no ocultar lo que de verdad aplica.
    const opciones = ANTICIPACION_RECORDATORIO.OPCIONES.includes(minutos)
        ? ANTICIPACION_RECORDATORIO.OPCIONES
        : [...ANTICIPACION_RECORDATORIO.OPCIONES, minutos].sort((a, b) => a - b);

    const cambiar = (next: number) => {
        const antes = minutos;
        setMinutos(next);
        setError(null);
        setGuardado(false);
        startTransition(async () => {
            const res = await setMyReminderMinLead(next);
            if (res.success) {
                setMinutos(res.reminderMinLeadMinutes ?? next);
                setGuardado(true);
                setTimeout(() => setGuardado(false), 3000);
            } else {
                setMinutos(antes);
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl p-2.5 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                    <Timer className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                        Anticipación mínima del recordatorio
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Si a la cita le falta menos de este tiempo, no se envía el recordatorio automático. El cambio
                        aplica de inmediato.
                    </p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <select
                    aria-label="Anticipación mínima del recordatorio"
                    value={minutos}
                    disabled={isPending}
                    onChange={(e) => cambiar(Number(e.target.value))}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:opacity-50"
                >
                    {opciones.map((m) => (
                        <option key={m} value={m}>
                            {m === 0 ? 'Sin mínimo' : textoAnticipacion(m)}
                        </option>
                    ))}
                </select>
                <div className="text-sm">
                    <p className="font-semibold text-zinc-900 dark:text-white">
                        {isPending
                            ? 'Guardando…'
                            : minutos === 0
                              ? 'Sin mínimo: el recordatorio sale aunque la cita esté por empezar'
                              : `No se recuerdan citas que empiezan en menos de ${textoAnticipacion(minutos)}`}
                        {guardado && !isPending && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ Guardado</span>
                        )}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                        Sirve para las citas que el hospital agenda el mismo día, minutos antes: el paciente ya está
                        ahí y el recordatorio no le aporta nada.
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                        La cita no se marca como recordada: si la mueven a una hora más lejana, el recordatorio puede
                        salir. El botón de recordatorio manual de la agenda no se afecta.
                    </p>
                </div>
            </div>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
        </section>
    );
}
