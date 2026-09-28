'use client';

import { useState, useTransition } from 'react';
import {
    Send,
    KeyRound,
    Copy,
    CheckCircle2,
    AlertTriangle,
    RefreshCw,
    Power,
    ExternalLink,
} from 'lucide-react';
import {
    connectMyTelegram,
    disconnectMyTelegram,
    verifyMyTelegram,
} from '@/app/actions/telegram-config';
import type {
    PublicTelegramConfig,
    TelegramCardState,
    TelegramWebhookStatus,
} from '@/app/actions/telegram-config.types';
import { formatAppointmentCompact } from '@/lib/date';

type Props = { initial: TelegramCardState };

const INPUT =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-all dark:text-white';
const SECONDARY_BTN =
    'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-2';

/**
 * Canal de Telegram (docs/PLAN_TELEGRAM.md §4.4, T1, T9).
 *
 * Lo único que hace la clínica es pegar el token de @BotFather. Registrar el
 * webhook, el secreto y la verificación los hace la API, y el canal NO queda
 * activo hasta que Telegram confirma que apunta a AgenIA.
 */
export default function TelegramChannelForm({ initial }: Props) {
    if (!initial.enabled) return <TelegramDisabled />;
    return <TelegramChannel initial={initial.config} />;
}

function Header() {
    return (
        <section>
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-sky-100 dark:bg-sky-900/30 p-2.5 text-sky-600 dark:text-sky-400">
                    <Send className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                        Canal de Telegram
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                        El mismo asistente de WhatsApp, también por Telegram. Los dos
                        canales funcionan a la vez: el paciente puede escribir por el que
                        prefiera y su ficha es una sola. El token se{' '}
                        <strong>cifra con AES-256-GCM</strong> y nunca vuelve al navegador.
                    </p>
                </div>
            </div>
        </section>
    );
}

function TelegramDisabled() {
    return (
        <div className="space-y-6">
            <Header />
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                Telegram no está habilitado en este servidor todavía. Cuando el equipo de
                AgenIA lo active, aquí podrá conectar el bot de su clínica en un paso.
            </div>
        </div>
    );
}

