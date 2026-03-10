import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getUpcomingSlots, getAgendaDependencies } from '@/app/actions/agenda';
import AgendaClient from './components/AgendaClient';

export const dynamic = 'force-dynamic';

export default async function AgendaPage() {
    const session = await getSession();
    if (session?.role !== 'ADMIN') redirect('/dashboard');

    const [slotsRes, depsRes] = await Promise.all([
        getUpcomingSlots(),
        getAgendaDependencies()
    ]);

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
            {slotsRes.success && depsRes.success ? (
                <AgendaClient slots={slotsRes.data || []} deps={depsRes.data} />
            ) : (
                <div className="p-4 bg-red-50 text-red-500 rounded-lg font-medium border border-red-200">
                    ⚠️ Ocurrió un error cargando el motor de agenda clínica.
                </div>
            )}
        </div>
    );
}
