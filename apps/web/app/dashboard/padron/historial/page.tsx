import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { formatAppointmentCompact } from '@/lib/date';
import { normalizeDocumento, documentoSinCerosIniciales } from '@agenia/shared';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/app/components/ui/table';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

// ─────────────────────────────────────────────────────────────
// HISTORIAL DE CARGAS DEL PADRÓN — evidencia completa del proceso de carga.
//
// Dos vistas en una sola pantalla, según qué filtro esté activo:
//   · Sin "doc": lista de CORTES (PadronImport) — uno por cada vez que se
//     importó un archivo, con sus totales y quién lo cargó.
//   · Con "doc": la LÍNEA DE TIEMPO de un documento a través de todos los
//     cortes en los que apareció (PadronImportRow), sin importar la EPS —
//     responde "¿por qué esta persona sí/no puede agendar?".
//
// Nunca muestra más que la cédula y el resultado por fila: PadronImportRow
// no guarda la fila cruda de una fila aceptada (ver ESTADO.md).
// ─────────────────────────────────────────────────────────────
export default async function PadronHistorialPage({
    searchParams,
}: {
    searchParams: Promise<{
        doc?: string;
        eps?: string;
        desde?: string;
        hasta?: string;
        page?: string;
    }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN' || !session.organizationId) redirect('/dashboard');
    const organizationId = session.organizationId;

    const { doc, eps: epsFilter, desde, hasta, page: pageParam } = await searchParams;
    const page = Math.max(1, Number(pageParam) || 1);

    const epsOptions = await prisma.eps.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });

    const filtersHref = (overrides: Record<string, string | undefined>) => {
        const params = new URLSearchParams();
        const merged = { doc, eps: epsFilter, desde, hasta, ...overrides };
        for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
        return `/dashboard/padron/historial?${params.toString()}`;
    };

    // ── Vista de documento: la línea de tiempo de una persona ──
    if (doc && doc.trim()) {
        const normalizado = normalizeDocumento(doc);
        const candidatos = [...new Set([normalizado, documentoSinCerosIniciales(normalizado)])].filter(
            Boolean,
        );

        const rows = normalizado
            ? await prisma.padronImportRow.findMany({
                  where: {
                      import: { organizationId },
                      OR: [{ cedulaNormalizada: { in: candidatos } }, { cedulaCruda: { in: candidatos } }],
                  },
                  include: { import: { include: { eps: { select: { name: true } } } } },
                  orderBy: { import: { createdAt: 'desc' } },
                  take: 200,
              })
            : [];

        return (
            <div className="max-w-5xl mx-auto animate-fade-in space-y-6">
                <Header />

                <BuscadorDocumento doc={doc} />

                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                            Historial del documento «{doc.trim()}»
                        </h2>
                        <Link
                            href="/dashboard/padron/historial"
                            className="text-sm text-teal-600 hover:underline"
                        >
                            ← Ver todos los cortes
                        </Link>
                    </div>

                    {!normalizado ? (
                        <p className="text-zinc-400 text-sm py-6">Ingrese un documento válido para buscar.</p>
                    ) : rows.length === 0 ? (
                        <p className="text-zinc-400 text-sm py-6">
                            Este documento no aparece en ningún corte cargado (ni como aceptado ni como
                            rechazado).
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha del corte</TableHead>
                                    <TableHead>EPS</TableHead>
                                    <TableHead>Archivo</TableHead>
                                    <TableHead>Línea</TableHead>
                                    <TableHead>Resultado</TableHead>
                                    <TableHead>Motivo (si fue rechazada)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                                            {formatAppointmentCompact(row.import.createdAt)}
                                        </TableCell>
                                        <TableCell className="text-sm">{row.import.eps.name}</TableCell>
                                        <TableCell className="text-sm text-zinc-500 truncate max-w-[16rem]">
                                            <Link
                                                href={`/dashboard/padron/historial/${row.importId}`}
                                                className="hover:underline"
                                                title={row.import.fileName}
                                            >
                                                {row.import.fileName}
                                            </Link>
                                        </TableCell>
                                        <TableCell className="text-sm">{row.line}</TableCell>
                                        <TableCell>
                                            <ResultadoBadge resultado={row.resultado} />
                                        </TableCell>
                                        <TableCell className="text-xs text-zinc-500 max-w-xs">
                                            {row.resultado === 'RECHAZADO'
                                                ? `${row.errorColumn ? `${row.errorColumn}: ` : ''}${row.errorMessage ?? ''}`
                                                : '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </section>
            </div>
        );
    }

    // ── Vista de cortes: la lista de importaciones ──
    const where = {
        organizationId,
        ...(epsFilter ? { epsId: epsFilter } : {}),
        ...(desde || hasta
            ? {
                  createdAt: {
                      ...(desde ? { gte: new Date(`${desde}T00:00:00.000Z`) } : {}),
                      ...(hasta ? { lte: new Date(`${hasta}T23:59:59.999Z`) } : {}),
                  },
              }
            : {}),
    };

    const [total, imports] = await Promise.all([
        prisma.padronImport.count({ where }),
        prisma.padronImport.findMany({
            where,
            include: {
                eps: { select: { name: true } },
                createdBy: { select: { email: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
            <Header />

            <BuscadorDocumento doc="" />

            {/* Filtros */}
            <section className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
                <form className="flex flex-wrap items-end gap-3" action="/dashboard/padron/historial">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-zinc-500">EPS</label>
                        <select
                            name="eps"
                            defaultValue={epsFilter ?? ''}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200"
                        >
                            <option value="">Todas</option>
                            {epsOptions.map((e) => (
                                <option key={e.id} value={e.id}>
                                    {e.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-zinc-500">Desde</label>
                        <input
                            type="date"
                            name="desde"
                            defaultValue={desde ?? ''}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-zinc-500">Hasta</label>
                        <input
                            type="date"
                            name="hasta"
                            defaultValue={hasta ?? ''}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200"
                        />
                    </div>
                    <button
                        type="submit"
                        className="rounded-lg bg-zinc-800 dark:bg-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
                    >
                        Filtrar
                    </button>
                    {(epsFilter || desde || hasta) && (
                        <Link
                            href="/dashboard/padron/historial"
                            className="text-sm text-zinc-500 hover:underline"
                        >
                            Limpiar filtros
                        </Link>
                    )}
                </form>
            </section>

            {/* Lista de cortes */}
            <section className="space-y-4">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>EPS</TableHead>
                            <TableHead>Archivo</TableHead>
                            <TableHead>Filas</TableHead>
                            <TableHead>Altas</TableHead>
                            <TableHead>Actualiz.</TableHead>
                            <TableHead>Reactiv.</TableHead>
                            <TableHead>Bajas</TableHead>
                            <TableHead>Rechaz.</TableHead>
                            <TableHead>Cargado por</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {imports.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="py-10 text-center text-zinc-400">
                                    Sin cortes cargados todavía
                                    {epsFilter || desde || hasta ? ' con estos filtros' : ''}.
                                </TableCell>
                            </TableRow>
                        ) : (
                            imports.map((imp) => (
                                <TableRow key={imp.id}>
                                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                                        {formatAppointmentCompact(imp.createdAt)}
                                    </TableCell>
                                    <TableCell className="text-sm">{imp.eps.name}</TableCell>
                                    <TableCell className="text-sm max-w-[14rem] truncate">
                                        <Link
                                            href={`/dashboard/padron/historial/${imp.id}`}
                                            className="text-teal-600 hover:underline"
                                            title={imp.fileName}
                                        >
                                            {imp.fileName}
                                        </Link>
                                        {imp.deactivationWasConfirmed && (
                                            <span
                                                className="ml-1 text-amber-500"
                                                title="El corte desactivó más del 10% del padrón activo de esta EPS y se confirmó explícitamente."
                                            >
                                                ⚠️
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm">{imp.totalDataRows}</TableCell>
                                    <TableCell className="text-sm text-emerald-600">{imp.created}</TableCell>
                                    <TableCell className="text-sm text-blue-600">{imp.updated}</TableCell>
                                    <TableCell className="text-sm text-teal-600">{imp.reactivated}</TableCell>
                                    <TableCell className="text-sm text-zinc-500">{imp.deactivated}</TableCell>
                                    <TableCell className="text-sm text-red-500">{imp.errorRows}</TableCell>
                                    <TableCell className="text-xs text-zinc-500">{imp.createdBy.email}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>

                <div className="flex items-center justify-between text-sm text-zinc-500">
                    <span>
                        Página {page} de {totalPages} — {total} corte(s)
                    </span>
                    <div className="flex gap-2">
                        {page > 1 && (
                            <Link
                                href={filtersHref({ page: String(page - 1) })}
                                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                Anterior
                            </Link>
                        )}
                        {page < totalPages && (
                            <Link
                                href={filtersHref({ page: String(page + 1) })}
                                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                Siguiente
                            </Link>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );

    function Header() {
        return (
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                        📋 Historial de cargas del padrón
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 max-w-3xl">
                        Cada corte importado, con sus totales, y la línea de tiempo de cualquier documento a
                        través de todos los cortes en los que apareció.
                    </p>
                </div>
                <Link
                    href="/dashboard/padron"
                    className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                    ← Volver al padrón
                </Link>
            </header>
        );
    }
}

function BuscadorDocumento({ doc }: { doc: string }) {
    return (
        <section className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/padron/historial">
                <div className="flex flex-col gap-1 flex-1 min-w-[16rem]">
                    <label className="text-xs font-medium text-zinc-500">
                        Buscador avanzado — historial por documento
                    </label>
                    <input
                        type="search"
                        name="doc"
                        defaultValue={doc}
                        placeholder="Número de documento…"
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-teal-400 focus:outline-none"
                    />
                </div>
                <button
                    type="submit"
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
                >
                    Buscar historial
                </button>
                {doc && (
                    <Link href="/dashboard/padron/historial" className="text-sm text-zinc-500 hover:underline">
                        Limpiar
                    </Link>
                )}
            </form>
        </section>
    );
}

export function ResultadoBadge({ resultado }: { resultado: string }) {
    const styles: Record<string, string> = {
        CREADO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
        ACTUALIZADO: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
        REACTIVADO: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400',
        RECHAZADO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    };
    return (
        <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                styles[resultado] ?? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
        >
            {resultado}
        </span>
    );
}
