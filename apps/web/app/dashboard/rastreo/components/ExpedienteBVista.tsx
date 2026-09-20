'use client';

import { formatAppointmentShort } from '@/lib/date';
import type { ExpedienteB } from '@/lib/rastreo/tipos';
import { VeredictoCard } from './Veredicto';

/**
 * Escenario B (docs/PLAN_RASTREO_PACIENTE.md §3.2): "la agendaron en el HIS y no
 * le aparece en WhatsApp". Sin la consulta en vivo (Fase 2) AgenIA no puede
 * afirmar que la cita exista en el HIS: la pantalla lo rotula así arriba del
 * todo, y cada veredicto lo repite en "lo que no puede afirmar".
 */
export default function ExpedienteBVista({ data, onVolver }: { data: ExpedienteB; onVolver: () => void }) {
    const tz = data.zonaHoraria;
    const { principal, veredictos, notas } = data.resultado;
    const otros = veredictos.filter((v) => v !== principal);

    return (
        <div className="space-y-5">
            <div>
                <button type="button" onClick={onVolver} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    ← Nueva consulta
                </button>
                <h2 className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">Cita agendada en el HIS</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {data.cupo.medico} · {formatAppointmentShort(data.cupo.inicioIso, { timeZone: tz })}
                </p>
                <p className="mt-2 inline-block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    Parcial: sin consulta en vivo al HIS. Solo se sabe qué aviso recibió AgenIA del hospital.
                </p>
            </div>

            {notas.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    {notas.map((n, i) => (
                        <li key={i}>• {n}</li>
                    ))}
                </ul>
            )}

            <VeredictoCard veredicto={principal} principal />
            {otros.map((v) => (
                <VeredictoCard key={v.codigo} veredicto={v} />
            ))}

            <section className="rounded-xl border border-zinc-200 bg-white p-4 md:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Identidad en AgenIA</h3>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">Documento buscado</dt>
                        <dd className="font-medium">{data.identidad.documento ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">Perfil en esta clínica</dt>
                        <dd className="font-medium">
                            {data.identidad.encontrada ? `Sí (${data.identidad.nombre})` : 'No existe'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">WhatsApp asociado</dt>
                        <dd className="font-medium">{data.identidad.encontrada ? (data.identidad.conWhatsapp ? 'Sí' : 'No') : '—'}</dd>
                    </div>
                </dl>
            </section>

            {data.auditorias.length > 0 && (
                <section className="rounded-xl border border-zinc-200 bg-white p-4 md:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Eventos del HIS para ese cupo</h3>
                    <ol className="mt-3 space-y-2 text-sm">
                        {data.auditorias.map((a, i) => (
                            <li key={i} className="rounded-lg border border-zinc-100 p-2.5 dark:border-zinc-800">
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    <span className="tabular-nums">{formatAppointmentShort(a.atIso, { timeZone: tz })}</span> · {a.op} · {a.resultado}
                                </p>
                                <p className="mt-0.5">{a.nota || 'Sin nota.'}</p>
                            </li>
                        ))}
                    </ol>
                </section>
            )}
        </div>
    );
}