function TelegramChannel({ initial }: { initial: PublicTelegramConfig }) {
    const [config, setConfig] = useState<PublicTelegramConfig>(initial);
    const [status, setStatus] = useState<TelegramWebhookStatus | null>(null);
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [isPending, startTransition] = useTransition();

    const run = (fn: () => Promise<void>) => {
        setError(null);
        setNotice(null);
        startTransition(fn);
    };

    const handleConnect = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        run(async () => {
            const res = await connectMyTelegram(token);
            if (res.success) {
                setConfig(res.data);
                setStatus(null);
                setToken('');
                setNotice('✅ Bot conectado. Ya puede escribirle desde Telegram.');
            } else {
                setError(res.error);
            }
        });
    };

    const handleVerify = () =>
        run(async () => {
            const res = await verifyMyTelegram();
            if (res.success) {
                setStatus(res.data);
                setConfig(res.data);
            } else {
                setError(res.error);
            }
        });

    const handleDisconnect = () => {
        if (!confirm('¿Desconectar el bot? Dejará de contestar por Telegram hasta que lo vuelva a conectar.')) {
            return;
        }
        run(async () => {
            const res = await disconnectMyTelegram();
            if (res.success) {
                setConfig(res.data);
                setStatus(null);
                setNotice('El bot quedó desconectado.');
            } else {
                setError(res.error);
            }
        });
    };

    const handleCopy = (value: string) => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="space-y-8">
            <Header />

            {/* ── Estado ───────────────────────────────────── */}
            {config.connected && (
                <section
                    className={`rounded-2xl border p-5 space-y-3 ${config.isActive
                        ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-900/10'
                        : 'border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-900/10'}`}
                >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        {config.isActive ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                        )}
                        <strong className="text-zinc-900 dark:text-white">
                            {config.isActive ? 'Conectado' : 'Desconectado'}
                        </strong>
                        {config.botUsername && (
                            <span className="text-zinc-600 dark:text-zinc-400">
                                · @{config.botUsername}
                            </span>
                        )}
                        {config.botTokenLast4 && (
                            <span className="text-zinc-500 dark:text-zinc-500 font-mono text-xs">
                                · token •••{config.botTokenLast4}
                            </span>
                        )}
                        {config.lastWebhookSetAt && (
                            <span className="text-zinc-500 dark:text-zinc-500 text-xs">
                                · conectado el {formatAppointmentCompact(new Date(config.lastWebhookSetAt))}
                            </span>
                        )}
                    </div>

                    {config.lastError && (
                        <p className="text-sm text-amber-800 dark:text-amber-300">
                            {config.lastError}
                        </p>
                    )}

                    {config.botLink && config.isActive && (
                        <div className="space-y-1.5">
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                Comparta este enlace con sus pacientes (en la web, en la sede,
                                en el recordatorio). Al abrirlo, el bot los saluda:
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-200 break-all">
                                    {config.botLink}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => handleCopy(config.botLink!)}
                                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
                                >
                                    {copied ? (
                                        <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Copiado</>
                                    ) : (
                                        <><Copy className="w-3.5 h-3.5" /> Copiar</>
                                    )}
                                </button>
                                <a
                                    href={config.botLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" /> Abrir
                                </a>
                            </div>
                        </div>
                    )}

                    {status && (
                        <div className="rounded-xl bg-white/70 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 space-y-1">
                            <div>
                                Webhook:{' '}
                                <strong className={status.webhookOk ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                                    {status.webhookOk ? 'apunta a AgenIA' : 'NO apunta a AgenIA — vuelva a conectar el bot'}
                                </strong>
                            </div>
                            {status.pendingUpdateCount !== null && status.pendingUpdateCount > 0 && (
                                <div>Mensajes esperando entrega: {status.pendingUpdateCount}</div>
                            )}
                            {status.telegramLastError && (
                                <div>Último error que vio Telegram: {status.telegramLastError}</div>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" onClick={handleVerify} disabled={isPending} className={SECONDARY_BTN}>
                            <RefreshCw className={`w-4 h-4 ${isPending ? 'animate-spin' : ''}`} />
                            Verificar conexión
                        </button>
                        {config.isActive && (
                            <button type="button" onClick={handleDisconnect} disabled={isPending} className={SECONDARY_BTN}>
                                <Power className="w-4 h-4" />
                                Desconectar
                            </button>
                        )}
                    </div>
                </section>
            )}

            {/* ── Conectar ─────────────────────────────────── */}
            <form onSubmit={handleConnect} className="space-y-5">
                {!config.connected && (
                    <ol className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-2 text-sm text-zinc-700 dark:text-zinc-300 list-decimal list-inside">
                        <li>
                            En Telegram, abra{' '}
                            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-700 dark:text-sky-400 font-semibold underline">
                                @BotFather
                            </a>{' '}
                            y envíele <code className="font-mono">/newbot</code>.
                        </li>
                        <li>Elija el nombre que verán sus pacientes (ej. «Clínica San Vicente») y un usuario que termine en <code className="font-mono">bot</code>.</li>
                        <li>BotFather le responde con un <strong>token</strong>. Cópielo y péguelo aquí abajo.</li>
                    </ol>
                )}

                <div>
                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-zinc-400" />
                        {config.connected ? 'Cambiar el token del bot' : 'Token del bot'}
                    </label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        placeholder={config.connected
                            ? 'Pegue un token nuevo solo si cambió de bot o lo regeneró en @BotFather'
                            : 'Ej: 123456789:AAH…'}
                        className={INPUT}
                    />
                </div>

                {error && (
                    <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                        ❌ {error}
                    </div>
                )}
                {notice && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                        {notice}
                    </div>
                )}

                <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 flex justify-end">
                    <button
                        type="submit"
                        disabled={isPending || !token.trim()}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                        {isPending ? 'Conectando…' : config.connected ? 'Reconectar con este token' : 'Conectar bot de Telegram'}
                    </button>
                </div>
            </form>
        </div>
    );
}
