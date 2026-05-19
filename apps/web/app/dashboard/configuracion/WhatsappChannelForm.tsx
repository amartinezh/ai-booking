'use client';

import { useState, useTransition } from 'react';
import {
    MessageSquare,
    Phone,
    KeyRound,
    Webhook,
    Copy,
    CheckCircle2,
    Info,
} from 'lucide-react';
import { updateMyWhatsappConfig } from '@/app/actions/whatsapp-config';
import type {
    PublicWhatsappConfig,
    SaveWhatsappConfigInput,
} from '@/app/actions/whatsapp-config.types';

type Props = {
    initial: PublicWhatsappConfig;
};

export default function WhatsappChannelForm({ initial }: Props) {
    const [phoneNumberId, setPhoneNumberId] = useState(initial.phoneNumberId ?? '');
    const [businessAccountId, setBusinessAccountId] = useState(
        initial.businessAccountId ?? '',
    );
    const [displayPhoneNumber, setDisplayPhoneNumber] = useState(
        initial.displayPhoneNumber ?? '',
    );
    const [verifyToken, setVerifyToken] = useState(initial.verifyToken ?? '');
    const [accessToken, setAccessToken] = useState('');
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedField, setCopiedField] = useState<'url' | 'token' | null>(null);

    const handleCopy = (value: string, field: 'url' | 'token') => {
        navigator.clipboard.writeText(value);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 1500);
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaved(false);
        setError(null);

        const payload: SaveWhatsappConfigInput = {
            phoneNumberId: phoneNumberId.trim() || null,
            businessAccountId: businessAccountId.trim() || null,
            displayPhoneNumber: displayPhoneNumber.trim() || null,
            verifyToken: verifyToken.trim() || null,
        };
        if (accessToken.trim()) {
            payload.accessToken = accessToken.trim();
        }

        startTransition(async () => {
            const res = await updateMyWhatsappConfig(payload);
            if (res.success) {
                setSaved(true);
                setAccessToken('');
                if (res.data.verifyToken) setVerifyToken(res.data.verifyToken);
                setTimeout(() => setSaved(false), 4000);
            } else {
                setError(res.error);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-8">
            {/* ── Header ───────────────────────────────────── */}
            <section>
                <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-emerald-100 dark:bg-emerald-900/30 p-2.5 text-emerald-600 dark:text-emerald-400">
                        <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                            Canal de WhatsApp (Meta)
                        </h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                            Conecte su cuenta de WhatsApp Business API para que AgenIA
                            atienda a sus pacientes 24/7. El Access Token se{' '}
                            <strong>cifra con AES-256-GCM</strong> en la base de datos.
                            Si no tiene aún sus credenciales, siga la{' '}
                            <a
                                href="/guia/whatsapp"
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-700 dark:text-emerald-400 font-semibold underline"
                            >
                                guía paso a paso
                            </a>
                            .
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Webhook URL (lectura) ────────────────────── */}
            <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <Webhook className="w-4 h-4 text-zinc-500" />
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                        URL del Webhook (péguela en Meta)
                    </h3>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    En el panel de Meta for Developers → su App → WhatsApp →
                    Configuration → Webhook → Edit, pegue:
                </p>
                <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-200 break-all">
                        {initial.webhookCallbackUrl}
                    </code>
                    <button
                        type="button"
                        onClick={() => handleCopy(initial.webhookCallbackUrl, 'url')}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
                    >
                        {copiedField === 'url' ? (
                            <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                Copiado
                            </>
                        ) : (
                            <>
                                <Copy className="w-3.5 h-3.5" />
                                Copiar
                            </>
                        )}
                    </button>
                </div>
            </section>

            {/* ── Campos editables ─────────────────────────── */}
            <section className="space-y-5">
                {/* Phone Number ID */}
                <div>
                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-2">
                        <Phone className="w-4 h-4 text-zinc-400" />
                        Phone Number ID
                        <span className="text-rose-500">*</span>
                    </label>
                    <input
                        type="text"
                        required
                        value={phoneNumberId}
                        onChange={e => setPhoneNumberId(e.target.value)}
                        placeholder="Ej: 123456789012345"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                        ID que Meta asigna a su línea (15–17 dígitos). Lo encuentra en
                        WhatsApp → API Setup.
                    </p>
                </div>

                {/* WABA ID */}
                <div>
                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        WhatsApp Business Account ID{' '}
                        <span className="text-zinc-400 font-normal">(opcional)</span>
                    </label>
                    <input
                        type="text"
                        value={businessAccountId}
                        onChange={e => setBusinessAccountId(e.target.value)}
                        placeholder="Ej: 987654321098765"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                </div>

                {/* Display number */}
                <div>
                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Número visible{' '}
                        <span className="text-zinc-400 font-normal">(opcional)</span>
                    </label>
                    <input
                        type="text"
                        value={displayPhoneNumber}
                        onChange={e => setDisplayPhoneNumber(e.target.value)}
                        placeholder="+57 300 123 4567"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                        Solo informativo, se muestra en el panel.
                    </p>
                </div>

                {/* Access Token */}
                <div>
                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-zinc-400" />
                        Access Token (permanente)
                        {!initial.hasAccessToken && (
                            <span className="text-rose-500">*</span>
                        )}
                    </label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={accessToken}
                        onChange={e => setAccessToken(e.target.value)}
                        placeholder={
                            initial.hasAccessToken
                                ? `••••••••••••••••${initial.accessTokenLast4 ?? '••••'} (dejar vacío para mantener)`
                                : 'Pegue su token permanente (empieza por EAA…)'
                        }
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                    />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                        Use el token <strong>permanente</strong> de un System User. Los
                        tokens temporales de 24h dejan de funcionar al día siguiente.
                    </p>
                </div>

                {/* Verify Token */}
                <div>
                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Verify Token (Webhook){' '}
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={verifyToken}
                            onChange={e => setVerifyToken(e.target.value)}
                            placeholder="Generado automáticamente al guardar"
                            className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                        />
                        {verifyToken && (
                            <button
                                type="button"
                                onClick={() => handleCopy(verifyToken, 'token')}
                                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
                            >
                                {copiedField === 'token' ? (
                                    <>
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                        Copiado
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3.5 h-3.5" />
                                        Copiar
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                        Pegue este mismo valor en Meta → Webhook → Verify Token al
                        momento de configurar la suscripción. Si lo deja vacío,
                        generamos uno seguro automáticamente.
                    </p>
                </div>
            </section>

            {/* ── Estado actual ────────────────────────────── */}
            {(initial.isActive || initial.hasAccessToken) && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
                    <Info className="w-4 h-4 text-zinc-400" />
                    <span>
                        <strong className="text-zinc-800 dark:text-zinc-200">
                            Estado actual:
                        </strong>{' '}
                        canal{' '}
                        <code
                            className={`font-mono font-semibold ${
                                initial.isActive
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                            }`}
                        >
                            {initial.isActive ? 'ACTIVO' : 'INACTIVO'}
                        </code>
                        {' · '}
                        Phone ID{' '}
                        <code className="font-mono">
                            {initial.phoneNumberId ?? '—'}
                        </code>
                        {' · '}
                        Token{' '}
                        {initial.hasAccessToken
                            ? `terminado en •••${initial.accessTokenLast4}`
                            : 'no configurado'}
                        .
                    </span>
                </div>
            )}

            {/* ── Error ────────────────────────────────────── */}
            {error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    ❌ {error}
                </div>
            )}

            {/* ── Footer ───────────────────────────────────── */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                    {isPending ? (
                        <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            Guardando...
                        </>
                    ) : saved ? (
                        <>
                            <span>✅</span> Conexión guardada
                        </>
                    ) : (
                        <>
                            <span>💾</span> Guardar canal de WhatsApp
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}
