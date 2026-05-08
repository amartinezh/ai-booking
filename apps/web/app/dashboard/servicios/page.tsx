import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getMedicalServicesList } from '@/app/actions/services';
import ServicesClient from './components/ServicesClient';
import PageSkeleton from '../components/PageSkeleton';

export default async function ServicesPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const session = await getSession();
    if (session?.role !== 'ORG_ADMIN') redirect('/dashboard');

    const resolvedParams = await searchParams;
    const res = await getMedicalServicesList(resolvedParams.q);

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
            {res.success ? (
                <Suspense fallback={<PageSkeleton />}>
                    <ServicesClient data={res.data || []} />
                </Suspense>
            ) : (
                <div className="p-4 bg-red-50 text-red-500 rounded-lg font-medium border border-red-200">
                    ⚠️ {res.error}
                </div>
            )}
        </div>
    );
}
