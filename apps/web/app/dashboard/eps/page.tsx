import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getEpsList } from '@/app/actions/eps';
import EpsClient from './components/EpsClient';

export default async function EpsPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const session = await getSession();
    if (session?.role !== 'ADMIN') redirect('/dashboard');

    const resolvedParams = await searchParams;
    const res = await getEpsList(resolvedParams.q);

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
            {res.success ? (
                <EpsClient data={res.data || []} />
            ) : (
                <div className="p-4 bg-red-50 text-red-500 rounded-lg font-medium border border-red-200">
                    ⚠️ {res.error}
                </div>
            )}
        </div>
    );
}
