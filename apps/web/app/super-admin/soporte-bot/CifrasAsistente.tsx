import Link from 'next/link';
import {
    ROL_LEGIBLE,
    type CifrasAsistente as Cifras,
    type PeriodoCifras,
    type PreguntaSinCubrir,
    type UserRole,
} from '@agenia/shared';
import { formatAppointmentCompact, formatDateOnly } from '@/lib/date';

const CARD = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4';
const numero = new Intl.NumberFormat('es-CO');
const n = (x: number) => numero.format(x);
const segundos = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const rol = (r: string) => ROL_LEGIBLE[r as UserRole] ?? r;

export const RUTA_CONVERSACIONES = '/super-admin/soporte-bot/conversaciones';

function Cifra({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
    return (
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-4">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{titulo}</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1 tabular-nums">{valor}</p>
            {detalle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{detalle}</p>}
        </div>
    );
}

/** 7 o 30 días: enlaces, la página se arma en el servidor. */
function Periodo({ dias }: { dias: PeriodoCifras }) {
    return (
        <nav aria-label="Periodo" className="inline-flex rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-0.5 text-sm">
            {([7, 30] as const).map((d) => (
                <Link
                    key={d}
                    href={`?dias=${d}`}
                    aria-current={d === dias ? 'page' : undefined}
                    className={`px-3 py-1.5 rounded-lg font-semibold ${
                        d === dias
                            ? 'bg-indigo-600 text-white'
                            : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                >
                    {d} días
                </Link>
            ))}
        </nav>
    );
}

/**
 * Cómo atiende el asistente (docs/PLAN_BOT_SOPORTE.md §3.7, Fase 5). Cifras de la
 * base y de Redis, sin IA. No cuentan las conversaciones de prueba del super admin.
 */
export function CifrasDelAsistente({ cifras }: { cifras: Cifras }) {
    const { conversaciones: c, respuestas: r, resultado: res, codigo } = cifras;
    return (
        <section className={CARD} aria-labelledby="cifras-asistente">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h2 id="cifras-asistente" className="text-lg font-bold text-zinc-900 dark:text-white">
                        Cómo va
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Desde el {formatDateOnly(`${cifras.periodo.desde}T12:00:00Z`)}. Sin las conversaciones de
                        prueba.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Periodo dias={cifras.periodo.dias} />
                    <Link
                        href={`${RUTA_CONVERSACIONES}?dias=${cifras.periodo.dias}`}
                        className="text-sm font-semibold text-indigo-600 hover:underline"
                    >
                        Ver conversaciones
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Cifra
                    titulo="Conversaciones"
                    valor={n(c.total)}
                    detalle={`${n(c.personas)} personas · ${n(c.clinicas)} clínicas`}
                />
                <Cifra
                    titulo="Respuestas"
                    valor={n(r.total)}
                    detalle={`${n(r.conIA)} con IA · ${n(r.sinIA)} sin IA`}
                />
                <Cifra
                    titulo="Resueltas sin abrir caso"
                    valor={res.porcentajeSinCaso === null ? '—' : `${res.porcentajeSinCaso} %`}
                    detalle={`${n(res.sinCaso)} de ${n(res.conRespuesta)} con respuesta`}
                />
                <Cifra titulo="Casos abiertos por el asistente" valor={n(res.casosAbiertos)} />
                <Cifra
                    titulo="«Me sirvió» / «No, abrir un caso»"
                    valor={`${n(res.utiles)} / ${n(res.noUtiles)}`}
                />
                <Cifra
                    titulo="Tiempo de respuesta con IA"
                    valor={segundos(r.tiempoMedioMs)}
                    detalle={`9 de cada 10 en menos de ${segundos(r.tiempoP90Ms)}`}
                />
                <Cifra titulo="Respuestas que el manual no cubrió" valor={n(r.sinCubrir)} />
                <Cifra
                    titulo="Mensajes sin código"
                    valor={n(codigo.mensajesSinCodigo)}
                    detalle="Se les pidió el código"
                />
            </div>

            <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">El código</h3>
                <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    {(
                        [
                            ['Pedidos en el panel', codigo.pedidos],
                            ['Usados', codigo.usados],
                            ['Nadie los escribió', codigo.sinUsar],
                            ['Equivocados', codigo.fallidos],
                            ['Cuentas bloqueadas 1 h', codigo.bloqueos],
                        ] as const
                    ).map(([t, v]) => (
                        <div key={t}>
                            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{t}</dt>
                            <dd className="font-semibold text-zinc-900 dark:text-white tabular-nums">{n(v)}</dd>
                        </div>
                    ))}
                </dl>
            </div>

            {cifras.porClinica.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <caption className="sr-only">Por clínica</caption>
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                                <th className="py-2 pr-3 font-medium">Clínica</th>
                                <th className="py-2 pr-3 font-medium text-right">Conversaciones</th>
                                <th className="py-2 pr-3 font-medium text-right">Personas</th>
                                <th className="py-2 pr-3 font-medium text-right">Con IA</th>
                                <th className="py-2 pr-3 font-medium text-right">Sin IA</th>
                                <th className="py-2 pr-3 font-medium text-right">Tokens (entrada / salida)</th>
                                <th className="py-2 font-medium text-right">Casos</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cifras.porClinica.map((f) => (
                                <tr key={f.organizationId} className="border-b border-zinc-50 dark:border-zinc-800/50">
                                    <td className="py-2 pr-3 text-zinc-900 dark:text-white">
                                        <Link
                                            href={`${RUTA_CONVERSACIONES}?dias=${cifras.periodo.dias}&clinica=${f.organizationId}`}
                                            className="hover:underline"
                                        >
                                            {f.nombre}
                                        </Link>
                                    </td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{n(f.conversaciones)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{n(f.personas)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{n(f.respuestasIA)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{n(f.respuestasSinIA)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">
                                        {n(f.tokensEntrada)} / {n(f.tokensSalida)}
                                    </td>
                                    <td className="py-2 text-right tabular-nums">{n(f.casos)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

/**
 * Lo que el manual no cubrió: para mejorar docs/conocimiento/AGENIA.md. Va con
 * cédulas, teléfonos y correos ocultos; la conversación completa está aparte.
 */
export function PreguntasSinCubrir({ preguntas }: { preguntas: PreguntaSinCubrir[] }) {
    return (
        <section className={CARD} aria-labelledby="sin-cubrir">
            <div>
                <h2 id="sin-cubrir" className="text-lg font-bold text-zinc-900 dark:text-white">
                    Lo que el manual no cubrió
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Preguntas a las que el asistente respondió «Eso no lo tengo en el manual». Sirven para completar
                    docs/conocimiento/AGENIA.md. Van con cédulas, teléfonos y correos ocultos.
                </p>
            </div>
            {preguntas.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Ninguna en este periodo.</p>
            ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {preguntas.map((p) => (
                        <li key={`${p.conversationId}-${p.fecha}`} className="py-3 flex flex-col sm:flex-row sm:items-start gap-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-zinc-900 dark:text-white break-words">{p.pregunta}</p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    {formatAppointmentCompact(p.fecha)} · {p.clinica} · {rol(p.rol)}
                                </p>
                            </div>
                            <Link
                                href={`${RUTA_CONVERSACIONES}/${p.conversationId}`}
                                className="text-xs font-semibold text-indigo-600 hover:underline shrink-0"
                            >
                                Ver conversación
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
