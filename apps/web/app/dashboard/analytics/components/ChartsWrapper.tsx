'use client';

import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, Legend
} from 'recharts';

export default function ChartsWrapper({ data }: { data: any }) {
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg shadow-lg border border-zinc-100 dark:border-zinc-700 text-sm">
                    <p className="font-semibold text-zinc-900 dark:text-white mb-1">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <p key={`item-${index}`} style={{ color: entry.color }}>
                            {entry.name || 'Count'}: <span className="font-bold">{entry.value}</span>
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-center transition-transform hover:-translate-y-1">
                    <span className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mb-2">Total Citas</span>
                    <span className="text-5xl font-extrabold text-blue-600">{data.kpis.total}</span>
                </div>
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-center transition-transform hover:-translate-y-1">
                    <span className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mb-2">Completadas</span>
                    <span className="text-5xl font-extrabold text-emerald-500">{data.kpis.completed}</span>
                </div>
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-center transition-transform hover:-translate-y-1">
                    <span className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mb-2">Canceladas</span>
                    <span className="text-5xl font-extrabold text-red-500">{data.kpis.cancelled}</span>
                </div>
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bar Chart - Specialty */}
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-white mb-6">Demanda por Especialidad</h3>
                    <div className="h-72">
                        {data.charts.specialtyDistribution.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.charts.specialtyDistribution}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" opacity={0.5} />
                                    <XAxis dataKey="name" tick={{fontSize: 12}} tickLine={false} axisLine={false} />
                                    <YAxis tickLine={false} axisLine={false} tick={{fontSize: 12}} />
                                    <RechartsTooltip content={<CustomTooltip />} />
                                    <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-400">Sin datos</div>
                        )}
                    </div>
                </div>

                {/* Area Chart - Temporal Volume */}
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-white mb-6">Volumen de Agendamiento (Diario)</h3>
                    <div className="h-72">
                        {data.charts.temporalVolume.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.charts.temporalVolume}>
                                    <defs>
                                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" opacity={0.5} />
                                    <XAxis dataKey="date" tick={{fontSize: 12}} tickLine={false} axisLine={false} />
                                    <YAxis tickLine={false} axisLine={false} tick={{fontSize: 12}} />
                                    <RechartsTooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-400">Sin datos</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Donut Chart - EPS */}
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col items-center">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-white mb-2 self-start">Cuota de Mercado por EPS</h3>
                    <div className="h-72 w-full">
                        {data.charts.epsDistribution.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={data.charts.epsDistribution}
                                        cx="50%" cy="50%"
                                        innerRadius={70} outerRadius={100}
                                        paddingAngle={5} dataKey="count"
                                    >
                                        {data.charts.epsDistribution.map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip content={<CustomTooltip />} />
                                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-400">Sin datos</div>
                        )}
                    </div>
                </div>

                {/* Donut Chart - Origin */}
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col items-center">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-white mb-2 self-start">Origen de la Cita</h3>
                    <div className="h-72 w-full">
                        {data.charts.originDistribution.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={data.charts.originDistribution}
                                        cx="50%" cy="50%"
                                        innerRadius={70} outerRadius={100}
                                        paddingAngle={5} dataKey="count"
                                    >
                                        <Cell fill="#25D366" /> {/* WhatsApp Green */}
                                        <Cell fill="#f59e0b" /> {/* Manual Orange */}
                                    </Pie>
                                    <RechartsTooltip content={<CustomTooltip />} />
                                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-400">Sin datos</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
