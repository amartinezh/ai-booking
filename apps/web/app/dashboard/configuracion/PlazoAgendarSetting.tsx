'use client';

import { useState, useTransition } from 'react';
import { CalendarRange } from 'lucide-react';
import { getMyPlazoAgendarResumen, setMyBookingMaxDaysAhead } from '@/app/actions/settings';
import type { ResumenDelPlazo } from '@/lib/plazo-agendar/resumen';
import { formatAppointmentCompact } from '@/lib/date';
import {
    DIAS_SEMANA,
    PLAZO_AGENDAR,
    diaDeLaSemana,
    fechaEnPalabras,
    partesDeFecha,
    sumarDiasAFecha,
    textoPlazoAgendar,
    ultimoDiaParaAgendar,
} from '@agenia/shared';

/**
 * 🗓️ Plazo máximo para agendar por el asistente (2026-10-23): hasta cuántos días
 * adelante, contando hoy, ofrece citas. Con fechas reales para que no haya duda
 * de qué significa «3 días». Guarda al instante, como los interruptores; si
 * falla, vuelve a lo que de verdad quedó.
 *
 * Avisa cuando el plazo deja al asistente sin cupos que ofrecer hoy, y muestra
 * quién lo cambió por última vez (2026-10-23).
 */
export default function PlazoAgendarSetting({
    initialDias,
    hoy,
    resumenInicial = null,
}: {
    initialDias: number | null;
    hoy: string;
    resumenInicial?: ResumenDelPlazo | null;
}) {
    const [dias, setDias] = useState<number | null>(initialDias);
    const [resumen, setResumen] = useState<ResumenDelPlazo | null>(resumenInicial);
    const [error, setError] = useState<string | null>(null);
    const [guardado, setGuardado] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Un valor guardado que no esté entre las opciones se muestra igual, para no
    // ocultar lo que de verdad aplica.
    const opciones: number[] =
        dias === null || (PLAZO_AGENDAR.OPCIONES as readonly number[]).includes(dias)
            ? [...PLAZO_AGENDAR.OPCIONES]
            : [...PLAZO_AGENDAR.OPCIONES, dias].sort((a, b) => a - b);

    const cambiar = (next: number | null) => {
        const antes = dias;
        setDias(next);
        setError(null);
        setGuardado(false);
        startTransition(async () => {
            const res = await setMyBookingMaxDaysAhead(next);
            if (res.success) {
                setDias(res.bookingMaxDaysAhead ?? null);
                setGuardado(true);
                setTimeout(() => setGuardado(false), 3000);
                // Lo que el plazo nuevo deja ofrecer hoy. Si no se puede leer, el
                // aviso anterior ya no vale: se quita.
                let r: Awaited<ReturnType<typeof getMyPlazoAgendarResumen>> | null = null;
                try {
                    r = await getMyPlazoAgendarResumen();
                } catch {
                    r = null;
                }
                setResumen(r?.success ? r.resumen : null);
            } else {
                setDias(antes);
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    const ultimo = ultimoDiaParaAgendar(hoy, dias);

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl p-2.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                    <CalendarRange className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Plazo máximo para agendar</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Hasta cuántos días adelante ofrece citas el asistente, para que nadie agende para una fecha
                        muy lejana. Los días se cuentan <strong>desde hoy, incluido</strong>. El cambio aplica de
                        inmediato.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <select
                        aria-label="Plazo máximo para agendar"
                        value={dias ?? ''}
                        disabled={isPending}
                        onChange={(e) => cambiar(e.target.value === '' ? null : Number(e.target.value))}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:opacity-50"
                    >
                        <option value="">Sin límite</option>
                        {opciones.map((d) => (
                            <option key={d} value={d}>
                                {textoPlazoAgendar(d)}
                            </option>
                        ))}
                    </select>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white" role="status">
                        {isPending
                            ? 'Guardando…'
                            : ultimo === null
                              ? 'Sin límite: el asistente ofrece las citas más próximas, sin importar la fecha'
                              : `El asistente ofrece citas hasta el ${fechaEnPalabras(ultimo, { conAnio: false })}`}
                        {guardado && !isPending && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ Guardado</span>
                        )}
                    </p>
                </div>

                {ultimo !== null && dias !== null && <Ejemplo hoy={hoy} dias={dias} ultimo={ultimo} />}

                {resumen && !isPending && <CuposDeHoy resumen={resumen} />}

                <ul className="text-sm text-zinc-500 dark:text-zinc-400 list-disc pl-5 space-y-1">
                    <li>
                        Con 3 días: hoy, mañana y pasado mañana. Cada día que pasa se abre uno nuevo.
                    </li>
                    <li>
                        Cuenta la fecha de la cita, no la del mensaje. Si el paciente pide una fecha más lejana, el
                        asistente le ofrece las más próximas dentro del plazo.
                    </li>
                    <li>Aplica al agendar, al cambiar la fecha de una cita y a la lista de espera.</li>
                </ul>
                <p className="text-xs text-zinc-400">
                    Solo el asistente (WhatsApp y Telegram): el personal agenda desde el panel y el hospital en su
                    sistema para cualquier fecha, y las citas ya agendadas no cambian.
                </p>
            </div>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
            {resumen?.ultimoCambio && (
                <p className="mt-2 text-xs text-zinc-400">
                    Último cambio: {resumen.ultimoCambio.detalle} ·{' '}
                    {formatAppointmentCompact(new Date(resumen.ultimoCambio.en))}
                </p>
            )}
        </section>
    );
}

/** Cuántos cupos puede ofrecer hoy el asistente con el plazo guardado; y si ninguno, por qué y cómo arreglarlo. */
function CuposDeHoy({ resumen }: { resumen: ResumenDelPlazo }) {
    const en = (fecha: string | null) => (fecha ? fechaEnPalabras(fecha, { conAnio: false }) : '');
    if (resumen.total === 0) {
        return (
            <p role="note" className="text-sm text-zinc-500 dark:text-zinc-400">
                Hoy el asistente no tiene cupos libres que ofrecer, con o sin plazo: la agenda está llena o no hay
                agenda cargada.
            </p>
        );
    }
    if (resumen.enElPlazo === 0) {
        return (
            <div
                role="note"
                className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200"
            >
                <p className="font-semibold">⚠️ Con este plazo, hoy el asistente no tiene cupos que ofrecer.</p>
                <p className="mt-1">
                    El primer cupo libre es el {en(resumen.primerDia)}: lo verán quienes escriban desde el{' '}
                    {en(resumen.desde)}. Mientras tanto, a quien pida cita el asistente le dirá que por ahora se agenda
                    hasta el {en(resumen.ultimoDia)} y que escriba desde el {en(resumen.desde)}.
                </p>
                {resumen.plazoMinimo !== null && (
                    <p className="mt-1">
                        Para ofrecerlo desde hoy, el plazo debe ser de al menos {resumen.plazoMinimo} días.
                    </p>
                )}
            </div>
        );
    }
    return (
        <p role="note" className="text-sm text-zinc-500 dark:text-zinc-400">
            Hoy el asistente puede ofrecer {resumen.enElPlazo} {resumen.enElPlazo === 1 ? 'cupo libre' : 'cupos libres'}
            {resumen.enElPlazo < resumen.total ? ` dentro del plazo (de ${resumen.total} que hay)` : ''}.
        </p>
    );
}

/** Los días de hoy en adelante, en fila: cuáles se ofrecen y desde cuál ya no. */
function Ejemplo({ hoy, dias, ultimo }: { hoy: string; dias: number; ultimo: string }) {
    const primeroFuera = sumarDiasAFecha(ultimo, 1);
    // Con un plazo largo, los dos primeros días, «…», el último y el primero fuera.
    const dentro =
        dias <= 6
            ? Array.from({ length: dias }, (_, i) => sumarDiasAFecha(hoy, i))
            : [hoy, sumarDiasAFecha(hoy, 1), null, ultimo];

    return (
        <div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">
                Hoy es {fechaEnPalabras(hoy, { conAnio: false })}: se ofrecen citas hasta el{' '}
                <strong>{fechaEnPalabras(ultimo, { conAnio: false })}</strong>; desde el{' '}
                <strong>{fechaEnPalabras(primeroFuera, { conAnio: false })}</strong>, no.
            </p>
            <ol aria-label="Días en que el asistente ofrece citas" className="flex flex-wrap items-center gap-2">
                {dentro.map((fecha, i) =>
                    fecha === null ? (
                        <li key={`hueco-${i}`} aria-hidden className="px-1 text-zinc-400">
                            …
                        </li>
                    ) : (
                        <li
                            key={fecha}
                            className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
                        >
                            ✓ {etiquetaDia(fecha, hoy)}
                        </li>
                    ),
                )}
                <li className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-400 line-through">
                    {etiquetaDia(primeroFuera, hoy)}
                </li>
            </ol>
        </div>
    );
}

/** «Hoy», «Mañana» o «lun 26». */
function etiquetaDia(fecha: string, hoy: string): string {
    if (fecha === hoy) return 'Hoy';
    if (fecha === sumarDiasAFecha(hoy, 1)) return 'Mañana';
    const dia = partesDeFecha(fecha)?.[2];
    return `${DIAS_SEMANA[diaDeLaSemana(fecha)].slice(0, 3)} ${dia}`;
}
