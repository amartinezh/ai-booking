'use client';

import { useState, useTransition } from 'react';
import type { Veredicto } from '@agenia/shared';
import { formatAppointmentCompact, formatAppointmentShort } from '@/lib/date';
import { revelarIdentidadAction } from '@/app/actions/rastreo';
import { reprocesarEvento } from '@/app/actions/espejo';
import type { CitaExpediente, ExpedienteA } from '@/lib/rastreo/tipos';
import { LineaDeVida, VeredictoCard } from './Veredicto';
import ConsultaHis, { type ConsultaHisProps } from './ConsultaHis';

/**
 * El expediente de un paciente (docs/PLAN_RASTREO_PACIENTE.md §4.3): el
 * veredicto arriba, la línea de vida de cada cita debajo, y después la
 * identidad, la conversación y el historial. Nada clínico: eso vive en el
 * expediente clínico, tras su propio guard.
 */

const ESTADO_CITA = { SCHEDULED: 'Programada', COMPLETED: 'Completada', CANCELLED: 'Cancelada' } as const;
const ASISTENCIA = { PENDING: 'Sin desenlace', ATTENDED: 'Asistió', NO_SHOW: 'No asistió' } as const;
const ORIGEN = { WHATSAPP: 'WhatsApp', MANUAL: 'Manual', MIRROR: 'Hospital (HIS)' } as const;
const CHIP = 'inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 md:p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{titulo}</h3>
            {ayuda && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{ayuda}</p>}
            <div className="mt-3">{children}</div>
        </section>
    );
}

