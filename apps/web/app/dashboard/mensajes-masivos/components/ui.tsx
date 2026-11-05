'use client';

import type { ReactNode } from 'react';

/** Piezas comunes de /dashboard/mensajes-masivos (docs/PLAN_MENSAJES_MASIVOS.md). */

export const numero = (n: number) => new Intl.NumberFormat('es-CO').format(n);

export type Nivel = 'ERROR' | 'AVISO' | 'SUGERENCIA' | 'BIEN' | 'INFO';

const NIVEL: Record<Nivel, { caja: string; punto: string; etiqueta: string }> = {
    ERROR: { caja: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200', punto: 'bg-rose-500', etiqueta: 'Impide enviar' },
    AVISO: { caja: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200', punto: 'bg-amber-500', etiqueta: 'Revise' },
    SUGERENCIA: { caja: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200', punto: 'bg-sky-500', etiqueta: 'Sugerencia' },
    BIEN: { caja: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200', punto: 'bg-emerald-500', etiqueta: 'Bien' },
    INFO: { caja: 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300', punto: 'bg-zinc-400', etiqueta: 'Nota' },
};

export function Aviso({ nivel, titulo, children }: { nivel: Nivel; titulo?: ReactNode; children?: ReactNode }) {
    return (
        <div className={`rounded-xl border px-3 py-2 text-sm ${NIVEL[nivel].caja}`}>
            {titulo && <p className="font-semibold">{titulo}</p>}
            {children}
        </div>
    );
}

export function Punto({ nivel }: { nivel: Nivel }) {
    return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${NIVEL[nivel].punto}`} />;
}

export function EtiquetaNivel({ nivel }: { nivel: Nivel }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${NIVEL[nivel].caja}`}>
            <Punto nivel={nivel} />
            {NIVEL[nivel].etiqueta}
        </span>
    );
}

export function Tarjeta({ titulo, subtitulo, acciones, children, className = '' }: { titulo?: ReactNode; subtitulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
            {(titulo || acciones) && (
                <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        {titulo && <h2 className="text-base font-bold text-zinc-900 dark:text-white">{titulo}</h2>}
                        {subtitulo && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitulo}</p>}
                    </div>
                    {acciones}
                </header>
            )}
            {children}
        </section>
    );
}

const BOTON = {
    primario: 'bg-teal-600 text-white hover:bg-teal-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700',
    secundario: 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
    peligro: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-zinc-300',
    suave: 'text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-900/30',
} as const;

export function Boton({
    variante = 'secundario',
    className = '',
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: keyof typeof BOTON }) {
    return (
        <button
            type="button"
            {...props}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${BOTON[variante]} ${className}`}
        />
    );
}

export const campo =
    'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

export function Puntaje({ valor }: { valor: number }) {
    const color = valor >= 85 ? 'text-emerald-600' : valor >= 60 ? 'text-amber-600' : 'text-rose-600';
    return (
        <span className={`text-2xl font-extrabold tabular-nums ${color}`}>
            {valor}
            <span className="text-sm font-semibold text-zinc-400">/100</span>
        </span>
    );
}
