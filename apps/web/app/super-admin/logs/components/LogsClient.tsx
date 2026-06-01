'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Search, X, ChevronLeft, ChevronRight, Info, AlertCircle, Bug } from 'lucide-react';
import type { ListLogsResult, SystemLogLevel, SystemLogRow } from '@/app/actions/system-logs';
import { getSystemLogById } from '@/app/actions/system-logs';

type Props = {
    initialLogs: ListLogsResult;
    recentErrors: SystemLogRow[];
    initialFilters: {
        level: SystemLogLevel | 'ALL';
        search: string;
        page: number;
        pageSize: number;
    };
};

const LEVEL_TABS: { key: SystemLogLevel | 'ALL'; label: string }[] = [
    { key: 'ALL', label: 'Todos' },
    { key: 'EVENT', label: 'Eventos' },
    { key: 'WARNING', label: 'Warnings' },
    { key: 'ERROR', label: 'Errores' },
];

export default function LogsClient({ initialLogs, recentErrors, initialFilters }: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const [searchInput, setSearchInput] = useState(initialFilters.search);
    const [selectedLog, setSelectedLog] = useState<SystemLogRow | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    const level = initialFilters.level;
    const page = initialFilters.page;

    // Mantener input controlado si el server prop cambia (ej. paginación)
    useEffect(() => {
        setSearchInput(initialFilters.search);
    }, [initialFilters.search]);

    // ── Navegación con server-side rendering ───────────────────
    const pushQuery = (patch: Record<string, string | number | null | undefined>) => {
        const params = new URLSearchParams(searchParams?.toString() || '');
        Object.entries(patch).forEach(([k, v]) => {
            if (v === null || v === undefined || v === '' || v === 'ALL') {
                params.delete(k);
            } else {
                params.set(k, String(v));
            }
        });
        startTransition(() => {
            router.push(`/super-admin/logs?${params.toString()}`);
        });
    };

    const handleLevel = (lvl: SystemLogLevel | 'ALL') => pushQuery({ level: lvl, page: 1 });
    const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        pushQuery({ search: searchInput.trim(), page: 1 });
    };
    const clearSearch = () => {
        setSearchInput('');
        pushQuery({ search: null, page: 1 });
    };
    const goToPage = (p: number) => pushQuery({ page: p });

    // ── Detalle del log ────────────────────────────────────────
    const openDetail = async (log: SystemLogRow) => {
        setLoadingDetail(true);
        // Optimistic: mostrar lo que ya tenemos; refrescar metadata desde server.
        setSelectedLog(log);
        try {
            const fresh = await getSystemLogById(log.id);
            if (fresh) setSelectedLog(fresh);
        } catch (_) {
            // si falla, dejamos el optimistic
        } finally {
            setLoadingDetail(false);
        }
    };
    const closeDetail = () => setSelectedLog(null);

    // Cerrar modal con ESC
    useEffect(() => {
        if (!selectedLog) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeDetail();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedLog]);

    const { rows, total, totalPages, pageSize } = initialLogs;
    const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const rangeEnd = Math.min(total, page * pageSize);

    const hasRecentErrors = recentErrors.length > 0;

    return (
        <div className="space-y-6">

            {/* 🚨 ALERTA ROJA — Errores en las últimas 24h ──────── */}
            {hasRecentErrors && (
                <RedErrorAlert errors={recentErrors} onOpen={openDetail} />
            )}

            {/* ── Tarjeta principal: filtros + tabla ──────────── */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">

                {/* Filtros */}
                <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

                    {/* Tabs de level */}
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 w-fit">
                        {LEVEL_TABS.map(tab => {
                            const active = level === tab.key;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => handleLevel(tab.key)}
                                    disabled={isPending}
                                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                        active
                                            ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Búsqueda */}
                    <form onSubmit={handleSearch} className="relative w-full lg:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                            type="search"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Buscar por mensaje o acción..."
                            className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:text-white"
                        />
                        {searchInput && (
                            <button
                                type="button"
                                onClick={clearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </form>
                </div>

                {/* Tabla */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-left">
                            <tr className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                <th className="px-5 py-3 font-semibold">Nivel</th>
                                <th className="px-5 py-3 font-semibold">Acción</th>
                                <th className="px-5 py-3 font-semibold">Mensaje</th>
                                <th className="px-5 py-3 font-semibold">Fecha</th>
                                <th className="px-5 py-3 font-semibold w-20"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-5 py-16 text-center">
                                        <div className="flex flex-col items-center gap-2 text-zinc-400">
                                            <Info className="w-8 h-8" />
                                            <p className="font-medium">No hay logs que coincidan con los filtros.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            {rows.map(log => (
                                <tr
                                    key={log.id}
                                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
                                    onClick={() => openDetail(log)}
                                >
                                    <td className="px-5 py-3.5"><LevelBadge level={log.level} /></td>
                                    <td className="px-5 py-3.5 font-mono text-xs text-zinc-700 dark:text-zinc-300 max-w-[20ch] truncate" title={log.action}>
                                        {log.action}
                                    </td>
                                    <td className="px-5 py-3.5 text-zinc-700 dark:text-zinc-300 max-w-[40ch] truncate" title={log.message}>
                                        {log.message}
                                    </td>
                                    <td className="px-5 py-3.5 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                        {formatDate(log.createdAt)}
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.stopPropagation();
                                                openDetail(log);
                                            }}
                                            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                        >
                                            Ver →
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Paginación */}
                <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row gap-3 items-center justify-between text-sm">
                    <div className="text-zinc-500 dark:text-zinc-400">
                        {total === 0
                            ? 'Sin resultados'
                            : <>Mostrando <span className="font-semibold text-zinc-700 dark:text-zinc-200">{rangeStart}–{rangeEnd}</span> de <span className="font-semibold text-zinc-700 dark:text-zinc-200">{total}</span> registros</>
                        }
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => goToPage(page - 1)}
                            disabled={page <= 1 || isPending}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-colors"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                        </button>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono px-2">
                            Pág. {page} / {totalPages}
                        </span>
                        <button
                            onClick={() => goToPage(page + 1)}
                            disabled={page >= totalPages || isPending}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-colors"
                        >
                            Siguiente <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Modal de detalle */}
            {selectedLog && (
                <LogDetailModal log={selectedLog} loading={loadingDetail} onClose={closeDetail} />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────

function RedErrorAlert({ errors, onOpen }: { errors: SystemLogRow[]; onOpen: (l: SystemLogRow) => void }) {
    return (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-red-100 dark:bg-red-900/40 p-2.5 text-red-600 dark:text-red-400 flex-shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-red-900 dark:text-red-200 flex items-center gap-2">
                        🚨 Errores recientes en las últimas 24 horas
                        <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                            {errors.length}
                        </span>
                    </h3>
                    <p className="text-sm text-red-700 dark:text-red-300/80 mt-0.5">
                        El sistema registró estos errores recientemente. Haz clic en uno para ver el stack trace y el contexto.
                    </p>

                    <ul className="mt-4 space-y-1.5">
                        {errors.map(e => (
                            <li key={e.id}>
                                <button
                                    onClick={() => onOpen(e)}
                                    className="w-full text-left flex items-start gap-3 px-3 py-2 rounded-lg bg-white/70 dark:bg-zinc-900/40 border border-red-100 dark:border-red-900/40 hover:bg-white dark:hover:bg-zinc-900/70 transition-colors"
                                >
                                    <span className="text-[10px] font-mono mt-0.5 text-red-600 dark:text-red-400 whitespace-nowrap">
                                        {formatDate(e.createdAt)}
                                    </span>
                                    <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-nowrap max-w-[20ch] truncate" title={e.action}>
                                        {e.action}
                                    </span>
                                    <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200 truncate" title={e.message}>
                                        {e.message}
                                    </span>
                                    <span className="text-xs font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">Ver →</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}

function LevelBadge({ level }: { level: SystemLogLevel }) {
    if (level === 'ERROR') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/50">
                <Bug className="w-3 h-3" /> Error
            </span>
        );
    }
    if (level === 'WARNING') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50">
                <AlertCircle className="w-3 h-3" /> Warning
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/50">
            <Info className="w-3 h-3" /> Evento
        </span>
    );
}

function LogDetailModal({ log, loading, onClose }: { log: SystemLogRow; loading: boolean; onClose: () => void }) {
    // metadata pretty-printed con manejo seguro de circular references / non-JSON
    const prettyMetadata = useMemo(() => {
        if (log.metadata === null || log.metadata === undefined) return '(sin metadata)';
        try {
            return JSON.stringify(log.metadata, null, 2);
        } catch {
            return String(log.metadata);
        }
    }, [log.metadata]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="relative w-full md:max-w-3xl bg-white dark:bg-zinc-900 rounded-t-2xl md:rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <LevelBadge level={log.level} />
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                                {formatDate(log.createdAt, true)}
                            </span>
                        </div>
                        <h3 className="text-base font-bold text-zinc-900 dark:text-white font-mono break-all">
                            {log.action}
                        </h3>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1 break-words">
                            {log.message}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0"
                        aria-label="Cerrar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Contexto extra */}
                <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <KV label="ID" value={log.id} mono />
                    <KV label="Usuario" value={log.userId || '—'} mono />
                    <KV label="Organización" value={log.organizationId || '—'} mono />
                </div>

                {/* Metadata pretty-printed */}
                <div className="flex-1 overflow-auto px-6 py-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Metadata · Contexto técnico
                        </h4>
                        {loading && (
                            <span className="text-xs text-zinc-400 italic">cargando detalle…</span>
                        )}
                    </div>
                    <pre className="text-xs font-mono leading-relaxed bg-zinc-950 text-zinc-100 dark:bg-black/70 rounded-xl p-4 overflow-auto whitespace-pre-wrap break-words max-h-[55vh]">
                        {prettyMetadata}
                    </pre>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
                    <button
                        onClick={() => copyToClipboard(prettyMetadata)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                        Copiar metadata
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
            <div className={`text-zinc-700 dark:text-zinc-300 truncate ${mono ? 'font-mono' : ''}`} title={value}>
                {value}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// utils
// ─────────────────────────────────────────────────────────────

function formatDate(iso: string, withSeconds = false): string {
    try {
        const d = new Date(iso);
        // Logs técnicos: 24h en hora Colombia (no usa el helper compartido por
        // ser formato técnico, pero pasa timeZone explícito).
        return d.toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: withSeconds ? '2-digit' : undefined,
            hour12: false,
        });
    } catch {
        return iso;
    }
}

function copyToClipboard(text: string) {
    try {
        navigator.clipboard.writeText(text);
    } catch {
        /* noop */
    }
}