export default function ExpedienteVista({
    data,
    motivo,
    nota,
    organizationId,
    onVolver,
    consultaHis,
}: {
    data: ExpedienteA;
    motivo: string;
    nota: string;
    organizationId: string | null;
    onVolver: () => void;
    /** Cómo pedir y aplicar la consulta en vivo al HIS (la pantalla sabe el motivo y los datos). */
    consultaHis?: Pick<ConsultaHisProps, 'iniciar' | 'aplicar' | 'intervaloMs'>;
}) {
    const tz = data.zonaHoraria;
    const [pendiente, startTransition] = useTransition();
    const [aviso, setAviso] = useState<string | null>(null);
    const [revelado, setRevelado] = useState<{ documento: string | null; whatsapp: string | null; bsuid: string | null } | null>(null);

    const citaPorId = new Map(data.citas.map((c) => [c.id, c]));
    const { principal, veredictos, notas } = data.resultado;
    const otros = veredictos.filter((v) => v !== principal);

    const revelar = () => {
        if (!data.identidad) return;
        const pacienteId = data.identidad.pacienteId;
        setAviso(null);
        startTransition(async () => {
            const r = await revelarIdentidadAction({ organizationId, pacienteId, motivo, nota });
            if (r.success) setRevelado(r.data);
            else setAviso(r.error);
        });
    };

    const reprocesar = (seq: string) => {
        setAviso(null);
        startTransition(async () => {
            const r = await reprocesarEvento(seq);
            setAviso(
                r.success
                    ? `Evento ${seq} devuelto a la cola. El agente lo reintentará en su próxima vuelta; vuelve a consultar en unos minutos.`
                    : (r.error ?? 'No se pudo reprocesar.'),
            );
        });
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <button type="button" onClick={onVolver} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        ← Volver a los resultados
                    </button>
                    <h2 className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">
                        {data.identidad ? data.identidad.nombre : `Remitente ${data.remitente ?? ''}`}
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Consulta registrada · {formatAppointmentShort(data.generadoIso, { timeZone: tz })}
                    </p>
                </div>
            </div>

            {aviso && (
                <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    {aviso}
                </p>
            )}

            {notas.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    {notas.map((n, i) => (
                        <li key={i}>• {n}</li>
                    ))}
                </ul>
            )}

            <VeredictoConCita
                veredicto={principal}
                principal
                cita={principal.citaId ? citaPorId.get(principal.citaId) : undefined}
                data={data}
                pendiente={pendiente}
                onReprocesar={reprocesar}
            />

            {data.espejo && <SaludEspejoAviso data={data} />}

            {/* Sin perfil (un remitente que nunca se identificó) no hay documento con el cual preguntar. */}
            {consultaHis && data.identidad && (
                <ConsultaHis vista={data.hisEnVivo} organizationId={organizationId} zonaHoraria={tz} {...consultaHis} />
            )}

            {otros.length > 0 && (
                <details className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                        Otras {otros.length} lectura(s) de las citas del paciente
                    </summary>
                    <div className="mt-4 space-y-4">
                        {otros.map((v, i) => (
                            <VeredictoConCita
                                key={`${v.codigo}-${v.citaId ?? i}`}
                                veredicto={v}
                                cita={v.citaId ? citaPorId.get(v.citaId) : undefined}
                                data={data}
                                pendiente={pendiente}
                                onReprocesar={reprocesar}
                            />
                        ))}
                    </div>
                </details>
            )}

            {data.identidad && (
                <Seccion titulo="Identidad y canales" ayuda="Enmascarada por defecto. Mostrar los datos completos queda registrado.">
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                        <Dato etiqueta="Documento" valor={revelado?.documento ?? data.identidad.documento} />
                        <Dato etiqueta="WhatsApp" valor={revelado ? revelado.whatsapp : data.identidad.whatsapp} />
                        <Dato etiqueta="BSUID" valor={revelado ? revelado.bsuid : data.identidad.bsuid} />
                        <Dato etiqueta="EPS" valor={data.identidad.eps} />
                        <Dato etiqueta="Régimen" valor={data.identidad.regimen} />
                        <Dato etiqueta="Perfil creado" valor={formatAppointmentShort(data.identidad.creadoIso, { timeZone: tz })} />
                    </dl>
                    {!revelado && (
                        <button
                            type="button"
                            onClick={revelar}
                            disabled={pendiente}
                            className="mt-3 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                            Mostrar datos completos
                        </button>
                    )}
                </Seccion>
            )}

            {data.remitente && (
                <Seccion titulo="Remitente sin perfil">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        El número <span className="font-mono">{data.remitente}</span> escribió al bot pero nunca terminó de identificarse: no existe un perfil de paciente con ese dato.
                    </p>
                </Seccion>
            )}

            <Conversacion data={data} />
            <Historial data={data} />
        </div>
    );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
    return (
        <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{etiqueta}</dt>
            <dd className="font-medium text-zinc-900 dark:text-white">{valor ?? '—'}</dd>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────

function VeredictoConCita({
    veredicto,
    principal = false,
    cita,
    data,
    pendiente,
    onReprocesar,
}: {
    veredicto: Veredicto;
    principal?: boolean;
    cita?: CitaExpediente;
    data: ExpedienteA;
    pendiente: boolean;
    onReprocesar: (seq: string) => void;
}) {
    const tz = data.zonaHoraria;
    return (
        <div className="space-y-3">
            <VeredictoCard veredicto={veredicto} principal={principal} />
            {cita && (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {formatAppointmentCompact(cita.startIso, { timeZone: tz })} · {cita.doctor}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {cita.service}
                        {cita.eps ? ` · ${cita.eps}` : ''}
                    </p>
                    <LineaDeVida pasos={cita.lineaDeVida} zonaHoraria={tz} />

                    {cita.eventosSync && cita.eventosSync.length > 0 && (
                        <div className="mt-4 overflow-x-auto">
                            <table className="w-full text-xs">
                                <caption className="mb-1 text-left font-semibold text-zinc-700 dark:text-zinc-200">
                                    Eventos de envío al HIS (solo administrador)
                                </caption>
                                <thead className="text-left text-zinc-500 dark:text-zinc-400">
                                    <tr>
                                        <th className="py-1 pr-3 font-medium">Seq</th>
                                        <th className="py-1 pr-3 font-medium">Operación</th>
                                        <th className="py-1 pr-3 font-medium">Creado</th>
                                        <th className="py-1 pr-3 font-medium">Intentos</th>
                                        <th className="py-1 pr-3 font-medium">Estado</th>
                                        <th className="py-1 font-medium"><span className="sr-only">Acción</span></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {cita.eventosSync.map((e) => (
                                        <tr key={e.seq}>
                                            <td className="py-1.5 pr-3 font-mono">{e.seq}</td>
                                            <td className="py-1.5 pr-3">{e.op}</td>
                                            <td className="py-1.5 pr-3 tabular-nums">{formatAppointmentShort(e.creadoIso, { timeZone: tz })}</td>
                                            <td className="py-1.5 pr-3 tabular-nums">{e.intentos}</td>
                                            <td className="py-1.5 pr-3">
                                                {e.entregadoIso ? 'Entregado' : e.rendido ? 'Se rindió' : 'Pendiente'}
                                                {e.ultimoError && <span className="block text-rose-600 dark:text-rose-400">{e.ultimoError}</span>}
                                            </td>
                                            <td className="py-1.5 text-right">
                                                {e.rendido && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onReprocesar(e.seq)}
                                                        disabled={pendiente}
                                                        className="rounded-md border border-zinc-300 px-2 py-1 font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                                    >
                                                        Reintentar
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SaludEspejoAviso({ data }: { data: ExpedienteA }) {
    const e = data.espejo!;
    const edadMin = e.lastHeartbeatIso ? Math.round((Date.parse(data.generadoIso) - Date.parse(e.lastHeartbeatIso)) / 60_000) : null;
    let texto: string;
    let mal = false;
    if (!e.enabled) {
        texto = 'El espejo con el HIS está apagado para esta clínica.';
        mal = true;
    } else if (edadMin === null) {
        texto = 'El agente del hospital nunca ha dado señales.';
        mal = true;
    } else if (edadMin > 5) {
        texto = `El agente del hospital no da señales desde hace ${edadMin} min.`;
        mal = true;
    } else if (e.hisReachable === false) {
        texto = `El agente está vivo pero no alcanza el HIS${e.hisDetail ? `: ${e.hisDetail}` : ''}.`;
        mal = true;
    } else {
        texto = `Agente del hospital al día (último latido hace ${edadMin} min) y el HIS responde.`;
    }
    return (
        <p
            className={`rounded-lg border p-3 text-xs ${mal ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'}`}
        >
            <span className="font-semibold">Estado del espejo: </span>
            {texto}
        </p>
    );
}

function Conversacion({ data }: { data: ExpedienteA }) {
    const { nivel, resumen, mensajes } = data.conversacion;
    const tz = data.zonaHoraria;
    if (nivel === 'NINGUNA') return null;

    return (
        <Seccion
            titulo="Conversación con el bot"
            ayuda={
                nivel === 'TEXTO'
                    ? 'Últimos 90 días, lo más reciente primero.'
                    : 'Solo los hechos: tu perfil no muestra el texto de los mensajes.'
            }
        >
            {!resumen || resumen.mensajes === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No hay mensajes con este número en los últimos 90 días.</p>
            ) : (
                <>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {resumen.mensajes} mensaje(s)
                        {resumen.ultimoResultado ? ` · último resultado: ${resumen.ultimoResultado}` : ''}
                    </p>
                    {resumen.fallos.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-rose-700 dark:text-rose-300">
                            {resumen.fallos.slice(0, 5).map((f, i) => (
                                <li key={i}>
                                    {formatAppointmentShort(f.atIso, { timeZone: tz })} · {f.motivo}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            {mensajes && mensajes.length > 0 && (
                <ol className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
                    {mensajes.map((m, i) => (
                        <li key={i} className="rounded-lg border border-zinc-100 p-3 text-sm dark:border-zinc-800">
                            <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                <span className="tabular-nums">{formatAppointmentShort(m.atIso, { timeZone: tz })}</span>
                                <span className={CHIP}>{m.estado}</span>
                                {m.motivoFallo && <span className={CHIP}>{m.motivoFallo}</span>}
                            </p>
                            {m.paciente && (
                                <p className="mt-1 whitespace-pre-wrap">
                                    <span className="font-semibold">Paciente: </span>
                                    {m.paciente}
                                </p>
                            )}
                            {m.bot && (
                                <p className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                                    <span className="font-semibold">Bot: </span>
                                    {m.bot}
                                </p>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </Seccion>
    );
}

function Historial({ data }: { data: ExpedienteA }) {
    const tz = data.zonaHoraria;
    const { citas, espera, historial } = data;
    const hayAlgo = citas.length > 0 || espera.length > 0 || historial.encuestas.length > 0 || historial.avisosMasivos.length > 0;
    if (!hayAlgo) return null;

    return (
        <Seccion titulo="Historial" ayuda="Todas las citas que ve tu perfil, no solo las de los últimos 30 días.">
            {citas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <caption className="sr-only">Citas del paciente</caption>
                        <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                            <tr>
                                <th className="py-1 pr-3 font-medium">Cita</th>
                                <th className="py-1 pr-3 font-medium">Médico / servicio</th>
                                <th className="py-1 pr-3 font-medium">Estado</th>
                                <th className="py-1 pr-3 font-medium">Asistencia</th>
                                <th className="py-1 pr-3 font-medium">Origen</th>
                                <th className="py-1 font-medium">Recordatorio</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {citas.map((c) => (
                                <tr key={c.id}>
                                    <td className="py-1.5 pr-3 tabular-nums">{formatAppointmentCompact(c.startIso, { timeZone: tz })}</td>
                                    <td className="py-1.5 pr-3">
                                        {c.doctor}
                                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{c.service}</span>
                                    </td>
                                    <td className="py-1.5 pr-3">{ESTADO_CITA[c.status]}</td>
                                    <td className="py-1.5 pr-3">{ASISTENCIA[c.attendance]}</td>
                                    <td className="py-1.5 pr-3">{ORIGEN[c.origin]}</td>
                                    <td className="py-1.5 tabular-nums">
                                        {c.recordatorioIso ? formatAppointmentShort(c.recordatorioIso, { timeZone: tz }) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {espera.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Lista de espera</h4>
                    <ul className="mt-1 space-y-0.5 text-sm">
                        {espera.map((e, i) => (
                            <li key={i}>
                                {e.servicio} · {e.status} · desde {formatAppointmentShort(e.desdeIso, { timeZone: tz })}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {historial.avisosMasivos.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Avisos masivos</h4>
                    <ul className="mt-1 space-y-0.5 text-sm">
                        {historial.avisosMasivos.map((a, i) => (
                            <li key={i}>
                                Cita del {formatAppointmentCompact(a.citaIso, { timeZone: tz })} · {a.resultado}
                                {a.enviadoIso ? ` · enviado ${formatAppointmentShort(a.enviadoIso, { timeZone: tz })}` : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {historial.encuestas.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Encuestas de satisfacción</h4>
                    <ul className="mt-1 space-y-0.5 text-sm">
                        {historial.encuestas.map((e, i) => (
                            <li key={i}>
                                {formatAppointmentShort(e.creadoIso, { timeZone: tz })} · {e.calificacion}/5 · {e.resolucion}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Seccion>
    );
}
