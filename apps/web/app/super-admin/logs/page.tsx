import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { listSystemLogs, getRecentErrors, type SystemLogLevel } from '@/app/actions/system-logs';
import LogsClient from './components/LogsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SP = { level?: string; search?: string; page?: string; pageSize?: string };

export default async function LogsPage({
    searchParams,
}: {
    searchParams: Promise<SP>;
}) {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const sp = await searchParams;
    const allowed: SystemLogLevel[] = ['EVENT', 'WARNING', 'ERROR'];
    const level: SystemLogLevel | 'ALL' =
        sp.level && allowed.includes(sp.level.toUpperCase() as SystemLogLevel)
            ? (sp.level.toUpperCase() as SystemLogLevel)
            : 'ALL';

    const page = sp.page ? Math.max(1, parseInt(sp.page, 10)) : 1;
    const pageSize = sp.pageSize ? parseInt(sp.pageSize, 10) : 25;
    const search = sp.search?.trim() || '';

    const [logs, recentErrors] = await Promise.all([
        listSystemLogs({ level, search, page, pageSize }),
        getRecentErrors(5),
    ]);

    return (
        <div className="max-w-7xl mx-auto animate-fade-in">
            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Auditoría y Logs del Sistema
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Registro centralizado de eventos, advertencias y errores del sistema. Útil para soporte técnico,
                    auditoría de seguridad y diagnóstico de incidentes.
                </p>
            </header>

            <LogsClient
                initialLogs={logs}
                recentErrors={recentErrors}
                initialFilters={{ level, search, page, pageSize }}
            />
        </div>
    );
}
