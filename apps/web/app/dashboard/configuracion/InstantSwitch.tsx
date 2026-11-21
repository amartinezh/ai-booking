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
    noAplica,
    alCambiar,
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
    /** Depende de otro interruptor que está apagado: se atenúa y dice por qué (sigue editable). */
    noAplica?: string | null;
    /** Avisa el valor que quedó guardado (para el ajuste que depende de este). */
    alCambiar?: (enabled: boolean) => void;
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
                alCambiar?.(next);
            } else {
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section
            className={`rounded-2xl border border-zinc-200 p-4 transition-opacity dark:border-zinc-800 ${
                noAplica ? 'opacity-70' : ''
            }`}
        >
            <div className="flex items-start gap-3">
                <div
                    className={`shrink-0 rounded-xl p-2.5 ${
                        enabled && !noAplica ? iconOnClassName : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                >
                    {enabled ? iconOn : iconOff}
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h2>
                    <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">
                        {isPending ? 'Guardando…' : enabled ? labelOn : labelOff}
                    </p>
                    {noAplica && <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">{noAplica}</p>}
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={title}
                    disabled={isPending}
                    onClick={toggle}
                    className={`relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                        enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>

            {/* N12 (docs/PLAN_NAVEGACION.md): la explicación no se pierde, queda a un clic. */}
            <details className="group mt-2 sm:pl-[3.25rem]">
                <summary className="w-fit cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    {enabled ? '¿Qué pasa si lo apago?' : '¿Qué pasa si lo enciendo?'}
                </summary>
                <div className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
                    <p>
                        <span className="font-semibold">{enabled ? 'Si lo apaga: ' : 'Si lo enciende: '}</span>
                        {enabled ? detailOff : detailOn}
                    </p>
                    <p>
                        <span className="font-semibold">Ahora: </span>
                        {enabled ? detailOn : detailOff}
                    </p>
                    {footnote && <p className="text-xs text-zinc-500 dark:text-zinc-400">{footnote}</p>}
                </div>
            </details>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
        </section>
    );
}
