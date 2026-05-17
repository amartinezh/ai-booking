'use client';

import { useState, useTransition } from 'react';
import { Sparkles, BrainCircuit, Cpu, ShieldCheck, KeyRound } from 'lucide-react';
import {
    updateMyAiConfig,
    PROVIDER_MODELS,
    type LlmProvider,
    type PublicAiConfig,
    type SaveAiConfigInput,
} from '@/app/actions/ai-config';

type Props = {
    initial: PublicAiConfig;
};

const PROVIDER_META: Record<
    Exclude<LlmProvider, 'NONE'>,
    {
        label: string;
        tagline: string;
        Icon: React.ComponentType<{ className?: string }>;
        accent: string;
        accentBg: string;
        accentText: string;
        helpUrl: string;
    }
> = {
    GEMINI: {
        label: 'Google Gemini',
        tagline: 'Multimodal nativo (audio + texto). Recomendado para dictado clínico.',
        Icon: Sparkles,
        accent: 'border-sky-500',
        accentBg: 'bg-sky-50 dark:bg-sky-900/20',
        accentText: 'text-sky-700 dark:text-sky-300',
        helpUrl: 'https://aistudio.google.com/app/apikey',
    },
    CHATGPT: {
        label: 'OpenAI ChatGPT',
        tagline: 'GPT-4o + Whisper para transcripción. Útil si ya tienes cuenta OpenAI.',
        Icon: BrainCircuit,
        accent: 'border-emerald-500',
        accentBg: 'bg-emerald-50 dark:bg-emerald-900/20',
        accentText: 'text-emerald-700 dark:text-emerald-300',
        helpUrl: 'https://platform.openai.com/api-keys',
    },
    CLAUDE: {
        label: 'Anthropic Claude',
        tagline: 'Respuestas largas y razonamiento clínico (sin audio nativo).',
        Icon: Cpu,
        accent: 'border-amber-500',
        accentBg: 'bg-amber-50 dark:bg-amber-900/20',
        accentText: 'text-amber-700 dark:text-amber-300',
        helpUrl: 'https://console.anthropic.com/settings/keys',
    },
};

