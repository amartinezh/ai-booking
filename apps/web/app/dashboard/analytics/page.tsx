import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import AnalyticsDashboard from './components/AnalyticsDashboard';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
    searchParams
}: {
    searchParams: Promise<{ startDate?: string; endDate?: string }>
}) {
    const session = await getSession();
    if (!session) redirect('/login');

    if (session.role !== 'ADMIN' && session.role !== 'GENERAL_OBSERVER') {
        redirect('/dashboard');
    }

    const { startDate, endDate } = await searchParams;

    return (
        <div className="max-w-7xl mx-auto animate-fade-in pb-10">
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2 flex items-center gap-3">
                        <span className="text-4xl">📈</span> Business Intelligence
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Métricas en tiempo real, volumen de agendamiento y análisis de la operación clínica.
                    </p>
                </div>
            </header>

            <AnalyticsDashboard 
                startDate={startDate} 
                endDate={endDate} 
            />
        </div>
    );
}
