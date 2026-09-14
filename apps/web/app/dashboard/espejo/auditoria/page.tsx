import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { tieneEspejo } from '@/app/actions/espejo';
import {
    listSyncAudit,
    listSyncOutbox,
    getSyncAuditFacets,
    getSyncOutboxFacets,
    type OutboxEstado,
} from '@/app/actions/sync-audit';
import AuditoriaEspejoClient from './components/AuditoriaEspejoClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SP = {
    tab?: string;
    direction?: string;
    entityType?: string;
    outcome?: string;
    op?: string;
    estado?: string;
    q?: string;
    desde?: string;
    hasta?: string;
    page?: string;
};

const ESTADOS_OUTBOX: OutboxEstado[] = ['PENDIENTE', 'ENTREGADO', 'DEAD_LETTER'];

/**
 * Drill-down detallado de /dashboard/espejo: el historial completo,
 * filtrable y paginado, de todo lo que pasa entre AgenIA y el HIS.
 * Ver sync-audit.ts para por qué son dos pestañas (dos tablas) y no una.
 */
export default async function AuditoriaEspejoPage({
    searchParams,
}: {
    searchParams: Promise<SP>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');
    if (!(await tieneEspejo())) redirect('/dashboard/espejo');

    const sp = await searchParams;
    const tab = sp.tab === 'outbox' ? 'outbox' : 'auditoria';
    const page = sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;
    const estado = ESTADOS_OUTBOX.includes(sp.estado as OutboxEstado) ? (sp.estado as OutboxEstado) : undefined;

    const filtrosComunes = {
        entityType: sp.entityType || undefined,
        op: sp.op || undefined,
        search: sp.q || undefined,
        from: sp.desde || undefined,
        to: sp.hasta || undefined,
        page,
    };

    const [auditRes, outboxRes, auditFacetsRes, outboxFacetsRes] = await Promise.all([
        tab === 'auditoria'
            ? listSyncAudit({ ...filtrosComunes, direction: sp.direction || undefined, outcome: sp.outcome || undefined })
            : Promise.resolve(null),
        tab === 'outbox' ? listSyncOutbox({ ...filtrosComunes, estado }) : Promise.resolve(null),
        getSyncAuditFacets(),
        getSyncOutboxFacets(),
    ]);

    if (tab === 'auditoria' && auditRes && !auditRes.success) {
        return (
            <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
                <div className="p-4 bg-amber-50 text-amber-700 rounded-lg font-medium border border-amber-200">
                    {auditRes.error}
                </div>
            </div>
        );
    }
    if (tab === 'outbox' && outboxRes && !outboxRes.success) {
        return (
            <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
                <div className="p-4 bg-amber-50 text-amber-700 rounded-lg font-medium border border-amber-200">
                    {outboxRes.error}
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
            <AuditoriaEspejoClient
                tab={tab}
                audit={auditRes && auditRes.success ? auditRes.data : null}
                outbox={outboxRes && outboxRes.success ? outboxRes.data : null}
                auditFacets={auditFacetsRes.success ? auditFacetsRes.data : { directions: [], entityTypes: [], outcomes: [], ops: [] }}
                outboxFacets={outboxFacetsRes.success ? outboxFacetsRes.data : { entityTypes: [], ops: [] }}
                filtros={{
                    direction: sp.direction || '',
                    entityType: sp.entityType || '',
                    outcome: sp.outcome || '',
                    op: sp.op || '',
                    estado: estado || '',
                    q: sp.q || '',
                    desde: sp.desde || '',
                    hasta: sp.hasta || '',
                    page,
                }}
            />
        </div>
    );
}
