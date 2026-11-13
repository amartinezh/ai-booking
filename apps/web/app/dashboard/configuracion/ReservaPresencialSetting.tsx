'use client';

import { useState, useTransition } from 'react';
import { Hospital } from 'lucide-react';
import { getMyReservaPresencialResumen, setMyBotAgendaSharePercent } from '@/app/actions/settings';
import type { ResumenDeLaReserva } from '@/lib/reserva-presencial/resumen';
import { formatAppointmentCompact } from '@/lib/date';
import { DIAS_SEMANA, RESERVA_PRESENCIAL, diaDeLaSemana, partesDeFecha, sumarDiasAFecha } from '@agenia/shared';

/**
 * 🏥 Reserva para la atención presencial (2026-11-13): qué parte de la agenda de
 * cada médico, cada día, puede tomar el asistente; el resto queda para agendar
 * en el hospital. Guarda al instante, como el plazo; si falla, vuelve a lo que de
 * verdad quedó. Debajo, cómo van los próximos días con el porcentaje guardado.
 */
export default function ReservaPresencialSetting({
    initialPorcentaje,
    resumenInicial = null,
}: {
    initialPorcentaje: number | null;
    resumenInicial?: ResumenDeLaReserva | null;
}) {
    const [porcentaje, setPorcentaje] = useState<number | null>(initialPorcentaje);
    const [resumen, setResumen] = useState<ResumenDeLaReserva | null>(resumenInicial);
    const [error, setError] = useState<string | null>(null);
    const [guardado, setGuardado] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Un valor guardado que no esté entre las opciones se muestra igual, para no
    // ocultar lo que de verdad aplica.
    const opciones: number[] =
        porcentaje === null || (RESERVA_PRESENCIAL.OPCIONES as readonly number[]).includes(porcentaje)
            ? [...RESERVA_PRESENCIAL.OPCIONES]
            : [...RESERVA_PRESENCIAL.OPCIONES, porcentaje].sort((a, b) => a - b);

    const cambiar = (next: number | null) => {
        const antes = porcentaje;
        setPorcentaje(next);
        setError(null);
        setGuardado(false);
        startTransition(async () => {
            const res = await setMyBotAgendaSharePercent(next);
            if (res.success) {
                setPorcentaje(res.botAgendaSharePercent ?? null);
                setGuardado(true);
                setTimeout(() => setGuardado(false), 3000);
                // Cómo quedan los próximos días con el porcentaje nuevo. Si no se
                // puede leer, la tabla anterior ya no vale: se quita.
                let r: Awaited<ReturnType<typeof getMyReservaPresencialResumen>> | null = null;
                try {
                    r = await getMyReservaPresencialResumen();
                } catch {
                    r = null;
                }
                setResumen(r?.success ? r.resumen : null);
            } else {
                setPorcentaje(antes);
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl p-2.5 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                    <Hospital className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                        Parte de la agenda para el asistente
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Qué porcentaje de la agenda de <strong>cada médico, cada día</strong>, puede tomar el asistente.
                        El resto queda reservado para agendar en el hospital (ventanilla o teléfono), para quien no
                        usa el chat. El cambio aplica de inmediato.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <select
                        aria-label="Parte de la agenda para el asistente"
                        value={porcentaje ?? ''}
                        disabled={isPending}
                        onChange={(e) => cambiar(e.target.value === '' ? null : Number(e.target.value))}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:opacity-50"
                    >
                        <option value="">Sin reserva</option>
                        {opciones.map((p) => (
                            <option key={p} value={p}>
                                {p} % para el asistente
                            </option>
                        ))}
                    </select>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white" role="status">
                        {isPending
                            ? 'Guardando…'
                            : porcentaje === null
                              ? 'Sin reserva: el asistente puede tomar cualquier cupo libre'
                              : `El asistente agenda como mucho el ${porcentaje} % de cada día de cada médico; el ${100 - porcentaje} % queda para el hospital`}
                        {guardado && !isPending && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ Guardado</span>
                        )}
                    </p>
                </div>

                {resumen && !isPending && <ProximosDias resumen={resumen} />}

                <ul className="text-sm text-zinc-500 dark:text-zinc-400 list-disc pl-5 space-y-1">
                    <li>
                        Con 80 %, un médico con 20 cupos un día: el asistente agenda hasta 16 citas; los otros 4 cupos
                        solo se agendan en el hospital. Se redondea a favor del hospital: con 7 cupos, 5 por el
                        asistente; una agenda de un solo cupo queda para el hospital.
                    </li>
                    <li>
                        Cuentan las citas vigentes que dio el asistente a ese médico ese día. Si el hospital agenda
                        más de su parte, lo toma de lo que el asistente no había agendado.
                    </li>
                    <li>
                        Cuando el asistente llega a su parte con todos los médicos, le dice al paciente que por ese
                        medio ya no quedan cupos y le ofrece la lista de espera.
                    </li>
                    <li>Aplica al agendar, al cambiar la fecha de una cita y a la lista de espera.</li>
                </ul>
                <p className="text-xs text-zinc-400">
                    Solo el asistente (WhatsApp y Telegram): el personal agenda desde el panel y el hospital en su
                    sistema sin tope, el sistema del hospital no cambia y las citas ya agendadas se conservan aunque
                    se baje el porcentaje.
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

/** Por día: cupos de la agenda, tope y citas del asistente, citas del hospital y libres. */
function ProximosDias({ resumen }: { resumen: ResumenDeLaReserva }) {
    if (resumen.dias.length === 0) {
        return (
            <p role="note" className="text-sm text-zinc-500 dark:text-zinc-400">
                No hay agenda cargada para los próximos días de los médicos que agendan por el asistente.
            </p>
        );
    }
    const conReserva = resumen.porcentaje !== null;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <caption className="text-left text-sm text-zinc-700 dark:text-zinc-300 mb-2">
                    Próximos días, médicos que agendan por el asistente
                </caption>
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Día</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold text-right">Cupos</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold text-right">
                            {conReserva ? 'Asistente (lleva / tope)' : 'Asistente'}
                        </th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold text-right">Hospital</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold text-right">Libres</th>
                        {conReserva && <th scope="col" className="py-1.5 font-semibold">Estado</th>}
                    </tr>
                </thead>
                <tbody className="text-zinc-700 dark:text-zinc-300">
                    {resumen.dias.map((d) => (
                        <tr key={d.dia} className="border-t border-zinc-100 dark:border-zinc-800">
                            <th scope="row" className="py-1.5 pr-3 font-medium text-left whitespace-nowrap">
                                {etiquetaDia(d.dia, resumen.hoy)}
                            </th>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{d.capacidad}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                                {conReserva ? `${d.chat} / ${d.tope}` : d.chat}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{d.otras}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{d.libres}</td>
                            {conReserva && (
                                <td className="py-1.5 text-xs">
                                    {d.medicosEnElTope === 0
                                        ? 'El asistente puede agendar'
                                        : d.medicosEnElTope === d.medicos
                                          ? 'El asistente ya tomó su parte'
                                          : `${d.medicosEnElTope} de ${d.medicos} médicos en su tope`}
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
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
