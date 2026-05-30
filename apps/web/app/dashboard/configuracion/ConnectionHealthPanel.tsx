'use client';

import { useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Brain,
    CheckCircle2,
    Copy,
    Gauge,
    Loader2,
    PhoneCall,
    Smartphone,
} from 'lucide-react';
import { diagnoseLlm, diagnoseMeta } from '@/app/actions/integrations';
import type {
    LlmDiagnosisResult,
    MetaDiagnosisResult,
} from '@/app/actions/integrations.types';

const PROVIDER_LABEL: Record<'GEMINI' | 'CHATGPT' | 'CLAUDE', string> = {
    GEMINI: 'Google Gemini',
    CHATGPT: 'OpenAI ChatGPT',
    CLAUDE: 'Anthropic Claude',
};

/**
 * Panel "Salud de la Conexión": dispara los diagnósticos de Gemini y Meta de
 * forma independiente (cada uno con su propio estado de carga y resultado) y
 * renderiza un feedback enterprise (banner de éxito con métricas técnicas o
 * banner de alerta con el error crudo copiable para debugging).
 */
export default function ConnectionHealthPanel() {
    const [llmLoading, setLlmLoading] = useState(false);
    const [llmResult, setLlmResult] = useState<LlmDiagnosisResult | null>(null);

    const [metaLoading, setMetaLoading] = useState(false);
    const [metaResult, setMetaResult] = useState<MetaDiagnosisResult | null>(
        null,
    );

    const runLlm = async () => {
        setLlmLoading(true);
        setLlmResult(null);
        try {
            setLlmResult(await diagnoseLlm());
        } catch (e: any) {
            setLlmResult({
                success: false,
                error_code: 'UNKNOWN',
                error_message: e?.message ?? 'Error inesperado en el cliente.',
            });
        } finally {
            setLlmLoading(false);
        }
    };

    const runMeta = async () => {
        setMetaLoading(true);
        setMetaResult(null);
        try {
            setMetaResult(await diagnoseMeta());
        } catch (e: any) {
            setMetaResult({
                success: false,
                error_code: 'UNKNOWN',
                error_message: e?.message ?? 'Error inesperado en el cliente.',
            });
        } finally {
            setMetaLoading(false);
        }
    };

    return (
        <section className="space-y-5">
            {/* ── Header ───────────────────────────────────── */}
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-indigo-100 dark:bg-indigo-900/30 p-2.5 text-indigo-600 dark:text-indigo-400">
                    <Activity className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                        Salud de la Conexión
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                        Valide en tiempo real que sus proveedores externos respondan con
                        las credenciales guardadas. Las pruebas no envían mensajes ni
                        consumen cuota significativa.
                    </p>
                </div>
            </div>

            {/* ── Botones ──────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row gap-3">
                <button
                    type="button"
                    onClick={runLlm}
                    disabled={llmLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {llmLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Brain className="w-4 h-4" />
                    )}
                    {llmLoading ? 'Probando servicio…' : 'Probar Servicio'}
                </button>

                <button
                    type="button"
                    onClick={runMeta}
                    disabled={metaLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {metaLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Smartphone className="w-4 h-4" />
                    )}
                    {metaLoading ? 'Probando Meta…' : 'Probar Meta API'}
                </button>
            </div>

            {/* ── Resultados ───────────────────────────────── */}
            <div className="grid gap-4 md:grid-cols-2">
                <LlmResultCard loading={llmLoading} result={llmResult} />
                <MetaResultCard loading={metaLoading} result={metaResult} />
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────
// Tarjeta de resultado del LLM activo (Gemini / OpenAI / Claude)
// ─────────────────────────────────────────────────────────────
function LlmResultCard({
    loading,
    result,
}: {
    loading: boolean;
    result: LlmDiagnosisResult | null;
}) {
    if (loading) return <PendingCard label="Contactando al proveedor de IA…" />;
    if (!result) return <IdleCard label="🧠 Servicio de IA sin probar aún" />;

    const providerLabel = result.provider ? PROVIDER_LABEL[result.provider] : 'Proveedor';

    if (result.success) {
        return (
            <SuccessBanner
                title={`🧠 ${providerLabel}: conexión exitosa`}
                metrics={[
                    {
                        icon: <Brain className="w-3.5 h-3.5" />,
                        label: 'Proveedor',
                        value: providerLabel,
                    },
                    {
                        icon: <Brain className="w-3.5 h-3.5" />,
                        label: 'Modelo',
                        value: result.model,
                    },
                    {
                        icon: <Gauge className="w-3.5 h-3.5" />,
                        label: 'Latencia (RTT)',
                        value: `${result.rtt_ms} ms`,
                    },
                    {
                        icon: <Brain className="w-3.5 h-3.5" />,
                        label: 'Respuesta del modelo',
                        value: result.model_response,
                    },
                ]}
            />
        );
    }

    const titleSuffix = result.provider ? ` (${providerLabel}${result.model ? ` · ${result.model}` : ''})` : '';
    return (
        <ErrorBanner
            title={`💔 Fallo en el servicio${titleSuffix}: ${result.error_code}`}
            message={result.error_message}
            rttMs={result.rtt_ms}
        />
    );
}

// ─────────────────────────────────────────────────────────────
// Tarjeta de resultado Meta
// ─────────────────────────────────────────────────────────────
function MetaResultCard({
    loading,
    result,
}: {
    loading: boolean;
    result: MetaDiagnosisResult | null;
}) {
    if (loading) return <PendingCard label="Verificando con Meta Graph API…" />;
    if (!result) return <IdleCard label="📱 Meta API sin probar aún" />;

    if (result.success) {
        return (
            <SuccessBanner
                title="📱 Meta Business API Verificada"
                metrics={[
                    {
                        icon: <PhoneCall className="w-3.5 h-3.5" />,
                        label: 'Número verificado',
                        value: result.display_number ?? '—',
                    },
                    {
                        icon: <Smartphone className="w-3.5 h-3.5" />,
                        label: 'Phone ID',
                        value: result.phone_id,
                    },
                    ...(result.verified_name
                        ? [
                              {
                                  icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                                  label: 'Nombre',
                                  value: result.verified_name,
                              },
                          ]
                        : []),
                ]}
            />
        );
    }

    return (
        <ErrorBanner
            title={`💔 Fallo en Meta: ${result.error_code}`}
            message={result.error_message}
        />
    );
}

// ─────────────────────────────────────────────────────────────
// Sub-componentes de presentación
// ─────────────────────────────────────────────────────────────
function IdleCard({ label }: { label: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 px-4 py-5 text-sm text-zinc-400 dark:text-zinc-500 flex items-center justify-center">
            {label}
        </div>
    );
}

function PendingCard({ label }: { label: string }) {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {label}
        </div>
    );
}

type Metric = { icon: React.ReactNode; label: string; value: string };

function SuccessBanner({
    title,
    metrics,
}: {
    title: string;
    metrics: Metric[];
}) {
    return (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-4">
            <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                    {title}
                </h3>
            </div>
            <dl className="space-y-2">
                {metrics.map(m => (
                    <div
                        key={m.label}
                        className="flex items-center justify-between gap-3 text-xs"
                    >
                        <dt className="flex items-center gap-1.5 text-emerald-700/80 dark:text-emerald-300/80">
                            {m.icon}
                            {m.label}
                        </dt>
                        <dd className="font-mono font-semibold text-emerald-900 dark:text-emerald-100 break-all text-right">
                            {m.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

function ErrorBanner({
    title,
    message,
    rttMs,
}: {
    title: string;
    message: string;
    rttMs?: number;
}) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 p-4">
            <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <h3 className="text-sm font-bold text-rose-800 dark:text-rose-200">
                    {title}
                </h3>
            </div>
            {typeof rttMs === 'number' && (
                <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mb-2 flex items-center gap-1">
                    <Gauge className="w-3 h-3" /> Falló tras {rttMs} ms
                </p>
            )}
            <div className="relative">
                <pre className="rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-zinc-950 px-3 py-2 pr-10 text-[11px] font-mono text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                    {message}
                </pre>
                <button
                    type="button"
                    onClick={handleCopy}
                    title="Copiar error"
                    className="absolute top-2 right-2 rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-zinc-900 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/40"
                >
                    {copied ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                        <Copy className="w-3.5 h-3.5" />
                    )}
                </button>
            </div>
        </div>
    );
}
