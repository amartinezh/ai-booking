/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ══════════════════════════════════════════════════════════════
// TIPOS (espejo del payload del route handler)
// ══════════════════════════════════════════════════════════════
type WaitlistItem = {
    id: string;
    patientName: string;
    cedula: string;
    phone: string;
    phoneDisplay: string;
    whatsappLink: string;
    specialty: string;
    eps: string | null;
    preferredDoctor: string | null;
    registeredAt: string;
    waitMs: number;
    waitLabel: string;
    isOverdue: boolean;
};

type ApiResponse = {
    items: WaitlistItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
};

const buildGreeting = (clinic: string) =>
    `Hola, le escribimos de ${clinic}. Vimos que quedó en nuestra lista de espera para una cita y queremos ayudarle a conseguir un cupo. ¿Le gustaría que le asistamos?`;

// ══════════════════════════════════════════════════════════════
// MODAL: DETALLE DE LA COLA DE ESPERA
// ══════════════════════════════════════════════════════════════
export default function WaitlistModal({
    organizationName = 'nuestra clínica',
    onClose,
}: {
    organizationName?: string;
    onClose: () => void;
}) {
    const waGreeting = buildGreeting(organizationName);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);

    const [data, setData] = useState<ApiResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Cerrar con Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Debounce de la búsqueda (350ms) + reset de página
    useEffect(() => {
        const t = setTimeout(() => {
            setDebouncedSearch(search.trim());
            setPage(1);
        }, 350);
        return () => clearTimeout(t);
    }, [search]);

    // Carga asíncrona contra el route handler (Prisma directo, scoped por sesión)
    const abortRef = useRef<AbortController | null>(null);
    const fetchData = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: '10',
                ...(debouncedSearch ? { search: debouncedSearch } : {}),
            });
            const res = await fetch(`/dashboard/auditoria/waiting-list?${params.toString()}`, {
                signal: controller.signal,
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) {
                throw new Error(res.status === 403 ? 'No tiene permisos para ver esta lista.' : 'No se pudo cargar la lista de espera.');
            }
            const json = (await res.json()) as ApiResponse;
            setData(json);
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
            setError(e?.message || 'Error inesperado.');
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearch]);

    useEffect(() => {
        fetchData();
        return () => abortRef.current?.abort();
    }, [fetchData]);

    const items = data?.items ?? [];

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* HEADER */}
                <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 p-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                            <span>📜</span> Lista de espera — pendientes de contacto
                        </h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Pacientes que eligieron quedar en cola por un cupo. Contáctelos para asignarles cita.
                            {data ? (
                                <span className="ml-1 font-medium text-zinc-700 dark:text-zinc-300">
                                    {data.total} en total.
                                </span>
                            ) : null}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white text-2xl leading-none"
                        aria-label="Cerrar"
                    >
                        ×
                    </button>
                </div>

                {/* BARRA DE BÚSQUEDA */}
                <div className="shrink-0 p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">🔍</span>
                        <input
                            type="text"
                            autoFocus
                            placeholder="Buscar por nombre o cédula del paciente..."
                            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                {/* CUERPO: TABLA CON SCROLL */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500 dark:text-zinc-400">
                            <svg className="animate-spin h-8 w-8 text-cyan-500" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                            </svg>
                            <p className="text-sm">Cargando lista de espera…</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
                            <span className="text-4xl">⚠️</span>
                            <p className="text-zinc-700 dark:text-zinc-300 font-medium">{error}</p>
                            <button
                                onClick={fetchData}
                                className="mt-1 px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all"
                            >
                                Reintentar
                            </button>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-2 text-center px-6">
                            <span className="text-4xl">🎉</span>
                            <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                                {debouncedSearch ? 'Sin coincidencias para esa búsqueda.' : 'No hay pacientes en lista de espera.'}
                            </p>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                {debouncedSearch ? 'Pruebe con otro nombre o cédula.' : 'Todos los cupos están al día.'}
                            </p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/80 backdrop-blur z-10">
                                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                    <th className="px-4 py-3 font-semibold">Paciente</th>
                                    <th className="px-4 py-3 font-semibold">WhatsApp</th>
                                    <th className="px-4 py-3 font-semibold">Solicitud</th>
                                    <th className="px-4 py-3 font-semibold">Registro</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {items.map((item) => (
                                    <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                        {/* PACIENTE + CÉDULA */}
                                        <td className="px-4 py-3 align-top">
                                            <p className="font-semibold text-zinc-900 dark:text-white">{item.patientName}</p>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                                                CC {item.cedula}
                                            </p>
                                        </td>

                                        {/* WHATSAPP (botón cyan → wa.me) */}
                                        <td className="px-4 py-3 align-top">
                                            <a
                                                href={`${item.whatsappLink}?text=${encodeURIComponent(waGreeting)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold transition-all"
                                            >
                                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                                                    <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.515 5.26l-.999 3.648 3.973-1.045zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                                                </svg>
                                                WhatsApp
                                            </a>
                                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono mt-1">
                                                {item.phoneDisplay}
                                            </p>
                                        </td>

                                        {/* SOLICITUD: especialidad + médico (si aplica) */}
                                        <td className="px-4 py-3 align-top">
                                            <p className="font-medium text-zinc-900 dark:text-white">{item.specialty}</p>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                {item.eps ? <>EPS: {item.eps}</> : <span className="italic">Cualquier EPS</span>}
                                            </p>
                                            {item.preferredDoctor && (
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                    👨‍⚕️ {item.preferredDoctor}
                                                </p>
                                            )}
                                        </td>

                                        {/* REGISTRO: fecha/hora + tiempo esperando (ámbar si >24h) */}
                                        <td className="px-4 py-3 align-top">
                                            <p className="text-zinc-700 dark:text-zinc-300">
                                                {new Date(item.registeredAt).toLocaleString('es-CO', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </p>
                                            <span
                                                className={`inline-block mt-1 px-2 py-0.5 rounded-md text-xs font-semibold ${
                                                    item.isOverdue
                                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                                                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                                                }`}
                                            >
                                                ⏳ {item.waitLabel}
                                                {item.isOverdue && ' esperando'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* FOOTER: PAGINACIÓN */}
                {data && data.totalPages > 1 && !loading && !error && (
                    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Página <strong className="text-zinc-900 dark:text-white">{data.page}</strong> de {data.totalPages}
                            {' · '}
                            {data.total} pacientes
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={data.page <= 1}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                ← Anterior
                            </button>
                            <button
                                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                                disabled={data.page >= data.totalPages}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Siguiente →
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
