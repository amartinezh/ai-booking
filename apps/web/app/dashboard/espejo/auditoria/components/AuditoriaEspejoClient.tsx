'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ChevronLeft, ChevronRight, Inbox, Info } from 'lucide-react';
import { formatAppointmentShort, formatDateOnly, formatTimeOnly } from '@/lib/date';
import type {
    ListResult,
    SyncAuditRow,
    SyncAuditFacets,
    SyncOutboxRow,
    SyncOutboxFacets,
    OutboxEstado,
} from '@/app/actions/sync-audit';

type Tab = 'auditoria' | 'outbox';

type Filtros = {
    direction: string;
    entityType: string;
    outcome: string;
    op: string;
    estado: string;
    q: string;
    desde: string;
    hasta: string;
    page: number;
};

type Props = {
    tab: Tab;
    audit: ListResult<SyncAuditRow> | null;
    outbox: ListResult<SyncOutboxRow> | null;
    auditFacets: SyncAuditFacets;
    outboxFacets: SyncOutboxFacets;
    filtros: Filtros;
};

// Etiquetas legibles con fallback al valor crudo — el vocabulario de
// `direction`/`outcome` ha crecido con cada servicio nuevo del motor
// (ver sync-audit.ts), así que una lista fija se quedaría corta.
const DIRECCION_LABEL: Record<string, string> = {
    INBOUND: 'Hospital → AgenIA',
    AGENIA_TO_HIS: 'AgenIA → Hospital',
    HIS_TO_AGENIA: 'Hospital → AgenIA (disponibilidad)',
    RECONCILE: 'Reconciliación',
    CONFIG: 'Configuración',
};

const OUTCOME_ESTILO: Record<string, string> = {
    OK: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/50',
    CONFLICT: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50',
    ERROR: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/50',
    SKIPPED: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
};
const ESTADO_OUTBOX_ESTILO: Record<OutboxEstado, string> = {
    PENDIENTE: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50',
    ENTREGADO: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/50',
    DEAD_LETTER: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/50',
};

