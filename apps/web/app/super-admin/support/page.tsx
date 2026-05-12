import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getSupportTicketsForAdmin } from '@/app/actions/support';
import SupportAdminClient from './components/SupportAdminClient';

export const dynamic = 'force-dynamic';

export default async function SuperAdminSupportPage({
    searchParams,
}: {
    searchParams: Promise<{ view?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const params = await searchParams;
    const showAll = params.view === 'all';
    const res = await getSupportTicketsForAdmin(showAll ? 'all' : 'active');

    if (!res.success) {
        return (
            <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm">
                ⚠️ {res.error}
            </div>
        );
    }

    // Serializamos las fechas para los Client Components
    const tickets = (res.data ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED',
        startedAt: t.startedAt ? t.startedAt.toISOString() : null,
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
        resolutionNote: t.resolutionNote,
        createdAt: t.createdAt.toISOString(),
        reporter: t.reporter,
        organization: t.organization,
    }));

    return (
        <div className="max-w-6xl mx-auto w-full">
            <SupportAdminClient tickets={tickets} showAll={showAll} />
        </div>
    );
}