export default function AiIntegrationForm({ initial }: Props) {
    const [provider, setProvider] = useState<LlmProvider>(initial.activeProvider);
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState<string>(initial.model ?? '');
    const [openaiOrgId, setOpenaiOrgId] = useState<string>(initial.openaiOrganizationId ?? '');
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const modelOptions =
        provider === 'NONE' ? [] : PROVIDER_MODELS[provider as Exclude<LlmProvider, 'NONE'>];

    const effectiveModel = model || modelOptions[0] || '';

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaved(false);
        setError(null);

        const payload: SaveAiConfigInput = { activeProvider: provider };
        if (provider !== 'NONE') {
            if (apiKey.trim()) payload.apiKey = apiKey.trim();
            payload.model = effectiveModel;
            if (provider === 'CHATGPT' && openaiOrgId.trim()) {
                payload.openaiOrganizationId = openaiOrgId.trim();
            }
        }

        startTransition(async () => {
            const res = await updateMyAiConfig(payload);
            if (res.success) {
                setSaved(true);
                setApiKey(''); // limpiar campo por seguridad
                setTimeout(() => setSaved(false), 4000);
            } else {
                setError(res.error);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-10">
            {/* ── Header explicativo ─────────────────────────── */}
            <section>
                <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-indigo-100 dark:bg-indigo-900/30 p-2.5 text-indigo-600 dark:text-indigo-400">
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                            Integración de IA
                        </h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                            Elija el proveedor de inteligencia artificial que atenderá a sus pacientes
                            por WhatsApp y los dictados clínicos de sus médicos. Sus credenciales se
                            cifran en la base de datos con <strong>AES-256-GCM</strong> y nunca se
                            almacenan en texto plano.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Selector visual de proveedor ───────────────── */}
            <section>
                <div className="mb-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Proveedor activo
                    </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(Object.keys(PROVIDER_META) as Array<Exclude<LlmProvider, 'NONE'>>).map(p => (
                        <ProviderCard
                            key={p}
                            providerKey={p}
                            active={provider === p}
                            onClick={() => {
                                setProvider(p);
                                if (!modelOptions.includes(model)) {
                                    setModel(PROVIDER_MODELS[p][0]);
                                }
                            }}
                        />
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => setProvider('NONE')}
                    className={`mt-3 text-xs font-semibold underline-offset-2 hover:underline ${
                        provider === 'NONE'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                >
                    {provider === 'NONE'
                        ? '● IA desactivada para esta clínica'
                        : 'Desactivar IA (modo manual)'}
                </button>
            </section>

            {/* ── Formulario dinámico por proveedor ──────────── */}
            {provider !== 'NONE' && (
                <section
                    className={`rounded-2xl border-2 ${
                        PROVIDER_META[provider as Exclude<LlmProvider, 'NONE'>].accent
                    } ${
                        PROVIDER_META[provider as Exclude<LlmProvider, 'NONE'>].accentBg
                    } p-5 md:p-6 space-y-5`}
                >
                    <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-zinc-500" />
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                            Credenciales de{' '}
                            {PROVIDER_META[provider as Exclude<LlmProvider, 'NONE'>].label}
                        </h3>
                    </div>

                    {/* API Key */}
                    <div>
                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            API Key
                        </label>
                        <input
                            type="password"
                            autoComplete="off"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder={
                                initial.hasApiKey && initial.activeProvider === provider
                                    ? `•••••••••••••••${initial.apiKeyLast4 ?? '••••'} (dejar vacío para mantener)`
                                    : 'Pegue aquí su clave de API'
                            }
                            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                        />
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                            Obtenga la suya en{' '}
                            <a
                                href={
                                    PROVIDER_META[provider as Exclude<LlmProvider, 'NONE'>].helpUrl
                                }
                                target="_blank"
                                rel="noreferrer"
                                className={`font-semibold underline ${
                                    PROVIDER_META[provider as Exclude<LlmProvider, 'NONE'>]
                                        .accentText
                                }`}
                            >
                                el panel del proveedor
                            </a>
                            . La clave se cifra en el backend antes de almacenarse.
                        </p>
                    </div>

                    {/* Model selector */}
                    <div>
                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Modelo
                        </label>
                        <select
                            value={effectiveModel}
                            onChange={e => setModel(e.target.value)}
                            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                        >
                            {modelOptions.map(m => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Campos extra solo para OpenAI */}
                    {provider === 'CHATGPT' && (
                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                                OpenAI Organization ID{' '}
                                <span className="text-zinc-400 font-normal">(opcional)</span>
                            </label>
                            <input
                                type="text"
                                value={openaiOrgId}
                                onChange={e => setOpenaiOrgId(e.target.value)}
                                placeholder="org_..."
                                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                            />
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                                Útil si tu cuenta pertenece a varias organizaciones OpenAI.
                            </p>
                        </div>
                    )}
                </section>
            )}

            {/* ── Estado actual ──────────────────────────────── */}
            {initial.activeProvider !== 'NONE' && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                    <strong className="text-zinc-800 dark:text-zinc-200">Estado actual:</strong>{' '}
                    proveedor <code className="font-mono">{initial.activeProvider}</code>, modelo{' '}
                    <code className="font-mono">{initial.model ?? '—'}</code>, API key{' '}
                    {initial.hasApiKey
                        ? `terminada en •••${initial.apiKeyLast4}`
                        : 'no configurada'}
                    .
                </div>
            )}

            {/* ── Errores ────────────────────────────────────── */}
            {error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    ❌ {error}
                </div>
            )}

            {/* ── Footer ─────────────────────────────────────── */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                    {isPending ? (
                        <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                />
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8v8H4z"
                                />
                            </svg>
                            Guardando...
                        </>
                    ) : saved ? (
                        <>
                            <span>✅</span> Configuración guardada
                        </>
                    ) : (
                        <>
                            <span>💾</span> Guardar integración
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}

// ─────────────────────────────────────────────────────────────
// Sub-componente: tarjeta selector de proveedor
// ─────────────────────────────────────────────────────────────
function ProviderCard({
    providerKey,
    active,
    onClick,
}: {
    providerKey: Exclude<LlmProvider, 'NONE'>;
    active: boolean;
    onClick: () => void;
}) {
    const meta = PROVIDER_META[providerKey];
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-left w-full rounded-2xl border bg-white dark:bg-zinc-900 p-4 transition-all ${
                active
                    ? `ring-2 ${meta.accent.replace('border-', 'ring-')} ${meta.accent} ${meta.accentBg}`
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
            }`}
        >
            <div className="flex items-start gap-3">
                <div
                    className={`rounded-xl p-2.5 ${meta.accentBg} ${meta.accentText}`}
                >
                    <meta.Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-zinc-900 dark:text-white">
                            {meta.label}
                        </span>
                        <span
                            className={`text-xs font-semibold ${
                                active ? meta.accentText : 'text-zinc-400'
                            }`}
                        >
                            {active ? '● Activo' : 'Inactivo'}
                        </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                        {meta.tagline}
                    </p>
                </div>
            </div>
        </button>
    );
}
