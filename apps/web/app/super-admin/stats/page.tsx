import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
    getGlobalStats,
    listStatsOrganizations,
    type StatsTimeRange,
} from '@/app/actions/global-stats';
import GlobalStatsClient from './components/GlobalStatsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SP = {
    organizationId?: string;
    range?: string;
    startDate?: string;
    endDate?: string;
};

const ALLOWED_RANGES: StatsTimeRange[] = ['TODAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM'];

export default async function GlobalStatsPage({
    searchParams,
}: {
    searchParams: Promise<SP>;
}) {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const sp = await searchParams;
    const range: StatsTimeRange =
        sp.range && ALLOWED_RANGES.includes(sp.range.toUpperCase() as StatsTimeRange)
            ? (sp.range.toUpperCase() as StatsTimeRange)
            : 'MONTH';

    const organizationId =
        sp.organizationId && sp.organizationId !== 'ALL' ? sp.organizationId : null;

    const [organizations, stats] = await Promise.all([
        listStatsOrganizations(),
        getGlobalStats({
            organizationId,
            range,
            startDate: sp.startDate,
            endDate: sp.endDate,
        }),
    ]);

    return (
        <div className="max-w-7xl mx-auto animate-fade-in">
            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Estadísticas Globales
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Adopción, tráfico de WhatsApp, uso de IA y volumen clínico consolidados a nivel
                    plataforma. Filtra por clínica y rango temporal para auditar el pulso del SaaS.
                </p>
            </header>

            <GlobalStatsClient
                initialStats={stats}
                organizations={organizations}
                initialFilters={{
                    organizationId: organizationId ?? 'ALL',
                    range,
                    startDate: sp.startDate ?? '',
                    endDate: sp.endDate ?? '',
                }}
            />
        </div>
    );
}
