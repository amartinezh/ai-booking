'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Pause, Play, RefreshCw, Table2, LineChart as LineIcon } from 'lucide-react';
import { getChannelStats } from '@/app/actions/channel-stats';
import type {
    Canal,
    ChannelRange,
    ChannelStatsResponse,
    Granularidad,
    PuntoSerie,
    TotalesCanal,
} from '@/app/actions/channel-stats.types';
import { formatTimeOnly } from '@/lib/date';

// ══════════════════════════════════════════════════════════════════════════
// 📈 CANALES EN VIVO — WhatsApp y Telegram en cifras.
//
// Refresca cada 30 s mientras la pestaña está visible. Cada refresco es solo
// una consulta de agregados a la base: ninguna llamada a IA ni a Meta/Telegram.
// ══════════════════════════════════════════════════════════════════════════

const REFRESCO_MS = 30_000;

const RANGOS: { value: ChannelRange; label: string }[] = [
    { value: 'TODAY', label: 'Hoy' },
    { value: 'WEEK', label: 'Semana' },
    { value: 'MONTH', label: 'Mes' },
    { value: 'YEAR', label: 'Año' },
    { value: 'CUSTOM', label: 'Personalizado' },
];

/** Las 4 líneas, en el orden fijo de la paleta (el color sigue a la serie). */
const SERIES: { key: keyof PuntoSerie; label: string; ayuda: string; color: string }[] = [
    { key: 'writers', label: 'Personas escribiendo', ayuda: 'Personas distintas que escribieron al bot', color: 'var(--cv-s1)' },
    { key: 'appointments', label: 'Citas pedidas', ayuda: 'Citas agendadas por este canal', color: 'var(--cv-s2)' },
    { key: 'noBooking', label: 'Escribieron y no agendaron', ayuda: 'Sin cita (no cuenta a quien vino a cancelar o reprogramar)', color: 'var(--cv-s3)' },
    { key: 'problems', label: 'Con problema', ayuda: 'Personas con un fallo del bot o que abandonaron tras los reintentos', color: 'var(--cv-s4)' },
];

