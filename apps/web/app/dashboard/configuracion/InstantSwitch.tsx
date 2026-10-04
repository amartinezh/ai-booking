'use client';

import { useState, useTransition, type ReactNode } from 'react';

/**
 * Interruptor de configuración que guarda al instante (no espera al botón
 * «Guardar» del formulario). Si el guardado falla, el interruptor sigue
 * mostrando lo que de verdad quedó guardado y avisa.
 */
export default function InstantSwitch({
    initialEnabled,
    save,
    title,
    description,
    iconOn,
    iconOff,
    iconOnClassName,
    labelOn,
    labelOff,
    detailOn,
    detailOff,
    footnote,
    confirmMessage,
}: {
    initialEnabled: boolean;
    save: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    title: string;
    description: string;
    iconOn: ReactNode;
    iconOff: ReactNode;
    /** Color de fondo/texto del icono cuando está encendido. */
    iconOnClassName: string;
    labelOn: string;
    labelOff: string;
    detailOn: string;
    detailOff: string;
    footnote?: string;
    /**
     * Texto a confirmar antes de guardar el cambio hacia `next`; null = sin
     * confirmación. Para interruptores cuyo efecto no se deshace solo.
     */
    confirmMessage?: (next: boolean) => string | null;
}) {
    const [enabled, setEnabled] = useState(initialEnabled);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const toggle = () => {
        const next = !enabled;
        const pregunta = confirmMessage?.(next);
        if (pregunta && !confirm(pregunta)) return;
        setError(null);
        startTransition(async () => {
            const res = await save(next);
            if (res.success) {
                setEnabled(next);
            } else {
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div
                    className={`rounded-xl p-2.5 ${
                        enabled ? iconOnClassName : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                >
                    {enabled ? iconOn : iconOff}
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{title}</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={title}
                    disabled={isPending}
                    onClick={toggle}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                        enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
                <div className="text-sm">
                    <p className="font-semibold text-zinc-900 dark:text-white">
                        {isPending ? 'Guardando…' : enabled ? labelOn : labelOff}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">{enabled ? detailOn : detailOff}</p>
                    {footnote && <p className="text-xs text-zinc-400 mt-1">{footnote}</p>}
                </div>
            </div>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
        </section>
    );
}
