'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    LineChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    Building2,
    UserCog,
    Stethoscope,
    CalendarCheck2,
    CalendarX2,
    MessageSquareWarning,
    UserPlus,
    FileSignature,
    ScrollText,
    Bot,
    Network,
    Loader2,
} from 'lucide-react';
import {
    getGlobalStats,
    type GlobalStatsResponse,
    type OrgOption,
    type StatsTimeRange,
    type TrendPoint,
} from '@/app/actions/global-stats';

type Props = {
    initialStats: GlobalStatsResponse;
    organizations: OrgOption[];
    initialFilters: {
        organizationId: string; // 'ALL' o un id
        range: StatsTimeRange;
        startDate: string;
        endDate: string;
    };
};

const RANGE_OPTIONS: { key: StatsTimeRange; label: string }[] = [
    { key: 'TODAY', label: 'Hoy' },
    { key: 'WEEK', label: 'Semana actual' },
    { key: 'MONTH', label: 'Mes actual' },
    { key: 'YEAR', label: 'Año actual' },
    { key: 'CUSTOM', label: 'Rango personalizado' },
];

type CardDef = {
    key: keyof GlobalStatsResponse['metrics'];
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string; // gradiente tailwind
    trendKey?: keyof GlobalStatsResponse['trends'];
};

const CARDS: CardDef[] = [
    {
        key: 'loginsClinicAdmin',
        title: 'Logueos · Clinic Admin',
        subtitle: "SystemLog action='USER_LOGIN' · ORG_ADMIN",
        icon: UserCog,
        accent: 'from-indigo-500 to-violet-500',
    },
    {
        key: 'loginsDoctor',
        title: 'Logueos · Médicos',
        subtitle: "SystemLog action='USER_LOGIN' · DOCTOR",
        icon: Stethoscope,
        accent: 'from-emerald-500 to-teal-500',
    },
    {
        key: 'loginsScheduler',
        title: 'Logueos · Agendadores',
        subtitle: "SystemLog action='USER_LOGIN' · BOOKING_AGENT",
        icon: UserCog,
        accent: 'from-sky-500 to-cyan-500',
    },
    {
        key: 'appointmentsScheduled',
        title: 'Citas agendadas',
        subtitle: "Appointment status='SCHEDULED'",
        icon: CalendarCheck2,
        accent: 'from-blue-500 to-indigo-500',
        trendKey: 'appointmentsScheduled',
    },
    {
        key: 'appointmentsFailed',
        title: 'Citas fallidas',
        subtitle: "Canceladas o NO_SHOW",
        icon: CalendarX2,
        accent: 'from-rose-500 to-red-500',
    },
    {
        key: 'whatsappEscalations',
        title: 'Escalaciones a humano',
        subtitle: "SystemLog action='WHATSAPP_ESCALATION'",
        icon: MessageSquareWarning,
        accent: 'from-amber-500 to-orange-500',
    },
    {
        key: 'newPatients',
        title: 'Pacientes nuevos',
        subtitle: 'PatientProfile creados en el rango',
        icon: UserPlus,
        accent: 'from-fuchsia-500 to-pink-500',
        trendKey: 'newPatients',
    },
    {
        key: 'signedClinicalRecords',
        title: 'Historias firmadas',
        subtitle: "ClinicalRecord status='SIGNED'",
        icon: FileSignature,
        accent: 'from-green-500 to-emerald-500',
        trendKey: 'signedClinicalRecords',
    },
    {
        key: 'legalAddendums',
        title: 'Adendas legales',
        subtitle: 'Addendum creadas sobre HC firmadas',
        icon: ScrollText,
        accent: 'from-yellow-500 to-amber-500',
    },
    {
        key: 'aiMessagesProcessed',
        title: 'Mensajes IA procesados',
        subtitle: "SystemLog action='AI_MESSAGE_PROCESSED'",
        icon: Bot,
        accent: 'from-purple-500 to-fuchsia-500',
        trendKey: 'aiMessagesProcessed',
    },
    {
        key: 'activeOrganizations',
        title: 'Clínicas activas',
        subtitle: 'Con al menos una cita o HC en el rango',
        icon: Network,
        accent: 'from-slate-600 to-zinc-700',
    },
];

function formatNumber(n: number): string {
    return new Intl.NumberFormat('es-CO').format(n);
}