const CANAL_INFO: Record<Canal, { nombre: string; icono: string }> = {
    WHATSAPP: { nombre: 'WhatsApp', icono: '💬' },
    TELEGRAM: { nombre: 'Telegram', icono: '✈️' },
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Las etiquetas ya vienen en hora local de la clínica: solo se les da formato. */
function etiquetaTramo(bucket: string, g: Granularidad): string {
    if (g === 'hour') {
        const h = Number(bucket.slice(11, 13));
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12} ${h < 12 ? 'a. m.' : 'p. m.'}`;
    }
    const [y, m, d] = bucket.split('-').map(Number);
    return g === 'day' ? `${d} ${MESES[m - 1]}` : `${MESES[m - 1]} ${y}`;
}

const fmt = (n: number | null | undefined) =>
    n == null ? '—' : new Intl.NumberFormat('es-CO').format(n);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');

const MOTIVOS: Record<string, string> = {
    NO_AGENDA: 'Sin agenda disponible',
    EPS_NOT_FOUND: 'EPS no encontrada',
    EPS_INACTIVE: 'EPS inactiva',
    EPS_NOT_ENROLLED: 'No está en el padrón de la EPS',
    EPS_REGIME_NOT_BILLABLE: 'EPS/régimen sin convenio',
    PATIENT_REGIME_MISSING: 'Paciente sin régimen',
    UNINTELLIGIBLE_AUDIO: 'Audio ininteligible',
    OUT_OF_CONTEXT: 'Fuera de contexto',
    SLOT_TAKEN: 'Cupo tomado por otro',
    SESSION_EXPIRED: 'Sesión vencida',
    MAX_RETRIES: 'Superó los reintentos',
    ABANDONED: 'Abandonó tras los reintentos',
    GEMINI_DOWN: 'IA no disponible',
    META_API_ERROR: 'Error enviando la respuesta',
    UNHANDLED_ERROR: 'Error inesperado del bot',
    PATIENT_NOT_FOUND: 'Paciente no encontrado',
    NO_APPOINTMENTS_TO_CANCEL: 'Sin citas para cancelar',
    NO_APPOINTMENTS_TO_MODIFY: 'Sin citas para reprogramar',
    CANCEL_ERROR: 'Error al cancelar',
    MODIFY_ERROR: 'Error al reprogramar',
    DOCTOR_NOT_FOUND: 'Médico no encontrado',
    FAQ_HALLUCINATION: 'Respuesta de FAQ interceptada',
};

const FLUJOS: { key: string; label: string }[] = [
    { key: 'BOOKING_CONFIRMED', label: 'Citas confirmadas' },
    { key: 'CANCELLATION_FLOW', label: 'Cancelaciones iniciadas' },
    { key: 'MODIFICATION_FLOW', label: 'Reprogramaciones iniciadas' },
    { key: 'WAITLIST_JOINED', label: 'Entraron a lista de espera' },
    { key: 'EMERGENCY_ESCALATED', label: 'Emergencias derivadas' },
    { key: 'ESCAPED', label: 'Reinicios de conversación' },
];

interface Props {
    /** Super Admin: lista para elegir clínica. Undefined = vista de una clínica. */
    organizations?: { id: string; name: string }[];
}

export default function CanalesEnVivo({ organizations }: Props) {
    const [range, setRange] = useState<ChannelRange>('TODAY');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [organizationId, setOrganizationId] = useState('');
    const [data, setData] = useState<ChannelStatsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [enVivo, setEnVivo] = useState(true);
    const pedido = useRef(0);

    const listoPersonalizado = range !== 'CUSTOM' || (startDate && endDate && startDate <= endDate);

    const cargar = useCallback(async () => {
        if (!listoPersonalizado) return;
        const id = ++pedido.current;
        setCargando(true);
        try {
            const r = await getChannelStats({ range, startDate, endDate, organizationId: organizationId || null });
            if (id !== pedido.current) return; // llegó una respuesta más nueva
            setData(r);
            setError(null);
        } catch (e) {
            if (id === pedido.current) setError(e instanceof Error ? e.message : 'Error cargando las cifras');
        } finally {
            if (id === pedido.current) setCargando(false);
        }
    }, [range, startDate, endDate, organizationId, listoPersonalizado]);

    useEffect(() => {
        void cargar();
    }, [cargar]);

    // Refresco en vivo: solo con la pestaña visible; al volver, refresca ya.
    useEffect(() => {
        if (!enVivo) return;
        const t = setInterval(() => {
            if (document.visibilityState === 'visible') void cargar();
        }, REFRESCO_MS);
        const alVolver = () => {
            if (document.visibilityState === 'visible') void cargar();
        };
        document.addEventListener('visibilitychange', alVolver);
        return () => {
            clearInterval(t);
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, [enVivo, cargar]);

    return (
        <div className="canales-viz space-y-6">
            <style>{ESTILOS}</style>

            {/* ── Filtros: una sola fila sobre las gráficas ── */}
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                <div role="radiogroup" aria-label="Periodo" className="flex flex-wrap gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
                    {RANGOS.map((r) => (
                        <button
                            key={r.value}
                            role="radio"
                            aria-checked={range === r.value}
                            onClick={() => setRange(r.value)}
                            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition ${
                                range === r.value
                                    ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white shadow-sm'
                                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>

                {range === 'CUSTOM' && (
                    <div className="flex items-center gap-2 text-sm">
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Desde"
                            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-zinc-900 dark:text-white" />
                        <span className="text-zinc-400">a</span>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="Hasta"
                            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-zinc-900 dark:text-white" />
                    </div>
                )}

                {organizations && (
                    <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} aria-label="Clínica"
                        className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-white">
                        <option value="">Todas las clínicas</option>
                        {organizations.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                    </select>
                )}

                <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${enVivo ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                        {enVivo ? 'En vivo' : 'En pausa'}
                        {data && <> · actualizado {formatTimeOnly(data.generatedAt, { withSeconds: true })}</>}
                    </span>
                    <button onClick={() => setEnVivo((v) => !v)} title={enVivo ? 'Pausar' : 'Reanudar'}
                        className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        {enVivo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button onClick={() => void cargar()} title="Actualizar ahora"
                        className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {range === 'CUSTOM' && !listoPersonalizado && (
                <p className="text-sm text-zinc-500">Elige la fecha inicial y la final (la inicial no puede ser posterior).</p>
            )}
            {error && (
                <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </p>
            )}

            {!data ? (
                <div className="grid gap-6 lg:grid-cols-2">
                    {[0, 1].map((i) => (
                        <div key={i} className="h-96 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
                    ))}
                </div>
            ) : (
                <>
                    <div className="grid gap-6 xl:grid-cols-2">
                        {(['WHATSAPP', 'TELEGRAM'] as Canal[]).map((c) => (
                            <PanelCanal key={c} canal={c} data={data} />
                        ))}
                    </div>
                    <Detalle data={data} />
                </>
            )}
        </div>
    );
}

// ── Panel de un canal: KPIs + gráfica de 4 líneas ─────────────────────────

function PanelCanal({ canal, data }: { canal: Canal; data: ChannelStatsResponse }) {
    const { series, totals } = data.channels[canal];
    const g = data.filters.granularity;
    const [ocultas, setOcultas] = useState<Set<string>>(new Set());
    const [tabla, setTabla] = useState(false);
    const puntos = useMemo(
        () => series.map((p) => ({ ...p, etiqueta: etiquetaTramo(p.bucket, g) })),
        [series, g],
    );
    const info = CANAL_INFO[canal];

    const toggle = (k: string) =>
        setOcultas((prev) => {
            const n = new Set(prev);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            return n;
        });

    return (
        <section aria-label={`Mensajes por ${info.nombre}`}
            className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 md:p-6">
            <header className="mb-4 flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                        <span aria-hidden>{info.icono}</span> Mensajes por {info.nombre}
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {totals.activeNow > 0
                            ? `${fmt(totals.activeNow)} ${totals.activeNow === 1 ? 'persona escribiendo' : 'personas escribiendo'} en los últimos 15 min`
                            : 'Nadie escribiendo en los últimos 15 min'}
                    </p>
                </div>
                <button onClick={() => setTabla((t) => !t)}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    {tabla ? <LineIcon className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
                    {tabla ? 'Ver gráfica' : 'Ver tabla'}
                </button>
            </header>

            <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Kpi label="Personas escribiendo" valor={fmt(totals.writers)} extra={`${fmt(totals.messages)} mensajes`} marca="var(--cv-s1)" />
                <Kpi label="Citas pedidas" valor={fmt(totals.appointmentsRequested)} extra={`Conversión ${totals.conversionPct == null ? '—' : `${totals.conversionPct}%`}`} marca="var(--cv-s2)" />
                <Kpi label="Escribieron y no agendaron" valor={fmt(totals.noBooking)} extra={pct(totals.noBooking, totals.writers) + ' de quienes escribieron'} marca="var(--cv-s3)" />
                <Kpi label="Con problema" valor={fmt(totals.problemWriters)} extra={pct(totals.problemWriters, totals.writers) + ' de quienes escribieron'} marca="var(--cv-s4)" />
                <Kpi label="Vinieron a gestionar una cita" valor={fmt(totals.managedWriters)} extra="Cancelar o reprogramar" />
                <Kpi label="Mensajes por persona" valor={totals.messagesPerWriter == null ? '—' : String(totals.messagesPerWriter).replace('.', ',')} extra={`${fmt(totals.newWriters)} nuevas · ${fmt(totals.returningWriters)} recurrentes`} />
            </dl>

            {/* Leyenda: siempre presente; clic para ocultar/mostrar una línea */}
            <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Series">
                {SERIES.map((s) => (
                    <li key={s.key}>
                        <button onClick={() => toggle(s.key)} aria-pressed={!ocultas.has(s.key)} title={s.ayuda}
                            className={`flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 ${ocultas.has(s.key) ? 'opacity-40' : ''}`}>
                            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
                            {s.label}
                        </button>
                    </li>
                ))}
            </ul>

            {tabla ? (
                <TablaSerie puntos={puntos} />
            ) : (
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={puntos} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="var(--cv-grid)" />
                            <XAxis dataKey="etiqueta" tickLine={false} axisLine={{ stroke: 'var(--cv-grid)' }}
                                tick={{ fill: 'var(--cv-muted)', fontSize: 11 }} minTickGap={16} />
                            <YAxis allowDecimals={false} tickLine={false} axisLine={false}
                                tick={{ fill: 'var(--cv-muted)', fontSize: 11 }} width={40} />
                            <Tooltip content={<TooltipCanal />} cursor={{ stroke: 'var(--cv-muted)', strokeDasharray: '3 3' }} />
                            {SERIES.map((s) => (
                                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                                    strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--cv-surface)' }}
                                    hide={ocultas.has(s.key)} isAnimationActive={false} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </section>
    );
}

function Kpi({ label, valor, extra, marca }: { label: string; valor: string; extra?: string; marca?: string }) {
    return (
        <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {marca && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: marca }} />}
                {label}
            </dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">{valor}</dd>
            {extra && <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{extra}</dd>}
        </div>
    );
}

type PuntoConEtiqueta = PuntoSerie & { etiqueta: string };

function TooltipCanal({ active, payload }: { active?: boolean; payload?: { payload: PuntoConEtiqueta }[] }) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs shadow-lg">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-white">{p.etiqueta}</p>
            {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-300">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                        {s.label}
                    </span>
                    <span className="font-semibold tabular-nums text-zinc-900 dark:text-white">{fmt(p[s.key] as number)}</span>
                </p>
            ))}
            <p className="mt-1 border-t border-zinc-100 dark:border-zinc-800 pt-1 text-zinc-500">{fmt(p.messages)} mensajes recibidos</p>
        </div>
    );
}

function TablaSerie({ puntos }: { puntos: PuntoConEtiqueta[] }) {
    return (
        <div className="max-h-72 overflow-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
            <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <tr>
                        <th className="px-3 py-2 text-left font-medium">Tramo</th>
                        <th className="px-3 py-2 text-right font-medium">Mensajes</th>
                        {SERIES.map((s) => (
                            <th key={s.key} className="px-3 py-2 text-right font-medium">{s.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
                    {puntos.map((p) => (
                        <tr key={p.bucket} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-1.5">{p.etiqueta}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(p.messages)}</td>
                            {SERIES.map((s) => (
                                <td key={s.key} className="px-3 py-1.5 text-right">{fmt(p[s.key] as number)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Detalle: estadísticas generales y específicas ─────────────────────────

function Detalle({ data }: { data: ChannelStatsResponse }) {
    const wa = data.channels.WHATSAPP.totals;
    const tg = data.channels.TELEGRAM.totals;
    const d = data.details;

    const filas: { label: string; v: (t: TotalesCanal) => number | null; fmtV?: (n: number | null) => string }[] = [
        { label: 'Personas que escribieron', v: (t) => t.writers },
        { label: 'Mensajes recibidos', v: (t) => t.messages },
        { label: 'Citas pedidas', v: (t) => t.appointmentsRequested },
        { label: 'Personas que agendaron', v: (t) => t.bookedWriters },
        { label: 'Vinieron a gestionar una cita', v: (t) => t.managedWriters },
        { label: 'Escribieron y no agendaron', v: (t) => t.noBooking },
        { label: 'Con problema', v: (t) => t.problemWriters },
        { label: 'Personas nuevas', v: (t) => t.newWriters },
        { label: 'Personas recurrentes', v: (t) => t.returningWriters },
    ];

    const motivos = useMemo(() => {
        const m = new Map<string, { WHATSAPP: number; TELEGRAM: number }>();
        for (const f of d.failureReasons) {
            const e = m.get(f.reason) ?? { WHATSAPP: 0, TELEGRAM: 0 };
            e[f.channel] += f.count;
            m.set(f.reason, e);
        }
        return [...m.entries()]
            .map(([reason, c]) => ({ reason, ...c, total: c.WHATSAPP + c.TELEGRAM }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 8);
    }, [d.failureReasons]);

    const tipos = (canal: Canal) => {
        const lista = d.messageTypes.filter((t) => t.channel === canal);
        const total = lista.reduce((s, t) => s + t.messages, 0);
        const de = (tipo: string) => lista.find((t) => t.type === tipo)?.messages ?? 0;
        const texto = de('text');
        const audio = de('audio');
        return { texto, audio, otro: total - texto - audio, total };
    };

    const totalMensajes = wa.messages + tg.messages;

    return (
        <section aria-label="Estadísticas generales y específicas"
            className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 md:p-6 space-y-6">
            <header>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">📊 Estadísticas generales y específicas</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Todo el movimiento de WhatsApp y Telegram en el periodo. Horas en {data.filters.timeZone.replace('_', ' ')}.
                </p>
            </header>

            {/* Participación de cada canal */}
            <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Participación por canal (mensajes)</h3>
                {totalMensajes === 0 ? (
                    <p className="text-sm text-zinc-500">Sin mensajes en el periodo.</p>
                ) : (
                    <>
                        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img"
                            aria-label={`WhatsApp ${pct(wa.messages, totalMensajes)}, Telegram ${pct(tg.messages, totalMensajes)}`}>
                            {wa.messages > 0 && <div style={{ width: `${(wa.messages / totalMensajes) * 100}%`, background: 'var(--cv-s1)' }} />}
                            {tg.messages > 0 && <div style={{ width: `${(tg.messages / totalMensajes) * 100}%`, background: 'var(--cv-s2)' }} />}
                        </div>
                        <p className="mt-1.5 flex gap-4 text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--cv-s1)' }} />WhatsApp {pct(wa.messages, totalMensajes)} ({fmt(wa.messages)})</span>
                            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--cv-s2)' }} />Telegram {pct(tg.messages, totalMensajes)} ({fmt(tg.messages)})</span>
                        </p>
                    </>
                )}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Comparativo */}
                <Tarjeta titulo="Comparativo WhatsApp vs Telegram">
                    <table className="w-full text-sm">
                        <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                            <tr>
                                <th className="py-1.5 text-left font-medium">Métrica</th>
                                <th className="py-1.5 text-right font-medium">WhatsApp</th>
                                <th className="py-1.5 text-right font-medium">Telegram</th>
                                <th className="py-1.5 text-right font-medium">Total</th>
                            </tr>
                        </thead>
                        <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
                            {filas.map((f) => (
                                <tr key={f.label} className="border-t border-zinc-100 dark:border-zinc-800">
                                    <td className="py-1.5">{f.label}</td>
                                    <td className="py-1.5 text-right">{fmt(f.v(wa))}</td>
                                    <td className="py-1.5 text-right">{fmt(f.v(tg))}</td>
                                    <td className="py-1.5 text-right font-semibold text-zinc-900 dark:text-white">{fmt((f.v(wa) ?? 0) + (f.v(tg) ?? 0))}</td>
                                </tr>
                            ))}
                            <tr className="border-t border-zinc-100 dark:border-zinc-800">
                                <td className="py-1.5">Conversión (agendaron / escribieron)</td>
                                <td className="py-1.5 text-right">{wa.conversionPct == null ? '—' : `${wa.conversionPct}%`}</td>
                                <td className="py-1.5 text-right">{tg.conversionPct == null ? '—' : `${tg.conversionPct}%`}</td>
                                <td className="py-1.5 text-right font-semibold text-zinc-900 dark:text-white">{pct(wa.bookedWriters + tg.bookedWriters, wa.writers + tg.writers)}</td>
                            </tr>
                        </tbody>
                    </table>
                </Tarjeta>

                {/* Embudo */}
                <Tarjeta titulo="Embudo de la conversación">
                    {(['WHATSAPP', 'TELEGRAM'] as Canal[]).map((c) => {
                        const t = data.channels[c].totals;
                        const pasos = [
                            { label: 'Escribieron', n: t.writers },
                            { label: 'Agendaron', n: t.bookedWriters },
                            { label: 'Gestionaron una cita', n: t.managedWriters },
                            { label: 'No agendaron', n: t.noBooking },
                        ];
                        return (
                            <div key={c} className="mb-4 last:mb-0">
                                <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{CANAL_INFO[c].icono} {CANAL_INFO[c].nombre}</p>
                                {pasos.map((p) => (
                                    <div key={p.label} className="mb-1 flex items-center gap-2 text-xs">
                                        <span className="w-36 shrink-0 text-zinc-600 dark:text-zinc-400">{p.label}</span>
                                        <div className="h-3 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
                                            <div className="h-3 rounded" style={{ width: t.writers ? `${(p.n / t.writers) * 100}%` : 0, background: c === 'WHATSAPP' ? 'var(--cv-s1)' : 'var(--cv-s2)' }} />
                                        </div>
                                        <span className="w-20 shrink-0 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{fmt(p.n)} · {pct(p.n, t.writers)}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </Tarjeta>

                {/* Estado de las citas */}
                <Tarjeta titulo="¿Qué pasó con las citas pedidas?" nota="Citas pedidas en el periodo, según su estado actual.">
                    <TablaCanales
                        filas={[
                            { label: 'Vigentes', wa: d.appointmentsByStatus.WHATSAPP.scheduled, tg: d.appointmentsByStatus.TELEGRAM.scheduled },
                            { label: 'Atendidas', wa: d.appointmentsByStatus.WHATSAPP.completed, tg: d.appointmentsByStatus.TELEGRAM.completed },
                            { label: 'Canceladas', wa: d.appointmentsByStatus.WHATSAPP.cancelled, tg: d.appointmentsByStatus.TELEGRAM.cancelled },
                            { label: 'No asistió', wa: d.appointmentsByStatus.WHATSAPP.noShow, tg: d.appointmentsByStatus.TELEGRAM.noShow },
                        ]}
                    />
                </Tarjeta>

                {/* Flujos */}
                <Tarjeta titulo="Qué vinieron a hacer" nota={`Según la caja negra del bot (guarda ${d.interactionLogRetentionDays} días).`}>
                    <TablaCanales
                        filas={FLUJOS.map((f) => ({ label: f.label, wa: d.flows.WHATSAPP[f.key] ?? 0, tg: d.flows.TELEGRAM[f.key] ?? 0 }))}
                    />
                </Tarjeta>

                {/* Motivos de fallo */}
                <Tarjeta titulo="Principales motivos de fallo" nota={`Turnos fallidos o abandonados; sin contar envíos iniciados por la clínica. Caja negra: ${d.interactionLogRetentionDays} días.`}>
                    {motivos.length === 0 ? (
                        <p className="text-sm text-zinc-500">Sin fallos en el periodo. 🎉</p>
                    ) : (
                        <TablaCanales filas={motivos.map((m) => ({ label: MOTIVOS[m.reason] ?? m.reason, wa: m.WHATSAPP, tg: m.TELEGRAM }))} />
                    )}
                </Tarjeta>

                {/* Texto vs audio + entrega */}
                <Tarjeta titulo="Tipo de mensaje y entrega de respuestas">
                    <TablaCanales
                        filas={[
                            { label: 'Mensajes de texto', wa: tipos('WHATSAPP').texto, tg: tipos('TELEGRAM').texto },
                            { label: 'Notas de voz', wa: tipos('WHATSAPP').audio, tg: tipos('TELEGRAM').audio },
                            { label: 'Otros (imagen, sticker…)', wa: tipos('WHATSAPP').otro, tg: tipos('TELEGRAM').otro },
                        ]}
                    />
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                        <Entrega titulo="💬 WhatsApp (según Meta)" estados={d.delivery.WHATSAPP}
                            orden={[['SENT', 'Enviados'], ['DELIVERED', 'Entregados'], ['READ', 'Leídos'], ['FAILED', 'Fallidos'], ['ACCEPTED', 'En cola']]} />
                        <Entrega titulo="✈️ Telegram" estados={d.delivery.TELEGRAM}
                            orden={[['ACCEPTED', 'Aceptados'], ['FAILED', 'Fallidos']]} />
                    </div>
                </Tarjeta>
            </div>

            <Tarjeta titulo="Horas pico" nota="Mensajes recibidos por día de la semana y hora (ambos canales).">
                <MapaCalor celdas={d.peakHours} />
            </Tarjeta>
        </section>
    );
}

function Tarjeta({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{titulo}</h3>
            {nota && <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">{nota}</p>}
            <div className={nota ? '' : 'mt-2'}>{children}</div>
        </div>
    );
}

function TablaCanales({ filas }: { filas: { label: string; wa: number; tg: number }[] }) {
    return (
        <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                    <th className="py-1 text-left font-medium" />
                    <th className="py-1 text-right font-medium">WhatsApp</th>
                    <th className="py-1 text-right font-medium">Telegram</th>
                </tr>
            </thead>
            <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
                {filas.map((f) => (
                    <tr key={f.label} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5">{f.label}</td>
                        <td className="py-1.5 text-right">{fmt(f.wa)}</td>
                        <td className="py-1.5 text-right">{fmt(f.tg)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function Entrega({ titulo, estados, orden }: { titulo: string; estados: Record<string, number>; orden: [string, string][] }) {
    const total = Object.values(estados).reduce((s, n) => s + n, 0);
    return (
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
            <p className="mb-1 font-semibold text-zinc-700 dark:text-zinc-300">{titulo}</p>
            {total === 0 ? (
                <p className="text-zinc-500">Sin envíos.</p>
            ) : (
                orden
                    .filter(([k]) => (estados[k] ?? 0) > 0)
                    .map(([k, label]) => (
                        <p key={k} className="flex justify-between tabular-nums text-zinc-600 dark:text-zinc-400">
                            <span>{label}</span>
                            <span>{fmt(estados[k])} · {pct(estados[k], total)}</span>
                        </p>
                    ))
            )}
        </div>
    );
}

/** Mapa de calor día × hora: un solo tono, de claro a oscuro. */
function MapaCalor({ celdas }: { celdas: { dow: number; hour: number; messages: number }[] }) {
    const matriz = useMemo(() => {
        const m = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
        for (const c of celdas) m[c.dow][c.hour] += c.messages;
        return m;
    }, [celdas]);
    const max = Math.max(0, ...matriz.flat());
    if (max === 0) return <p className="text-sm text-zinc-500">Sin mensajes en el periodo.</p>;
    // Lunes primero.
    const orden = [1, 2, 3, 4, 5, 6, 0];
    return (
        <div className="overflow-x-auto">
            <div className="grid min-w-[640px] gap-[2px]" style={{ gridTemplateColumns: '2.5rem repeat(24, minmax(0, 1fr))' }}>
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} className="text-center text-[10px] text-zinc-400">{h % 3 === 0 ? h : ''}</span>
                ))}
                {orden.map((dow) => (
                    <FilaCalor key={dow} dia={DIAS[dow]} valores={matriz[dow]} max={max} />
                ))}
            </div>
        </div>
    );
}

function FilaCalor({ dia, valores, max }: { dia: string; valores: number[]; max: number }) {
    return (
        <>
            <span className="self-center text-[11px] text-zinc-500 dark:text-zinc-400">{dia}</span>
            {valores.map((v, h) => (
                <span key={h} title={`${dia} ${h}:00 — ${fmt(v)} mensajes`}
                    className="h-5 rounded-[3px]"
                    style={{
                        background: v === 0 ? 'var(--cv-empty)' : 'var(--cv-s1)',
                        opacity: v === 0 ? 1 : 0.2 + 0.8 * (v / max),
                    }} />
            ))}
        </>
    );
}

// Colores por ROL: las 4 series en el orden fijo de la paleta validada, con
// sus pasos propios para modo oscuro (no una inversión automática).
const ESTILOS = `
.canales-viz {
  --cv-s1: #2a78d6; --cv-s2: #eb6834; --cv-s3: #1baf7a; --cv-s4: #eda100;
  --cv-grid: #e4e4e7; --cv-muted: #71717a; --cv-surface: #ffffff; --cv-empty: #f4f4f5;
}
.dark .canales-viz {
  --cv-s1: #3987e5; --cv-s2: #d95926; --cv-s3: #199e70; --cv-s4: #c98500;
  --cv-grid: #27272a; --cv-muted: #a1a1aa; --cv-surface: #18181b; --cv-empty: #27272a;
}
`;
