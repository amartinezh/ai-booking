import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import PageSkeleton from '../components/PageSkeleton';
import EstadisticasParaCompartir from '../configuracion/EstadisticasParaCompartir';
import { SectionLoadError } from '../configuracion/comunes';
import { getMyEstadisticasParaCompartir } from '@/app/actions/estadisticas';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
    searchParams
}: {
    searchParams: Promise<{ startDate?: string; endDate?: string }>
}) {
    const session = await getSession();
    if (!session) redirect('/login');

    if (session.role !== 'ORG_ADMIN' && session.role !== 'GENERAL_OBSERVER') {
        redirect('/dashboard');
    }

    const { startDate, endDate } = await searchParams;

    // 🔗 La página pública de estadísticas y su clave (2026-10-26): solo el
    // administrador. Antes era la pestaña «Estadísticas» de Configuración
    // (docs/PLAN_NAVEGACION.md, N6). Aislada: si falla, las cifras se muestran igual.
    const esAdmin = session.role === 'ORG_ADMIN';
    let compartir: Awaited<ReturnType<typeof getMyEstadisticasParaCompartir>> | null = null;
    let compartirError: string | null = null;
    if (esAdmin) {
        try {
            compartir = await getMyEstadisticasParaCompartir();
        } catch (e) {
            console.error('[analytics] Estadísticas para compartir load failed:', e);
            compartirError = e instanceof Error ? e.message : 'Error desconocido.';
        }
    }

    return (
        <div className="max-w-7xl mx-auto animate-fade-in pb-10">
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2 flex items-center gap-3">
                        <span className="text-4xl">📊</span> Analíticas
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Métricas en tiempo real, volumen de agendamiento y análisis de la operación clínica.
                    </p>
                </div>
                {esAdmin && (
                    <a
                        href="#compartir"
                        className="inline-flex w-fit items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                        🔗 Compartir estas cifras
                    </a>
                )}
            </header>

            <Suspense fallback={<PageSkeleton />}>
                <AnalyticsDashboard
                    startDate={startDate}
                    endDate={endDate}
                />
            </Suspense>

            {esAdmin && (
                <section
                    id="compartir"
                    aria-label="Estadísticas para compartir"
                    className="mt-10 scroll-mt-24 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 md:p-8"
                >
                    {compartir ? (
                        <EstadisticasParaCompartir inicial={compartir} />
                    ) : (
                        <SectionLoadError title="No pudimos cargar las estadísticas para compartir" detail={compartirError} />
                    )}
                </section>
            )}
        </div>
    );
}
