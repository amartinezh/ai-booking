'use client';

import type { PasoLinea, Severidad, Veredicto } from '@agenia/shared';
import { formatAppointmentShort } from '@/lib/date';

/**
 * Presentación de un veredicto del rastreo (docs/PLAN_RASTREO_PACIENTE.md §3.3)
 * y de la línea de vida de una cita (§4.3).
 *
 * El color dice qué hacer y el texto dice por qué, como en el panel del espejo.
 * Nunca se muestra un veredicto sin lo que NO se sabe: es la regla que evita que
 * "AgenIA no tiene registro" se lea como "el paciente no agendó".
 */

const ESTILOS: Record<Severidad, { caja: string; icono: string; nombre: string }> = {
    ok: {
        caja: 'bg-emerald-50 border-emerald-200 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-100',
        icono: '✓',
        nombre: 'Todo en orden',
    },
    info: {
        caja: 'bg-sky-50 border-sky-200 text-sky-950 dark:bg-sky-950/40 dark:border-sky-900 dark:text-sky-100',
        icono: 'i',
        nombre: 'Información',
    },
    warn: {
        caja: 'bg-amber-50 border-amber-200 text-amber-950 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-100',
        icono: '!',
        nombre: 'Requiere atención',
    },
    bad: {
        caja: 'bg-rose-50 border-rose-200 text-rose-950 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-100',
        icono: '✕',
        nombre: 'Problema',
    },
};

const FUENTE: Record<Veredicto['fuente'], string> = {
    AGENIA: 'Fuente: datos de AgenIA',
    HIS_EN_VIVO: 'Fuente: consulta en vivo al HIS',
    AGENIA_Y_HIS: 'Fuente: AgenIA y consulta al HIS',
};

export function VeredictoCard({
    veredicto: v,
    principal = false,
}: {
    veredicto: Veredicto;
    principal?: boolean;
}) {
    const estilo = ESTILOS[v.severidad];
    return (
        <section
            aria-label={`Veredicto: ${v.titulo}`}
            className={`rounded-xl border p-4 md:p-5 ${estilo.caja}`}
            data-codigo={v.codigo}
            data-severidad={v.severidad}
        >
            <div className="flex items-start gap-3">
                <span
                    aria-hidden
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-sm font-bold"
                >
                    {estilo.icono}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide opacity-70">
                        <span className="sr-only">{estilo.nombre}. </span>
                        {principal ? 'Veredicto' : 'Otra lectura'} · {FUENTE[v.fuente]}
                    </p>
                    <h3 className={`${principal ? 'text-lg' : 'text-base'} mt-1 font-semibold leading-snug`}>
                        {v.titulo}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed">{v.resumen}</p>
                </div>
            </div>

            {v.evidencia.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide opacity-70">Lo que consta</h4>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                        {v.evidencia.map((linea, i) => (
                            <li key={i}>{linea}</li>
                        ))}
                    </ul>
                </div>
            )}

            {v.noSabemos.length > 0 && (
                <div className="mt-4 rounded-lg border border-current/20 bg-white/50 p-3 dark:bg-black/20">
                    <h4 className="text-xs font-semibold uppercase tracking-wide opacity-70">
                        Lo que este resultado no puede afirmar
                    </h4>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                        {v.noSabemos.map((linea, i) => (
                            <li key={i}>{linea}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mt-4 rounded-lg bg-white/70 p-3 text-sm dark:bg-black/25">
                <span className="font-semibold">Qué hacer: </span>
                {v.accion}
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────
// Línea de vida
// ─────────────────────────────────────────────────────────────

const PASO: Record<PasoLinea['estado'], { simbolo: string; texto: string; clase: string }> = {
    ok: { simbolo: '✓', texto: 'Hecho', clase: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    fail: { simbolo: '✕', texto: 'Falló', clase: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
    pending: { simbolo: '⏳', texto: 'Pendiente', clase: 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
    unknown: { simbolo: '?', texto: 'Sin registro', clase: 'border-zinc-400 bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400' },
    na: { simbolo: '–', texto: 'No aplica', clase: 'border-zinc-300 bg-white text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-500' },
};

export function LineaDeVida({
    pasos,
    zonaHoraria,
}: {
    pasos: PasoLinea[];
    zonaHoraria: string;
}) {
    return (
        <ol aria-label="Línea de vida de la cita" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {pasos.map((p) => {
                const estilo = PASO[p.estado];
                return (
                    <li
                        key={p.clave}
                        data-paso={p.clave}
                        data-estado={p.estado}
                        className="flex gap-2 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                    >
                        <span
                            aria-hidden
                            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${estilo.clase}`}
                        >
                            {estilo.simbolo}
                        </span>
                        <div className="min-w-0">
                            <p className="font-medium text-zinc-800 dark:text-zinc-100">
                                {p.etiqueta} <span className="sr-only">— {estilo.texto}</span>
                            </p>
                            {p.atIso && (
                                <p className="tabular-nums text-zinc-500 dark:text-zinc-400">
                                    {formatAppointmentShort(p.atIso, { timeZone: zonaHoraria })}
                                </p>
                            )}
                            {p.detalle && (
                                <p className="mt-0.5 break-words text-zinc-500 dark:text-zinc-400">{p.detalle}</p>
                            )}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