function MetricCard({
    title,
    subtitle,
    icon: Icon,
    accent,
    value,
    trend,
}: {
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    value: number;
    trend?: TrendPoint[];
}) {
    const hasTrend = trend && trend.length > 1;
    return (
        <div className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            <div
                className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`}
                aria-hidden
            />
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400">
                        {title}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">
                        {subtitle}
                    </p>
                </div>
                <div
                    className={`shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br ${accent} text-white shadow`}
                >
                    <Icon className="w-5 h-5" />
                </div>
            </div>

            <p className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
                {formatNumber(value)}
            </p>

            {hasTrend && (
                <div className="mt-3 h-14">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <XAxis dataKey="date" hide />
                            <YAxis hide domain={['auto', 'auto']} />
                            <Tooltip
                                contentStyle={{
                                    background: 'rgba(24,24,27,0.95)',
                                    border: 'none',
                                    borderRadius: 8,
                                    color: '#fff',
                                    fontSize: 12,
                                }}
                                labelStyle={{ color: '#a1a1aa' }}
                                formatter={(v) => [formatNumber(Number(v ?? 0)), 'Cantidad']}
                            />
                            <Line
                                type="monotone"
                                dataKey="count"
                                stroke="currentColor"
                                strokeWidth={2}
                                dot={false}
                                className="text-indigo-500 dark:text-indigo-400"
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

export default function GlobalStatsClient({
    initialStats,
    organizations,
    initialFilters,
}: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const [stats, setStats] = useState<GlobalStatsResponse>(initialStats);
    const [loading, setLoading] = useState(false);

    const [organizationId, setOrganizationId] = useState(initialFilters.organizationId);
    const [range, setRange] = useState<StatsTimeRange>(initialFilters.range);
    const [startDate, setStartDate] = useState(initialFilters.startDate);
    const [endDate, setEndDate] = useState(initialFilters.endDate);

    // ── Sincroniza la URL para que el filtro sea "shareable" ──
    const pushQuery = (patch: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams?.toString() || '');
        Object.entries(patch).forEach(([k, v]) => {
            if (v === null || v === '' || v === 'ALL') params.delete(k);
            else params.set(k, v);
        });
        startTransition(() => {
            router.replace(`/super-admin/stats?${params.toString()}`);
        });
    };

    // ── Recarga las métricas vía server action sin recargar la página ──
    const reload = async (override?: Partial<Props['initialFilters']>) => {
        const next = {
            organizationId: override?.organizationId ?? organizationId,
            range: (override?.range ?? range) as StatsTimeRange,
            startDate: override?.startDate ?? startDate,
            endDate: override?.endDate ?? endDate,
        };
        setLoading(true);
        try {
            const fresh = await getGlobalStats({
                organizationId: next.organizationId === 'ALL' ? null : next.organizationId,
                range: next.range,
                startDate: next.startDate || undefined,
                endDate: next.endDate || undefined,
            });
            setStats(fresh);
        } catch (e) {
            console.error('Error cargando estadísticas globales', e);
        } finally {
            setLoading(false);
        }
    };

    const onOrgChange = (val: string) => {
        setOrganizationId(val);
        pushQuery({ organizationId: val });
        reload({ organizationId: val });
    };

    const onRangeChange = (val: StatsTimeRange) => {
        setRange(val);
        // Si pasamos a un preset, limpiamos las fechas custom de la URL.
        if (val !== 'CUSTOM') {
            pushQuery({ range: val, startDate: null, endDate: null });
            reload({ range: val, startDate: '', endDate: '' });
        } else {
            pushQuery({ range: val });
        }
    };

    const onCustomApply = () => {
        if (!startDate || !endDate) return;
        pushQuery({ range: 'CUSTOM', startDate, endDate });
        reload({ range: 'CUSTOM', startDate, endDate });
    };

    // Reset visual sobre input cuando los filtros server-side cambian
    useEffect(() => {
        setOrganizationId(initialFilters.organizationId);
        setRange(initialFilters.range);
        setStartDate(initialFilters.startDate);
        setEndDate(initialFilters.endDate);
    }, [initialFilters]);

    return (
        <div className="space-y-6">
            {/* ─── Panel de filtros eléctrico ─── */}
            <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-end gap-4">
                    {/* Clínica */}
                    <div className="flex-1 min-w-0">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">
                            <Building2 className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />
                            Clínica
                        </label>
                        <select
                            value={organizationId}
                            onChange={(e) => onOrgChange(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="ALL">Todas las clínicas (Global)</option>
                            {organizations.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.name}
                                    {!o.isActive ? ' (inactiva)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Tiempo */}
                    <div className="md:flex-1">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">
                            Periodo
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {RANGE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => onRangeChange(opt.key)}
                                    className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                                        range === opt.key
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Rango custom */}
                {range === 'CUSTOM' && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">
                                Desde
                            </label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">
                                Hasta
                            </label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-white"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={onCustomApply}
                            disabled={!startDate || !endDate}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Aplicar rango
                        </button>
                    </div>
                )}

                {/* Indicador de estado */}
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                        Mostrando datos desde{' '}
                        <strong className="text-zinc-700 dark:text-zinc-200">
                            {stats.filters.startDate.slice(0, 10)}
                        </strong>{' '}
                        hasta{' '}
                        <strong className="text-zinc-700 dark:text-zinc-200">
                            {stats.filters.endDate.slice(0, 10)}
                        </strong>
                    </span>
                    {(loading || isPending) && (
                        <span className="inline-flex items-center gap-1.5 text-indigo-500">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Actualizando…
                        </span>
                    )}
                </div>
            </section>

            {/* ─── Grid de métricas ─── */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {CARDS.map((card) => (
                    <MetricCard
                        key={card.key}
                        title={card.title}
                        subtitle={card.subtitle}
                        icon={card.icon}
                        accent={card.accent}
                        value={stats.metrics[card.key]}
                        trend={card.trendKey ? stats.trends[card.trendKey] : undefined}
                    />
                ))}
            </section>
        </div>
    );
}
