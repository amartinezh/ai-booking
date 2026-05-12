import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getMyTickets } from '@/app/actions/support';
import SupportClient from './components/SupportClient';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role === 'SUPER_ADMIN') redirect('/super-admin/support');

    const res = await getMyTickets();

    return (
        <div className="max-w-6xl mx-auto w-full">
            {res.success ? (
                <SupportClient tickets={res.data ?? []} />
            ) : (
                <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm">
                    ⚠️ {res.error}
                </div>
            )}
        </div>
    );
}
