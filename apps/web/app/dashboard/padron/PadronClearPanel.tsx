'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Trash2, XCircle } from 'lucide-react';
import {
    clearPadronEpsAction,
    getActiveEpsOptionsAction,
    previewClearPadronEpsAction,
    type EpsOption,
    type PadronClearPreview,
    type PadronClearResult,
    type PadronEstadoFiltro,
} from './actions';

const ESTADO_LABELS: Record<PadronEstadoFiltro, string> = {
    ALL: 'Todo el padrón de esa EPS (activos e inactivos)',
    ACTIVE: 'Solo los que hoy están de alta (activos)',
    INACTIVE: 'Solo los inactivos (bajas ya aplicadas)',
};

// ─────────────────────────────────────────────────────────────
// ZONA DE PELIGRO — lo contrario de importar: BORRA (DELETE, no baja lógica)
// filas de EpsEnrolledPatient para la EPS y el filtro de estado elegidos. El
// reemplazo automático de un corte se puede deshacer recargando el CSV
// correcto; esto no. Por eso el flujo siempre pasa por una vista previa con
// el conteo exacto antes de exigir escribir el nombre de la EPS como
// confirmación — igual de estricto que la guarda del 10% al importar, pero
// sin la salida de emergencia de "vuelva a cargar el archivo bueno".
// ─────────────────────────────────────────────────────────────
export default function PadronClearPanel() {
    const router = useRouter();
    const [expanded, setExpanded] = useState(false);

    const [epsOptions, setEpsOptions] = useState<EpsOption[] | null>(null);
    const [epsLoadError, setEpsLoadError] = useState<string | null>(null);
    const [selectedEpsId, setSelectedEpsId] = useState('');
    const [estado, setEstado] = useState<PadronEstadoFiltro | ''>('');

    const [preview, setPreview] = useState<PadronClearPreview | null>(null);
    const [confirmText, setConfirmText] = useState('');
    const [result, setResult] = useState<PadronClearResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPreviewing, startPreviewing] = useTransition();
    const [isClearing, startClearing] = useTransition();

    useEffect(() => {
        if (!expanded || epsOptions !== null) return;
        getActiveEpsOptionsAction().then((res) => {
            if (res.success) setEpsOptions(res.eps);
            else setEpsLoadError(res.error);
        });
    }, [expanded, epsOptions]);

    function resetOutcome() {
        setPreview(null);
        setConfirmText('');
        setResult(null);
        setError(null);
    }

    const busy = isPreviewing || isClearing;
    const canPreview = !!selectedEpsId && !!estado && !busy;
    const canClear = !!preview && preview.count > 0 && confirmText.trim() === preview.epsName && !busy;

    function handlePreview() {
        if (!selectedEpsId || !estado) return;
        resetOutcome();
        startPreviewing(async () => {
            const res = await previewClearPadronEpsAction(selectedEpsId, estado);
            if (res.success) setPreview(res.preview);
            else setError(res.error);
        });
    }

    function handleClear() {
        if (!preview) return;
        setError(null);
        startClearing(async () => {
            const res = await clearPadronEpsAction(preview.epsId, preview.estado, confirmText);
            if (res.success) {
                setResult(res);
                setPreview(null);
                setConfirmText('');
                router.refresh(); // refresca la tabla server-side del padrón
            } else {
                setError(res.error ?? 'Error al limpiar el padrón.');
            }
        });
    }

    return (
        <section className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            >
                <span className="flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-400">
                    <Trash2 className="h-4 w-4" /> Vaciar padrón de una EPS
                </span>
                {expanded ? (
                    <ChevronDown className="h-4 w-4 text-red-500" />
                ) : (
                    <ChevronRight className="h-4 w-4 text-red-500" />
                )}
            </button>

            {expanded && (
                <div className="space-y-4 border-t border-red-200 dark:border-red-900/50 px-6 py-5">
                    <p className="text-sm text-red-800/80 dark:text-red-300/80">
                        Elimina permanentemente (no es una baja lógica, como sí lo es un corte normal) los
                        registros del padrón que coincidan con la EPS y el filtro elegidos.{' '}
                        <strong>No se puede deshacer</strong> ni se recupera recargando un CSV.
                    </p>

                    <div className="flex flex-wrap gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="clear-eps"
                                className="text-sm font-medium text-zinc-700 dark:text-zinc-200"
                            >
                                EPS a vaciar
                            </label>
                            {epsLoadError ? (
                                <p className="text-sm text-red-600 dark:text-red-400">{epsLoadError}</p>
                            ) : epsOptions === null ? (
                                <p className="text-sm text-zinc-400">Cargando EPS activas…</p>
                            ) : epsOptions.length === 0 ? (
                                <p className="text-sm text-amber-600 dark:text-amber-400">
                                    La clínica no tiene EPS activas.
                                </p>
                            ) : (
                                <select
                                    id="clear-eps"
                                    value={selectedEpsId}
                                    onChange={(e) => {
                                        setSelectedEpsId(e.target.value);
                                        resetOutcome();
                                    }}
                                    disabled={busy}
                                    className="min-w-[16rem] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-red-400 focus:outline-none disabled:opacity-50"
                                >
                                    <option value="" disabled>
                                        Seleccione una EPS…
                                    </option>
                                    {epsOptions.map((eps) => (
                                        <option key={eps.id} value={eps.id}>
                                            {eps.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="clear-estado"
                                className="text-sm font-medium text-zinc-700 dark:text-zinc-200"
                            >
                                Qué borrar
                            </label>
                            <select
                                id="clear-estado"
                                value={estado}
                                onChange={(e) => {
                                    setEstado(e.target.value as PadronEstadoFiltro | '');
                                    resetOutcome();
                                }}
                                disabled={busy}
                                className="min-w-[18rem] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-red-400 focus:outline-none disabled:opacity-50"
                            >
                                <option value="" disabled>
                                    Seleccione qué borrar…
                                </option>
                                {(Object.keys(ESTADO_LABELS) as PadronEstadoFiltro[]).map((key) => (
                                    <option key={key} value={key}>
                                        {ESTADO_LABELS[key]}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handlePreview}
                        disabled={!canPreview}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isPreviewing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <AlertTriangle className="h-4 w-4" />
                        )}
                        Ver cuántos se eliminarían
                    </button>

                    {error && (
                        <div className="flex items-start gap-2 rounded-xl bg-red-100 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                            <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
                        </div>
                    )}

                    {preview && (
                        <div className="space-y-3 rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-red-200 dark:ring-red-900/50 p-4">
                            {preview.count === 0 ? (
                                <p className="text-sm text-zinc-500">
                                    No hay registros de <strong>{preview.epsName}</strong> que coincidan con
                                    ese filtro. Nada que borrar.
                                </p>
                            ) : (
                                <>
                                    <p className="flex items-start gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                        Esto eliminará permanentemente <strong>{preview.count}</strong>{' '}
                                        registro(s) del padrón de <strong>{preview.epsName}</strong> (
                                        {ESTADO_LABELS[preview.estado]}).
                                    </p>
                                    <div className="flex flex-col gap-1.5">
                                        <label
                                            htmlFor="clear-confirm"
                                            className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
                                        >
                                            Escriba <strong>{preview.epsName}</strong> para confirmar
                                        </label>
                                        <input
                                            id="clear-confirm"
                                            type="text"
                                            value={confirmText}
                                            onChange={(e) => setConfirmText(e.target.value)}
                                            disabled={isClearing}
                                            placeholder={preview.epsName}
                                            autoComplete="off"
                                            className="max-w-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-red-400 focus:outline-none disabled:opacity-50"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleClear}
                                        disabled={!canClear}
                                        className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isClearing ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                        Eliminar definitivamente {preview.count} registro(s)
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {result?.success && (
                        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                            Se eliminaron <strong>{result.deletedCount}</strong> registro(s) del padrón.
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
