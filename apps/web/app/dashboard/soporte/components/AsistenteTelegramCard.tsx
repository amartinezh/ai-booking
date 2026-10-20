'use client';

import { useEffect, useState, useTransition } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatTimeOnly } from '@/lib/date';
import {
    cambiarAvisosAsistente,
    cerrarConversacionAsistente,
    generarCodigoAsistente,
} from '@/app/actions/support-bot';
import type { CodigoAsistente, EstadoAsistente } from '@/app/actions/support-bot.types';

/** «482913» → «482 913»: así se lee y se escribe sin equivocarse. */
export function codigoLegible(codigo: string): string {
    return codigo.length === 6 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo;
}

/** Segundos que le quedan al código, nunca negativos. */
export function segundosRestantes(venceEn: string, ahora: number = Date.now()): number {
    return Math.max(0, Math.ceil((Date.parse(venceEn) - ahora) / 1000));
}

function mmss(segundos: number): string {
    const m = Math.floor(segundos / 60);
    const s = segundos % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * «Asistente de soporte en Telegram» (docs/PLAN_BOT_SOPORTE.md §3.1): el código se
 * pide en CADA conversación. Se genera aquí, al pedirlo (no queda siempre en
 * pantalla), sirve una vez y vence a los 10 minutos.
 *
 * Abajo, a dónde llegan los avisos de sus casos (§3.6: cuando los toman y cuando
 * quedan resueltos), con el botón para apagarlos o volver a encenderlos.
 */
export default function AsistenteTelegramCard({ estadoInicial }: { estadoInicial: EstadoAsistente }) {
    const [estado, setEstado] = useState(estadoInicial);
    const [codigo, setCodigo] = useState<CodigoAsistente | null>(null);
    const [restantes, setRestantes] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [pendiente, startTransition] = useTransition();

    useEffect(() => {
        if (!codigo) return;
        const tic = () => setRestantes(segundosRestantes(codigo.venceEn));
        tic();
        const id = setInterval(tic, 1000);
        return () => clearInterval(id);
    }, [codigo]);

    const generar = () =>
        startTransition(async () => {
            setError(null);
            const r = await generarCodigoAsistente();
            if (r.ok) setCodigo(r.data);
            else setError(r.error);
        });

    const cerrar = () =>
        startTransition(async () => {
            setError(null);
            const r = await cerrarConversacionAsistente();
            if (r.ok) setEstado(r.data);
            else setError(r.error);
        });

    const avisos = (activos: boolean) =>
        startTransition(async () => {
            setError(null);
            const r = await cambiarAvisosAsistente(activos);
            if (r.ok) setEstado(r.data);
            else setError(r.error);
        });

    const vigente = codigo && restantes > 0;
    const bot = estado.botUsername ? `@${estado.botUsername}` : 'el bot de soporte';

    return (
        <section
            aria-labelledby="asistente-telegram"
            className="bg-white rounded-2xl ring-1 ring-sky-200 p-5 space-y-4"
        >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h2 id="asistente-telegram" className="text-base font-semibold text-zinc-900">
                        🤖 Asistente de soporte en Telegram
                    </h2>
                    <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
                        Pregúntale cómo se hace algo en AgenIA o repórtale una falla desde tu celular. Para cada
                        conversación necesitas un código nuevo de este panel.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={generar}
                    disabled={pendiente}
                    className="inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm transition-colors shrink-0"
                >
                    {vigente ? 'Generar otro código' : 'Generar código'}
                </button>
            </div>

            {error && (
                <p role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                    {error}
                </p>
            )}

            {codigo && (
                <div className="flex flex-col sm:flex-row gap-4 items-start rounded-xl bg-sky-50 p-4">
                    {vigente ? (
                        <>
                            <div className="rounded-xl bg-white p-2 ring-1 ring-zinc-200">
                                <QRCodeSVG
                                    value={codigo.enlace}
                                    size={128}
                                    level="M"
                                    marginSize={1}
                                    bgColor="#ffffff"
                                    fgColor="#000000"
                                    title={`Código QR para abrir ${bot} en Telegram`}
                                />
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-sky-800">Tu código</p>
                                <p
                                    className="text-3xl font-bold tracking-widest text-zinc-900 font-mono"
                                    aria-label={`Código ${codigo.codigo.split('').join(' ')}`}
                                >
                                    {codigoLegible(codigo.codigo)}
                                </p>
                                <p className="text-xs text-zinc-600">
                                    Escríbelo en {bot}, o escanea el QR con tu celular. Vence en{' '}
                                    <span className="font-semibold tabular-nums">{mmss(restantes)}</span> y sirve
                                    una sola vez.
                                </p>
                                <a
                                    href={codigo.enlace}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex text-sm font-semibold text-sky-700 hover:underline"
                                >
                                    Abrir en Telegram
                                </a>
                                <p className="text-xs text-amber-700">
                                    Nunca compartas este código: nadie de AgenIA te lo va a pedir.
                                </p>
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-zinc-600">El código venció. Genera otro cuando lo necesites.</p>
                    )}
                </div>
            )}

            {estado.conversacion && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-emerald-50 p-3">
                    <p className="text-sm text-emerald-800">
                        Conversación abierta
                        {estado.conversacion.telegramName ? ` con ${estado.conversacion.telegramName}` : ''} desde
                        las {formatTimeOnly(estado.conversacion.desde)}. Se cierra sola a los{' '}
                        {estado.conversacionMinutos} minutos sin mensajes.
                    </p>
                    <button
                        type="button"
                        onClick={cerrar}
                        disabled={pendiente}
                        className="text-sm font-semibold text-emerald-800 hover:underline disabled:opacity-50"
                    >
                        Cerrar
                    </button>
                </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-100 pt-3">
                <p className="text-sm text-zinc-600">
                    {!estado.avisos.activos
                        ? 'No recibes avisos de tus casos por Telegram.'
                        : estado.avisos.destino
                          ? `Cuando tomen o resuelvan uno de tus casos, te aviso por Telegram a ${estado.avisos.destino}.`
                          : 'Cuando converses con el asistente, te avisará por Telegram cuando tomen o resuelvan uno de tus casos.'}
                </p>
                <button
                    type="button"
                    onClick={() => avisos(!estado.avisos.activos)}
                    disabled={pendiente}
                    className="text-sm font-semibold text-sky-700 hover:underline disabled:opacity-50 shrink-0"
                >
                    {estado.avisos.activos ? 'Dejar de recibir avisos' : 'Recibir avisos'}
                </button>
            </div>
        </section>
    );
}
