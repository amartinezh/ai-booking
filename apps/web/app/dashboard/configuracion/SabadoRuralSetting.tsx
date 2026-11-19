'use client';

import { useState, useTransition } from 'react';
import { Wheat } from 'lucide-react';
import { getMySabadoRuralEstado, setMySaturdayRuralSharePercent } from '@/app/actions/settings';
import type { EstadoSabadoRural } from '@/lib/sabado-rural/estado';
import { formatAppointmentCompact } from '@/lib/date';
import { SABADO_RURAL } from '@agenia/shared';

/**
 * 🌾 Sábados por el asistente (2026-11-19): con «Solo zona rural», el asistente
 * agenda los sábados solo a pacientes que el hospital tiene con zona de
 * residencia rural, y como mucho el porcentaje elegido de la agenda de cada
 * médico ese día. Guarda al instante, como el plazo; si falla, vuelve a lo que
 * de verdad quedó. Debajo, si ya llegó la lista de pacientes rurales y si los
 * sábados siguen cerrados en «Días sin citas».
 */
export default function SabadoRuralSetting({
    initialPorcentaje,
    estadoInicial = null,
}: {
    initialPorcentaje: number | null;
    estadoInicial?: EstadoSabadoRural | null;
}) {
    const [porcentaje, setPorcentaje] = useState<number | null>(initialPorcentaje);
    const [estado, setEstado] = useState<EstadoSabadoRural | null>(estadoInicial);
    const [error, setError] = useState<string | null>(null);
    const [guardado, setGuardado] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Un valor guardado que no esté entre las opciones se muestra igual, para no
    // ocultar lo que de verdad aplica.
    const opciones: number[] =
        porcentaje === null || (SABADO_RURAL.OPCIONES as readonly number[]).includes(porcentaje)
            ? [...SABADO_RURAL.OPCIONES]
            : [...SABADO_RURAL.OPCIONES, porcentaje].sort((a, b) => a - b);

    const cambiar = (next: number | null) => {
        const antes = porcentaje;
        setPorcentaje(next);
        setError(null);
        setGuardado(false);
        startTransition(async () => {
            const res = await setMySaturdayRuralSharePercent(next);
            if (res.success) {
                setPorcentaje(res.saturdayRuralSharePercent ?? null);
                setGuardado(true);
                setTimeout(() => setGuardado(false), 3000);
                let r: Awaited<ReturnType<typeof getMySabadoRuralEstado>> | null = null;
                try {
                    r = await getMySabadoRuralEstado();
                } catch {
                    r = null;
                }
                setEstado(r?.success ? r.estado : null);
            } else {
                setPorcentaje(antes);
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl p-2.5 bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-400">
                    <Wheat className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Sábados por el asistente</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Con <strong>Solo zona rural</strong>, el asistente agenda los sábados únicamente a pacientes que
                        el hospital tiene con zona de residencia <strong>rural</strong> (el campo «Zona» de su ficha), y
                        como mucho el porcentaje elegido de la agenda de cada médico ese día. Los demás días no cambian.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <select
                        aria-label="Sábados por el asistente"
                        value={porcentaje ?? ''}
                        disabled={isPending}
                        onChange={(e) => cambiar(e.target.value === '' ? null : Number(e.target.value))}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:opacity-50"
                    >
                        <option value="">Sin regla especial</option>
                        {opciones.map((p) => (
                            <option key={p} value={p}>
                                {p === SABADO_RURAL.MAX
                                    ? 'Solo zona rural, sin tope'
                                    : `Solo zona rural, hasta el ${p} %`}
                            </option>
                        ))}
                    </select>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white" role="status">
                        {isPending
                            ? 'Guardando…'
                            : porcentaje === null
                              ? 'Sin regla especial: el sábado es un día más para el asistente'
                              : porcentaje === SABADO_RURAL.MAX
                                ? 'Los sábados, el asistente agenda solo a pacientes de zona rural'
                                : `Los sábados, el asistente agenda solo a pacientes de zona rural, hasta el ${porcentaje} % de cada médico; el ${100 - porcentaje} % queda para el hospital`}
                        {guardado && !isPending && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ Guardado</span>
                        )}
                    </p>
                </div>

                {estado && !isPending && <Estado estado={estado} encendida={porcentaje !== null} />}

                <ul className="text-sm text-zinc-500 dark:text-zinc-400 list-disc pl-5 space-y-1">
                    <li>
                        El asistente ofrece los sábados a todos, como un día más, y no dice que son para la zona rural.
                    </li>
                    <li>
                        Al dar el documento de quien va a la cita, revisa la zona en la ficha del hospital. Si no dice
                        rural, le pide con amabilidad comunicarse con el hospital o acercarse a la ventanilla para la
                        cita del sábado, y le muestra los horarios de otros días.
                    </li>
                    <li>Aplica al agendar, al cambiar la fecha de una cita y a la lista de espera.</li>
                </ul>
                <p className="text-xs text-zinc-400">
                    Solo el asistente (WhatsApp y Telegram): el personal agenda desde el panel y el hospital en su
                    sistema los sábados como siempre, y las citas ya agendadas no cambian. La lista de pacientes rurales
                    la manda el agente del hospital una vez al día (solo los números de documento).
                </p>
            </div>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
            {estado?.ultimoCambio && (
                <p className="mt-2 text-xs text-zinc-400">
                    Último cambio: {estado.ultimoCambio.detalle} ·{' '}
                    {formatAppointmentCompact(new Date(estado.ultimoCambio.en))}
                </p>
            )}
        </section>
    );
}

/** La lista de pacientes rurales y el bloqueo de los sábados en «Días sin citas». */
function Estado({ estado, encendida }: { estado: EstadoSabadoRural; encendida: boolean }) {
    const avisos: { texto: string; tono: 'aviso' | 'info' }[] = [];
    if (encendida && !estado.conEspejo) {
        avisos.push({
            tono: 'aviso',
            texto: 'La clínica no está conectada al sistema del hospital: sin la zona de la ficha, el asistente no ofrece sábados.',
        });
    } else if (encendida && !estado.lista) {
        avisos.push({
            tono: 'aviso',
            texto:
                'Esperando la lista de pacientes de zona rural del hospital: el agente la manda en la próxima hora (si el agente ya está actualizado). Mientras tanto, el asistente no ofrece sábados.',
        });
    }
    if (estado.lista) {
        avisos.push({
            tono: 'info',
            texto: `Lista del hospital: ${new Intl.NumberFormat('es-CO').format(estado.lista.total)} pacientes de zona rural, recibida el ${formatAppointmentCompact(new Date(estado.lista.recibidaEn))}.`,
        });
    }
    if (estado.bloqueoSabado === 'COMPLETO') {
        avisos.push({
            tono: encendida ? 'aviso' : 'info',
            texto: encendida
                ? 'Los sábados siguen cerrados para el asistente en «Días sin citas». Cuando quiera abrirlos a la zona rural, quite ese bloqueo.'
                : 'Hoy los sábados están cerrados para el asistente en «Días sin citas».',
        });
    } else if (estado.bloqueoSabado === 'PARCIAL') {
        avisos.push({
            tono: 'info',
            texto: 'Algunas horas del sábado siguen cerradas para el asistente en «Días sin citas».',
        });
    }
    if (avisos.length === 0) return null;
    return (
        <ul className="flex flex-col gap-2" aria-label="Estado de los sábados">
            {avisos.map((a) => (
                <li
                    key={a.texto}
                    className={
                        a.tono === 'aviso'
                            ? 'rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200'
                            : 'text-sm text-zinc-500 dark:text-zinc-400'
                    }
                >
                    {a.texto}
                </li>
            ))}
        </ul>
    );
}
