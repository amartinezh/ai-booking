import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { formatAppointmentLong } from '@/lib/date';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/app/components/ui/table';
import { ResultadoBadge } from '../page';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const RESULTADOS = ['CREADO', 'ACTUALIZADO', 'REACTIVADO', 'RECHAZADO'] as const;

// ─────────────────────────────────────────────────────────────
// DETALLE DE UN CORTE — cada línea del archivo, con su resultado. Filtrable
// por resultado para poder revisar solo los rechazos, por ejemplo.
// ─────────────────────────────────────────────────────────────
export default async function PadronImportDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ importId: string }>;
    searchParams: Promise<{ resultado?: string; page?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN' || !session.organizationId) redirect('/dashboard');
    const organizationId = session.organizationId;

    const { importId } = await params;
    const { resultado, page: pageParam } = await searchParams;
    const page = Math.max(1, Number(pageParam) || 1);

    const imp = await prisma.padronImport.findFirst({
        where: { id: importId, organizationId },
        include: { eps: { select: { name: true } }, createdBy: { select: { email: true } } },
    });
    if (!imp) notFound();

    const where = {
        importId,
        ...(resultado && RESULTADOS.includes(resultado as (typeof RESULTADOS)[number])
            ? { resultado }
            : {}),
    };

    const [total, rows] = await Promise.all([
        prisma.padronImportRow.count({ where }),
        prisma.padronImportRow.findMany({
            where,
            orderBy: { line: 'asc' },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const filterHref = (overrides: Record<string, string | undefined>) => {
        const params = new URLSearchParams();
        const merged = { resultado, ...overrides };
        for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
        return `/dashboard/padron/historial/${importId}?${params.toString()}`;
    };

    return (
        <div className="max-w-5xl mx-auto animate-fade-in space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-1">
                        Corte del {formatAppointmentLong(imp.createdAt)}
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400">
                        {imp.eps.name} — <span className="font-mono">{imp.fileName}</span> — cargado por{' '}
                        {imp.createdBy.email}
                    </p>
                </div>
                <Link
                    href="/dashboard/padron/historial"
                    className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                    ← Todos los cortes
                </Link>
            </header>

            {/* Resumen del corte */}
            <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <Metric label="Filas del archivo" value={imp.totalDataRows} />
                <Metric label="Altas" value={imp.created} tone="text-emerald-600" />
                <Metric label="Actualizados" value={imp.updated} tone="text-blue-600" />
                <Metric label="Reactivados" value={imp.reactivated} tone="text-teal-600" />
                <Metric label="Bajas" value={imp.deactivated} tone="text-zinc-500" />
                <Metric label="Rechazados" value={imp.errorRows} tone="text-red-500" />
            </section>

            {imp.deactivationWasConfirmed && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    ⚠️ Este corte desactivó más del 10% del padrón activo de {imp.eps.name}, y quien lo cargó
                    confirmó explícitamente que el archivo era correcto y completo.
                </div>
            )}

            <p className="text-xs text-zinc-400 font-mono">
                hash del archivo: {imp.fileHash.slice(0, 16)}…
            </p>

            {/* Filtro por resultado */}
            <div className="flex flex-wrap items-center gap-2">
                <Link
                    href={filterHref({ resultado: undefined, page: undefined })}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        !resultado
                            ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                >
                    Todas
                </Link>
                {RESULTADOS.map((r) => (
                    <Link
                        key={r}
                        href={filterHref({ resultado: r, page: undefined })}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            resultado === r
                                ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                    >
                        {r}
                    </Link>
                ))}
            </div>

            {/* Detalle fila a fila */}
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Línea</TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead>Resultado</TableHead>
                        <TableHead>Detalle</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} className="py-10 text-center text-zinc-400">
                                Sin filas{resultado ? ` con resultado ${resultado}` : ''}.
                            </TableCell>
                        </TableRow>
                    ) : (
                        rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="text-sm text-zinc-500">{row.line}</TableCell>
                                <TableCell className="font-mono text-sm">
                                    {row.cedulaNormalizada ?? (
                                        <span className="text-zinc-400 italic">
                                            &quot;{row.cedulaCruda || '(vacío)'}&quot; — no tiene forma válida
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <ResultadoBadge resultado={row.resultado} />
                                </TableCell>
                                <TableCell className="text-xs text-zinc-500">
                                    {row.resultado === 'RECHAZADO'
                                        ? `${row.errorColumn ? `${row.errorColumn}: ` : ''}${row.errorMessage ?? ''}`
                                        : row.cedulaNormalizada && (
                                              <Link
                                                  href={`/dashboard/padron/historial?doc=${row.cedulaNormalizada}`}
                                                  className="text-teal-600 hover:underline"
                                              >
                                                  Ver historial completo →
                                              </Link>
                                          )}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>

            <div className="flex items-center justify-between text-sm text-zinc-500">
                <span>
                    Página {page} de {totalPages} — {total} fila(s)
                </span>
                <div className="flex gap-2">
                    {page > 1 && (
                        <Link
                            href={filterHref({ page: String(page - 1) })}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            Anterior
                        </Link>
                    )}
                    {page < totalPages && (
                        <Link
                            href={filterHref({ page: String(page + 1) })}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            Siguiente
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
    return (
        <div className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
            <p className="text-xs font-medium text-zinc-500">{label}</p>
            <p className={`text-2xl font-extrabold ${tone ?? 'text-zinc-900 dark:text-white'}`}>{value}</p>
        </div>
    );
}
