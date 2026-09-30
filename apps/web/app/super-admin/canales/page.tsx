import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { listStatsOrganizations } from '@/app/actions/global-stats';
import CanalesEnVivo from '@/app/components/canales/CanalesEnVivo';

export const dynamic = 'force-dynamic';

export default async function CanalesSuperAdminPage() {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const organizations = await listStatsOrganizations();

    return (
        <div className="max-w-7xl mx-auto animate-fade-in pb-10">
            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Canales en vivo
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Lo que está pasando por WhatsApp y Telegram: quién escribe, cuántas citas salen y
                    dónde se pierden. Sin consumo de IA: son cifras de la base.
                </p>
            </header>
            <CanalesEnVivo organizations={organizations.map((o) => ({ id: o.id, name: o.name }))} />
        </div>
    );
}
