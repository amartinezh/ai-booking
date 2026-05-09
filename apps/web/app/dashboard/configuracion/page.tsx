import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getMyOrgSettings } from '@/app/actions/settings';
import { getMyKnowledgeBase } from '@/app/actions/knowledge-base';
import SettingsForm from './SettingsForm';
import KnowledgeBaseEditor from '../conocimiento/KnowledgeBaseEditor';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const TABS = [
    { key: 'chatbot', label: 'Asistente Virtual', icon: '🤖' },
    { key: 'kb', label: 'Base de Conocimiento', icon: '🧠' },
];

export default async function ConfiguracionPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');

    const { tab = 'chatbot' } = await searchParams;
    const activeTab = TABS.find(t => t.key === tab)?.key ?? 'chatbot';

    const settings = activeTab === 'chatbot' ? await getMyOrgSettings() : null;
    const kbContent = activeTab === 'kb' ? await getMyKnowledgeBase() : null;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Configuración de la Clínica
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                    Personalice el comportamiento del asistente virtual y la información que comparte con los pacientes.
                </p>
            </header>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 border-b border-zinc-200 dark:border-zinc-800">
                {TABS.map(t => (
                    <Link
                        key={t.key}
                        href={`/dashboard/configuracion?tab=${t.key}`}
                        className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl border-b-2 transition-all
                            ${activeTab === t.key
                                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                            }`}
                    >
                        <span>{t.icon}</span>
                        {t.label}
                    </Link>
                ))}
            </div>

            {/* Panel activo */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 p-6 md:p-8">
                {activeTab === 'chatbot' && settings && (
                    <SettingsForm initial={settings} />
                )}
                {activeTab === 'kb' && (
                    <KnowledgeBaseEditor initialContent={kbContent ?? ''} />
                )}
            </div>
        </div>
    );
}
