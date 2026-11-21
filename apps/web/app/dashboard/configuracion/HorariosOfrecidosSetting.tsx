'use client';

import { useState, useTransition } from 'react';
import { CalendarClock } from 'lucide-react';
import { setMySlotsOfferedCount } from '@/app/actions/settings';
import { CUPOS_OFRECIDOS } from '@agenia/shared';

const OPCIONES = Array.from(
    { length: CUPOS_OFRECIDOS.MAX - CUPOS_OFRECIDOS.MIN + 1 },
    (_, i) => CUPOS_OFRECIDOS.MIN + i,
);

/**
 * 🕐 Horarios que ofrece el asistente: cuántas opciones de cita muestra al
 * agendar o al cambiar la fecha. Vive en «Agenda que ofrece el asistente»
 * (docs/PLAN_NAVEGACION.md §5); antes iba dentro del formulario del nombre, con
 * su botón «Guardar». Ahora guarda al instante, como el plazo y la reserva; si
 * falla, vuelve a lo que de verdad quedó.
 */
export default function HorariosOfrecidosSetting({ initialCantidad }: { initialCantidad: number }) {
    const [cantidad, setCantidad] = useState(initialCantidad);
    const [error, setError] = useState<string | null>(null);
    const [guardado, setGuardado] = useState(false);
    const [isPending, startTransition] = useTransition();
    const deManiana = Math.ceil(cantidad / 2);
    const deTarde = cantidad - deManiana;

    const cambiar = (next: number) => {
        const antes = cantidad;
        setCantidad(next);
        setError(null);
        setGuardado(false);
        startTransition(async () => {
            const res = await setMySlotsOfferedCount(next);
            if (res.success) {
                setCantidad(res.slotsOfferedCount ?? next);
                setGuardado(true);
                setTimeout(() => setGuardado(false), 3000);
            } else {
                setCantidad(antes);
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Horarios que ofrece el asistente</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Cuántas opciones de cita muestra el asistente cuando el paciente agenda o cambia la fecha. Se
                        reparten entre mañana y tarde, empezando por las más próximas. El cambio aplica de inmediato.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center">
                <select
                    aria-label="Horarios que ofrece el asistente"
                    value={cantidad}
                    disabled={isPending}
                    onChange={(e) => cambiar(Number(e.target.value))}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                    {OPCIONES.map((n) => (
                        <option key={n} value={n}>
                            {n} opciones{n === CUPOS_OFRECIDOS.DEFAULT ? ' (recomendado)' : ''}
                        </option>
                    ))}
                </select>
                <div className="text-sm">
                    <p className="font-semibold text-zinc-900 dark:text-white">
                        {isPending ? 'Guardando…' : `${deManiana} de la mañana y ${deTarde} de la tarde`}
                        {guardado && !isPending && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ Guardado</span>
                        )}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                        Si una franja no tiene suficientes, la otra completa.
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
