'use client';

import { useState, useTransition } from 'react';
import { cambiarModoAgenda } from '@/app/actions/espejo';

const MODOS = ['OFF', 'SHADOW', 'ON'] as const;
type Modo = (typeof MODOS)[number];

const QUE_ES: Record<Modo, string> = {
    OFF: 'La agenda de AgenIA es la suya, no la del hospital: se puede vender una hora en la que el médico no atiende.',
    SHADOW: 'Modo sombra: se compara con la agenda del hospital y se reportan las diferencias, sin escribir nada todavía.',
    ON: 'La agenda de AgenIA es la del hospital: los pacientes ven la disponibilidad real del sistema del hospital.',
};

const CONFIRMACION: Record<Modo, string> = {
    OFF: '¿Apagar la agenda espejada? AgenIA volverá a mostrar sus propios cupos manuales, no los del hospital.',
    SHADOW: '¿Pasar a modo sombra? Se calculará la rejilla real del hospital y se reportarán las diferencias, pero AgenIA seguirá mostrando sus propios cupos hasta que pases a ON.',
    ON: '¿Activar la agenda real del hospital? Desde ahora los pacientes verán la disponibilidad real del HIS en vez de los cupos manuales de AgenIA. Se recomienda haber revisado al menos una semana en modo SHADOW antes de este paso.',
};

/**
 * 🗓️ Modo de agenda del espejo: OFF → SHADOW → ON. Vive en Configuración ›
 * Hospital (espejo) (docs/PLAN_NAVEGACION.md, Fase 3); antes eran tres botones en
 * el Espejo, que ahora solo muestra el modo. Cada cambio pide confirmación, queda
 * en la auditoría del espejo y el agente lo recoge en su siguiente vuelta.
 */
export default function ModoAgendaSetting({ inicial }: { inicial: string }) {
    const [modo, setModo] = useState(inicial);
    const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
    const [pendiente, startTransition] = useTransition();

    const cambiar = (nuevo: Modo) => {
        if (nuevo === modo) return;
        if (!confirm(CONFIRMACION[nuevo])) return;
        setAviso(null);
        startTransition(async () => {
            const r = await cambiarModoAgenda(nuevo);
            if (r.success) {
                setModo(nuevo);
                setAviso({ ok: true, texto: `Modo de agenda cambiado a ${nuevo}. El agente lo recoge en su próxima vuelta (hasta 15 min).` });
            } else {
                setAviso({ ok: false, texto: r.error ?? 'No se pudo cambiar el modo.' });
            }
        });
    };

    return (
        <section>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Modo de agenda</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                OFF → SHADOW → ON. El paso a ON es una decisión de negocio, no técnica: se toma después de comparar en
                SHADOW contra la realidad durante al menos una semana.
            </p>
            <div className="mt-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div role="group" aria-label="Modo de agenda" className="flex flex-wrap gap-2">
                    {MODOS.map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => cambiar(m)}
                            disabled={pendiente || m === modo}
                            aria-pressed={m === modo}
                            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-default ${
                                m === modo
                                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                                    : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
                            }`}
                        >
                            {m}
                        </button>
                    ))}
                </div>
                <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                    {pendiente ? 'Guardando…' : (QUE_ES[modo as Modo] ?? modo)}
                </p>
            </div>
            {aviso && (
                <p
                    role={aviso.ok ? 'status' : 'alert'}
                    className={`mt-2 text-sm ${aviso.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                    {aviso.texto}
                </p>
            )}
        </section>
    );
}