function Badge({ texto, className }: { texto: string; className?: string }) {
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap ${
                className ?? 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
            }`}
        >
            {texto}
        </span>
    );
}

function Fecha({ iso }: { iso: string }) {
    return <span className="tabular-nums whitespace-nowrap">{formatAppointmentShort(iso)}</span>;
}

export default function AuditoriaEspejoClient({ tab, audit, outbox, auditFacets, outboxFacets, filtros }: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [q, setQ] = useState(filtros.q);
    const [detalleAudit, setDetalleAudit] = useState<SyncAuditRow | null>(null);
    const [detalleOutbox, setDetalleOutbox] = useState<SyncOutboxRow | null>(null);

    // Ajuste de estado derivado durante el render (no en un efecto): si el
    // prop `filtros.q` cambia porque el servidor mandó otra URL (ej. se
    // limpió el filtro desde otra pestaña), el input vuelve a reflejarlo.
    const [qSincronizado, setQSincronizado] = useState(filtros.q);
    if (filtros.q !== qSincronizado) {
        setQSincronizado(filtros.q);
        setQ(filtros.q);
    }

    const pushQuery = (patch: Record<string, string | number | null | undefined>) => {
        const params = new URLSearchParams(searchParams?.toString() || '');
        Object.entries(patch).forEach(([k, v]) => {
            if (v === null || v === undefined || v === '') {
                params.delete(k);
            } else {
                params.set(k, String(v));
            }
        });
        startTransition(() => {
            router.push(`/dashboard/espejo/auditoria?${params.toString()}`);
        });
    };

    const cambiarTab = (t: Tab) => pushQuery({ tab: t, page: 1 });
    const filtrar = (patch: Record<string, string | number | null>) => pushQuery({ ...patch, page: 1 });
    const buscar = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        filtrar({ q: q.trim() || null });
    };
    const irAPagina = (p: number) => pushQuery({ page: p });

    const lista = tab === 'auditoria' ? audit : outbox;
    const total = lista?.total ?? 0;
    const pageSize = lista?.pageSize ?? 25;
    const totalPages = lista?.totalPages ?? 1;
    const page = lista?.page ?? 1;
    const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const rangeEnd = Math.min(total, page * pageSize);

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    Auditoría detallada del espejo
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Historial completo de lo que pasó entre AgenIA y el sistema del hospital.
                </p>
            </header>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 w-fit">
                {(
                    [
                        ['auditoria', 'Auditoría'],
                        ['outbox', 'Cola de salida'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => cambiarTab(key)}
                        disabled={isPending}
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            tab === key
                                ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                {/* Filtros */}
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <form onSubmit={buscar} className="relative w-full lg:w-96">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="search"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Buscar por ID de entidad o evento..."
                                className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:text-white"
                            />
                            {q && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setQ('');
                                        filtrar({ q: null });
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </form>

                        <div className="flex flex-wrap gap-2">
                            <input
                                type="date"
                                value={filtros.desde}
                                onChange={(e) => filtrar({ desde: e.target.value || null })}
                                className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                            />
                            <input
                                type="date"
                                value={filtros.hasta}
                                onChange={(e) => filtrar({ hasta: e.target.value || null })}
                                className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Select
                            value={filtros.entityType}
                            onChange={(v) => filtrar({ entityType: v || null })}
                            options={tab === 'auditoria' ? auditFacets.entityTypes : outboxFacets.entityTypes}
                            placeholder="Entidad (todas)"
                        />
                        <Select
                            value={filtros.op}
                            onChange={(v) => filtrar({ op: v || null })}
                            options={tab === 'auditoria' ? auditFacets.ops : outboxFacets.ops}
                            placeholder="Operación (todas)"
                        />
                        {tab === 'auditoria' ? (
                            <>
                                <Select
                                    value={filtros.direction}
                                    onChange={(v) => filtrar({ direction: v || null })}
                                    options={auditFacets.directions}
                                    labels={DIRECCION_LABEL}
                                    placeholder="Dirección (todas)"
                                />
                                <Select
                                    value={filtros.outcome}
                                    onChange={(v) => filtrar({ outcome: v || null })}
                                    options={auditFacets.outcomes}
                                    placeholder="Resultado (todos)"
                                />
                            </>
                        ) : (
                            <Select
                                value={filtros.estado}
                                onChange={(v) => filtrar({ estado: v || null })}
                                options={['PENDIENTE', 'ENTREGADO', 'DEAD_LETTER']}
                                placeholder="Estado (todos)"
                            />
                        )}
                    </div>
                </div>

                {/* Tabla */}
                {tab === 'auditoria' ? (
                    <TablaAuditoria rows={audit?.rows ?? []} onOpen={setDetalleAudit} />
                ) : (
                    <TablaOutbox rows={outbox?.rows ?? []} onOpen={setDetalleOutbox} />
                )}

                {/* Paginación */}
                <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row gap-3 items-center justify-between text-sm">
                    <div className="text-zinc-500 dark:text-zinc-400">
                        {total === 0 ? (
                            'Sin resultados'
                        ) : (
                            <>
                                Mostrando <span className="font-semibold text-zinc-700 dark:text-zinc-200">{rangeStart}–{rangeEnd}</span> de{' '}
                                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{total}</span> registros
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => irAPagina(page - 1)}
                            disabled={page <= 1 || isPending}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-colors"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                        </button>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono px-2">
                            Pág. {page} / {totalPages}
                        </span>
                        <button
                            onClick={() => irAPagina(page + 1)}
                            disabled={page >= totalPages || isPending}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-colors"
                        >
                            Siguiente <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {detalleAudit && <DetalleAuditModal row={detalleAudit} onClose={() => setDetalleAudit(null)} />}
            {detalleOutbox && <DetalleOutboxModal row={detalleOutbox} onClose={() => setDetalleOutbox(null)} />}
        </div>
    );
}

function Select({
    value,
    onChange,
    options,
    labels,
    placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    options: string[];
    labels?: Record<string, string>;
    placeholder: string;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
        >
            <option value="">{placeholder}</option>
            {options.map((o) => (
                <option key={o} value={o}>
                    {labels?.[o] ?? o}
                </option>
            ))}
        </select>
    );
}

function VaciaFila({ colSpan, texto }: { colSpan: number; texto: string }) {
    return (
        <tr>
            <td colSpan={colSpan} className="px-5 py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-zinc-400">
                    <Inbox className="w-8 h-8" />
                    <p className="font-medium">{texto}</p>
                </div>
            </td>
        </tr>
    );
}

function TablaAuditoria({ rows, onOpen }: { rows: SyncAuditRow[]; onOpen: (r: SyncAuditRow) => void }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-left">
                    <tr className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        <th className="px-5 py-3 font-semibold">Cuándo</th>
                        <th className="px-5 py-3 font-semibold">Dirección</th>
                        <th className="px-5 py-3 font-semibold">Entidad</th>
                        <th className="px-5 py-3 font-semibold">Operación</th>
                        <th className="px-5 py-3 font-semibold">Resultado</th>
                        <th className="px-5 py-3 font-semibold">Detalle</th>
                        <th className="px-5 py-3 font-semibold w-16"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {rows.length === 0 && <VaciaFila colSpan={7} texto="No hay eventos que coincidan con los filtros." />}
                    {rows.map((r) => (
                        <tr
                            key={r.id}
                            onClick={() => onOpen(r)}
                            className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
                        >
                            <td className="px-5 py-3.5 text-xs text-zinc-500 dark:text-zinc-400">
                                <Fecha iso={r.createdAt} />
                            </td>
                            <td className="px-5 py-3.5 text-xs text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                                {DIRECCION_LABEL[r.direction] ?? r.direction}
                            </td>
                            <td className="px-5 py-3.5">
                                <span className="font-medium text-zinc-900 dark:text-white">{r.entityType}</span>
                                {r.entityId && (
                                    <span className="block font-mono text-[10px] text-zinc-500 max-w-[16ch] truncate" title={r.entityId}>
                                        {r.entityId}
                                    </span>
                                )}
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">{r.op}</td>
                            <td className="px-5 py-3.5">
                                <Badge texto={r.outcome} className={OUTCOME_ESTILO[r.outcome]} />
                            </td>
                            <td className="px-5 py-3.5 text-zinc-600 dark:text-zinc-400 max-w-[36ch] truncate" title={r.detail ?? ''}>
                                {r.detail ?? '—'}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onOpen(r);
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
    );
}

function TablaOutbox({ rows, onOpen }: { rows: SyncOutboxRow[]; onOpen: (r: SyncOutboxRow) => void }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-left">
                    <tr className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        <th className="px-5 py-3 font-semibold">Cuándo</th>
                        <th className="px-5 py-3 font-semibold">Entidad</th>
                        <th className="px-5 py-3 font-semibold">Operación</th>
                        <th className="px-5 py-3 font-semibold">Estado</th>
                        <th className="px-5 py-3 font-semibold">Intentos</th>
                        <th className="px-5 py-3 font-semibold">Entregado</th>
                        <th className="px-5 py-3 font-semibold w-16"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {rows.length === 0 && <VaciaFila colSpan={7} texto="No hay eventos que coincidan con los filtros." />}
                    {rows.map((r) => (
                        <tr
                            key={r.seq}
                            onClick={() => onOpen(r)}
                            className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
                        >
                            <td className="px-5 py-3.5 text-xs text-zinc-500 dark:text-zinc-400">
                                <Fecha iso={r.createdAt} />
                            </td>
                            <td className="px-5 py-3.5">
                                <span className="font-medium text-zinc-900 dark:text-white">{r.entityType}</span>
                                <span className="block font-mono text-[10px] text-zinc-500 max-w-[16ch] truncate" title={r.entityId}>
                                    {r.entityId}
                                </span>
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">{r.op}</td>
                            <td className="px-5 py-3.5">
                                <Badge texto={r.estado} className={ESTADO_OUTBOX_ESTILO[r.estado]} />
                            </td>
                            <td className="px-5 py-3.5 tabular-nums text-zinc-600 dark:text-zinc-400">{r.attempts}</td>
                            <td className="px-5 py-3.5 text-xs text-zinc-500 dark:text-zinc-400">
                                {r.deliveredAt ? <Fecha iso={r.deliveredAt} /> : '—'}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onOpen(r);
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
    );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4"
            onClick={onClose}
        >
            <div
                className="relative w-full md:max-w-2xl bg-white dark:bg-zinc-900 rounded-t-2xl md:rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

function KV({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
            <div className="text-zinc-700 dark:text-zinc-300 font-mono truncate" title={value}>
                {value}
            </div>
        </div>
    );
}

function DetalleAuditModal({ row, onClose }: { row: SyncAuditRow; onClose: () => void }) {
    return (
        <ModalShell onClose={onClose}>
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge texto={row.outcome} className={OUTCOME_ESTILO[row.outcome]} />
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                            {formatDateOnly(row.createdAt)} · {formatTimeOnly(row.createdAt, { withSeconds: true })}
                        </span>
                    </div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                        {row.entityType} · {row.op}
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
                        {DIRECCION_LABEL[row.direction] ?? row.direction}
                    </p>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Cerrar">
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 grid grid-cols-2 gap-3 text-xs">
                <KV label="ID de entidad" value={row.entityId ?? '—'} />
                <KV label="ID de evento" value={row.eventId ?? '—'} />
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">Detalle</h4>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                    {row.detail ?? 'Sin detalle adicional.'}
                </p>
            </div>
        </ModalShell>
    );
}

function DetalleOutboxModal({ row, onClose }: { row: SyncOutboxRow; onClose: () => void }) {
    const prettyPayload = useMemo(() => {
        try {
            return JSON.stringify(row.payload, null, 2);
        } catch {
            return String(row.payload);
        }
    }, [row.payload]);

    return (
        <ModalShell onClose={onClose}>
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge texto={row.estado} className={ESTADO_OUTBOX_ESTILO[row.estado]} />
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                            {formatDateOnly(row.createdAt)} · {formatTimeOnly(row.createdAt, { withSeconds: true })}
                        </span>
                    </div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                        {row.entityType} · {row.op}
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
                        {row.attempts} intento(s) · origen {row.origin}
                    </p>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Cerrar">
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 grid grid-cols-2 gap-3 text-xs">
                <KV label="Seq" value={row.seq} />
                <KV label="ID de evento" value={row.eventId} />
                <KV label="ID de entidad" value={row.entityId} />
                <KV label="Entregado" value={row.deliveredAt ? `${formatDateOnly(row.deliveredAt)} · ${formatTimeOnly(row.deliveredAt)}` : '—'} />
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
                <div className="flex items-center gap-2 mb-2">
                    <Info className="w-3.5 h-3.5 text-zinc-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Payload enviado al agente
                    </h4>
                </div>
                <pre className="text-xs font-mono leading-relaxed bg-zinc-950 text-zinc-100 dark:bg-black/70 rounded-xl p-4 overflow-auto whitespace-pre-wrap break-words max-h-[50vh]">
                    {prettyPayload}
                </pre>
            </div>
        </ModalShell>
    );
}
