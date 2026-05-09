import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getMyOrgSettings } from '@/app/actions/settings';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function ConfiguracionPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');

    const settings = await getMyOrgSettings();

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <header className="mb-8">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Configuración de la Clínica
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                    Personalice el comportamiento del asistente virtual y otras opciones de su organización.
                </p>
            </header>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 p-6 md:p-8">
                <SettingsForm initial={settings} />
            </div>
        </div>
    );
}
