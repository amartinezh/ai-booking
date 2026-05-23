import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getMyOrgSettings } from '@/app/actions/settings';
import { getMyKnowledgeBase } from '@/app/actions/knowledge-base';
import { getMyAiConfig } from '@/app/actions/ai-config';
import { getMyWhatsappConfig } from '@/app/actions/whatsapp-config';
import { getMyAudioConfig } from '@/app/actions/audio-config';
import SettingsForm from './SettingsForm';
import KnowledgeBaseEditor from '../conocimiento/KnowledgeBaseEditor';
import AiIntegrationForm from './AiIntegrationForm';
import WhatsappChannelForm from './WhatsappChannelForm';
import AudioConfigForm from './AudioConfigForm';
import ConnectionHealthPanel from './ConnectionHealthPanel';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const TABS = [
    { key: 'chatbot', label: 'Asistente Virtual', icon: '🤖' },
    { key: 'integrations', label: 'Integraciones (IA y Canales)', icon: '🧠' },
    { key: 'kb', label: 'Base de Conocimiento', icon: '📚' },
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
    // Compatibilidad: el tab `?tab=ai` antiguo redirige a `integrations`.
    const normalizedTab = tab === 'ai' ? 'integrations' : tab;
    const activeTab = TABS.find(t => t.key === normalizedTab)?.key ?? 'chatbot';

    const settings = activeTab === 'chatbot' ? await getMyOrgSettings() : null;
    const kbContent = activeTab === 'kb' ? await getMyKnowledgeBase() : null;

    // Tab de integraciones: cargamos IA y WhatsApp en paralelo PERO aislados.
    // Si una de las dos revienta (decrypt, backend down, migración faltante,
    // etc.) la otra debe seguir mostrándose y el error queda inline, no en
    // el error boundary global del dashboard.
    let aiConfig: Awaited<ReturnType<typeof getMyAiConfig>> | null = null;
    let aiConfigError: string | null = null;
    let whatsappConfig: Awaited<ReturnType<typeof getMyWhatsappConfig>> | null = null;
    let whatsappConfigError: string | null = null;
    let audioConfig: Awaited<ReturnType<typeof getMyAudioConfig>> | null = null;
    let audioConfigError: string | null = null;

    if (activeTab === 'integrations') {
        const [aiRes, waRes, audioRes] = await Promise.allSettled([
            getMyAiConfig(),
            getMyWhatsappConfig(),
            getMyAudioConfig(),
        ]);
        if (aiRes.status === 'fulfilled') {
            aiConfig = aiRes.value;
        } else {
            console.error('[configuracion] AI config load failed:', aiRes.reason);
            aiConfigError =
                aiRes.reason?.message ?? 'Error desconocido cargando la integración de IA.';
        }
        if (waRes.status === 'fulfilled') {
            whatsappConfig = waRes.value;
        } else {
            console.error('[configuracion] WhatsApp config load failed:', waRes.reason);
            whatsappConfigError =
                waRes.reason?.message ?? 'Error desconocido cargando el canal de WhatsApp.';
        }
        if (audioRes.status === 'fulfilled') {
            audioConfig = audioRes.value;
        } else {
            console.error('[configuracion] Audio config load failed:', audioRes.reason);
            audioConfigError =
                audioRes.reason?.message ?? 'Error desconocido cargando la configuración de audio.';
        }
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Configuración de la Clínica
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                    Personalice el comportamiento del asistente virtual, conecte sus canales y administre la información que comparte con los pacientes.
                </p>
            </header>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
                {TABS.map(t => (
                    <Link
                        key={t.key}
                        href={`/dashboard/configuracion?tab=${t.key}`}
                        className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap
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
                {activeTab === 'integrations' && (
                    <div className="space-y-12">
                        <ConnectionHealthPanel />
                        <div className="border-t border-zinc-200 dark:border-zinc-800" />
                        {aiConfig ? (
                            <AiIntegrationForm initial={{
                                ...aiConfig,
                                updatedAt: aiConfig.updatedAt ? String(aiConfig.updatedAt) : null,
                            }} />
                        ) : (
                            <SectionLoadError
                                title="No pudimos cargar la integración de IA"
                                detail={aiConfigError}
                            />
                        )}
                        <div className="border-t border-zinc-200 dark:border-zinc-800" />
                        {whatsappConfig ? (
                            <WhatsappChannelForm initial={{
                                ...whatsappConfig,
                                updatedAt: whatsappConfig.updatedAt ? String(whatsappConfig.updatedAt) : null,
                            }} />
                        ) : (
                            <SectionLoadError
                                title="No pudimos cargar el canal de WhatsApp"
                                detail={whatsappConfigError}
                            />
                        )}
                        <div className="border-t border-zinc-200 dark:border-zinc-800" />
                        {audioConfig ? (
                            <AudioConfigForm initial={audioConfig} />
                        ) : (
                            <SectionLoadError
                                title="No pudimos cargar la configuración de audio"
                                detail={audioConfigError}
                            />
                        )}
                    </div>
                )}
                {activeTab === 'kb' && (
                    <KnowledgeBaseEditor initialContent={kbContent ?? ''} />
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Mensaje inline cuando una sub-sección de Integraciones no carga.
// En producción Next.js esconde el mensaje real al cliente; aquí
// mostramos lo poco que tenemos y dejamos el detalle completo en
// los logs del servidor (ver console.error del callBackend).
// ─────────────────────────────────────────────────────────────
function SectionLoadError({ title, detail }: { title: string; detail: string | null }) {
    return (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 p-5">
            <h3 className="text-sm font-bold text-rose-800 dark:text-rose-200 mb-1">
                ⚠️ {title}
            </h3>
            <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
                {detail ??
                    'El backend respondió con un error. Revisa los logs del API o contacta al super-admin.'}
            </p>
            <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-2">
                Tip: el equipo de plataforma puede buscar este incidente en{' '}
                <code className="font-mono">/super-admin/logs</code> filtrando por nivel ERROR.
            </p>
        </div>
    );
}
