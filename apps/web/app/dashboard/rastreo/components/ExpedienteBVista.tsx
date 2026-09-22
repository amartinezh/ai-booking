'use client';

import { useId, useState, useTransition } from 'react';
import { formatAppointmentShort, formatTimeOnly } from '@/lib/date';
import type { ExpedienteB, Resultado } from '@/lib/rastreo/tipos';
import { VeredictoCard } from './Veredicto';
import ConsultaHis, { type ConsultaHisProps } from './ConsultaHis';

/**
 * Escenario B (docs/PLAN_RASTREO_PACIENTE.md §3.2): "la agendaron en el HIS y no
 * le aparece en WhatsApp". Sin la consulta en vivo (Fase 2) AgenIA no puede
 * afirmar que la cita exista en el HIS: la pantalla lo rotula así arriba del
 * todo, y cada veredicto lo repite en "lo que no puede afirmar". Con la consulta
 * hecha, el rótulo cambia a la hora en que el hospital respondió.
 */
type Verificacion = 'HIS_EN_VIVO' | 'FUNCIONARIO';
export type EnviarConfirmacion = (datos: {
    pacienteId: string;
    slotId: string;
    verificacion: Verificacion;
}) => Promise<Resultado<{ via: 'TEXTO' | 'PLANTILLA' }>>;

const BOTON =
    'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400';

/**
 * «Enviar confirmación por WhatsApp» (§12 #7). Solo cuando el veredicto es que el
 * hospital agendó el cupo y AgenIA no creó la cita: es lo que ese veredicto le pide
 * a quien atiende. Va al WhatsApp que AgenIA ya tiene del paciente —la pantalla no
 * deja escribir otro— y, si la consulta en vivo no confirmó que la cita es de ESTE
 * paciente, pide que quien atiende lo afirme tras mirarlo en el HIS.
 */
function ConfirmacionPaciente({ data, enviar }: { data: ExpedienteB; enviar: EnviarConfirmacion }) {
    const idCasilla = useId();
    const [verificado, setVerificado] = useState(false);
    const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
    const [enviando, iniciar] = useTransition();

    const { principal } = data.resultado;
    const pacienteId = data.identidad.pacienteId;
    const slotId = data.cupo.slotId;
    const confirmadoEnVivo = principal.fuente === 'AGENIA_Y_HIS';
    const enviada = estado?.ok === true;

    let impedimento: string | null = null;
    if (!pacienteId) impedimento = 'El paciente no tiene perfil en AgenIA: dale la confirmación por otro medio.';
    else if (!data.identidad.conWhatsapp) impedimento = 'AgenIA no tiene un WhatsApp de este paciente: dale la confirmación por otro medio.';
    else if (!slotId) impedimento = 'AgenIA no tiene ese cupo: no hay con qué armar la confirmación.';

    function confirmar() {
        if (!pacienteId || !slotId) return;
        setEstado(null);
        iniciar(async () => {
            const r = await enviar({
                pacienteId,
                slotId,
                verificacion: confirmadoEnVivo ? 'HIS_EN_VIVO' : 'FUNCIONARIO',
            });
            setEstado(
                r.success
                    ? {
                          ok: true,
                          texto:
                              r.data.via === 'TEXTO'
                                  ? 'Enviada por WhatsApp. El paciente le escribió a la clínica hace poco, así que salió como mensaje normal.'
                                  : 'Enviada por WhatsApp con la plantilla de confirmación (el paciente no había escrito en las últimas 24 h).',
                      }
                    : { ok: false, texto: r.error },
            );
        });
    }

    return (
        <section aria-label="Confirmación al paciente" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 md:p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
            <h3 className="text-base font-semibold text-emerald-950 dark:text-emerald-100">Confirmarle la cita al paciente</h3>
            <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-200">
                Le llega por WhatsApp el servicio, el médico, la fecha y la hora, y que para cancelarla o cambiarla debe comunicarse con el hospital (el bot no conoce esta cita).
            </p>
            {impedimento ? (
                <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-200">{impedimento}</p>
            ) : (
                <div className="mt-3 space-y-3">
                    {confirmadoEnVivo ? (
                        <p className="text-sm text-emerald-900 dark:text-emerald-200">La consulta en vivo confirmó que la cita del hospital está a nombre de este paciente.</p>
                    ) : (
                        <label htmlFor={idCasilla} className="flex items-start gap-2 text-sm text-emerald-950 dark:text-emerald-100">
                            <input
                                id={idCasilla}
                                type="checkbox"
                                className="mt-0.5"
                                checked={verificado}
                                disabled={enviada}
                                onChange={(e) => setVerificado(e.target.checked)}
                            />
                            Verifiqué en el HIS que esta cita está a nombre de este paciente.
                        </label>
                    )}
                    <button
                        type="button"
                        className={BOTON}
                        disabled={enviando || enviada || (!confirmadoEnVivo && !verificado)}
                        onClick={confirmar}
                    >
                        {enviando ? 'Enviando…' : enviada ? 'Enviada' : 'Enviar confirmación por WhatsApp'}
                    </button>
                </div>
            )}
            {estado && (
                <p
                    role={estado.ok ? 'status' : 'alert'}
                    className={`mt-2 text-sm ${estado.ok ? 'text-emerald-900 dark:text-emerald-200' : 'font-medium text-red-700 dark:text-red-300'}`}
                >
                    {estado.texto}
                </p>
            )}
        </section>
    );
}

export default function ExpedienteBVista({
    data,
    onVolver,
    organizationId = null,
    consultaHis,
    enviarConfirmacion,
}: {
    data: ExpedienteB;
    onVolver: () => void;
    organizationId?: string | null;
    /** Cómo pedir y aplicar la consulta en vivo al HIS (la pantalla sabe el motivo y los datos). */
    consultaHis?: Pick<ConsultaHisProps, 'iniciar' | 'aplicar' | 'intervaloMs'>;
    /** Cómo enviar la confirmación al paciente (la pantalla sabe el motivo). */
    enviarConfirmacion?: EnviarConfirmacion;
}) {
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
                {data.hisEnVivo.consulta ? (
                    <p className="mt-2 inline-block rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                        Con consulta en vivo al HIS, hecha a las {formatTimeOnly(data.hisEnVivo.consulta.consultadoIso, { timeZone: tz })}.
                    </p>
                ) : (
                    <p className="mt-2 inline-block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        Parcial: sin consulta en vivo al HIS. Solo se sabe qué aviso recibió AgenIA del hospital.
                    </p>
                )}
            </div>

            {notas.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    {notas.map((n, i) => (
                        <li key={i}>• {n}</li>
                    ))}
                </ul>
            )}

            <VeredictoCard veredicto={principal} principal />
            {enviarConfirmacion && data.puedeConfirmar && principal.codigo === 'CITA_DEL_HIS_NO_ESPEJADA' && (
                <ConfirmacionPaciente data={data} enviar={enviarConfirmacion} />
            )}
            {consultaHis && <ConsultaHis vista={data.hisEnVivo} organizationId={organizationId} zonaHoraria={tz} {...consultaHis} />}
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
