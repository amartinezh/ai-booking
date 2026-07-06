import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { formatAppointmentCompact } from '@/lib/date';
import MarkReviewedButton from './MarkReviewedButton';
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

type EstadoFiltro = 'pendientes' | 'revisadas' | 'todas';

// ─────────────────────────────────────────────────────────────
// SOLICITUDES DE ALTA — revisiones pedidas por los ciudadanos desde el
// formulario público /solicitud-alta/{orgId} (al que remite el chatbot
// cuando la cédula no figura en el padrón EPS).
// ─────────────────────────────────────────────────────────────
export default async function SolicitudesAltaPage({
    searchParams,
}: {
    searchParams: Promise<{ estado?: string; page?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN' || !session.organizationId) redirect('/dashboard');

    const params = await searchParams;
    const estado: EstadoFiltro = params.estado === 'revisadas' || params.estado === 'todas'
        ? params.estado
        : 'pendientes';
    const page = Math.max(1, Number(params.page) || 1);
    const organizationId = session.organizationId;

    const where = {
        organizationId,
        ...(estado === 'pendientes' ? { status: 'PENDING' as const } : {}),
        ...(estado === 'revisadas' ? { status: 'REVIEWED' as const } : {}),
    };

    const [pendingCount, reviewedCount, filteredTotal, rows] = await Promise.all([
        prisma.epsEnrollmentRequest.count({ where: { organizationId, status: 'PENDING' } }),
        prisma.epsEnrollmentRequest.count({ where: { organizationId, status: 'REVIEWED' } }),
        prisma.epsEnrollmentRequest.count({ where }),
        prisma.epsEnrollmentRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
    ]);

    const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

    const filtroHref = (target: EstadoFiltro) => `/dashboard/solicitudes-alta?estado=${target}`;
    const pageHref = (target: number) => `/dashboard/solicitudes-alta?estado=${estado}&page=${target}`;

    const FILTROS: Array<{ key: EstadoFiltro; label: string; count?: number }> = [
        { key: 'pendientes', label: 'Pendientes', count: pendingCount },
        { key: 'revisadas', label: 'Revisadas', count: reviewedCount },
        { key: 'todas', label: 'Todas', count: pendingCount + reviewedCount },
    ];

    return (
        <div className="max-w-6xl mx-auto animate-fade-in space-y-8">
            <header>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    📨 Solicitudes de Alta
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Reclamos y peticiones de revisión de ciudadanos que no figuran en el{' '}
                    <Link href="/dashboard/padron" className="text-teal-600 hover:underline font-medium">
                        Padrón EPS
                    </Link>
                    . Si el alta procede, actualice el padrón (re-importe el CSV) y marque la solicitud como revisada.
                </p>
            </header>

            {/* Filtros por estado */}
            <div className="flex flex-wrap gap-2">
                {FILTROS.map((filtro) => (
                    <Link
                        key={filtro.key}
                        href={filtroHref(filtro.key)}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                            estado === filtro.key
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                    >
                        {filtro.label} ({filtro.count})
                    </Link>
                ))}
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead>Ciudadano</TableHead>
                        <TableHead>Teléfono</TableHead>
                        <TableHead>EPS declarada</TableHead>
                        <TableHead>Caso / argumento</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Acción</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="py-10 text-center text-zinc-400">
                                {estado === 'pendientes'
                                    ? 'No hay solicitudes pendientes por revisar. 🎉'
                                    : 'No hay solicitudes en este filtro.'}
                            </TableCell>
                        </TableRow>
                    ) : (
                        rows.map((request) => (
                            <TableRow key={request.id}>
                                <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                                    {formatAppointmentCompact(request.createdAt)}
                                </TableCell>
                                <TableCell className="font-mono text-sm">{request.cedula}</TableCell>
                                <TableCell className="font-medium text-zinc-800 dark:text-zinc-100">
                                    {request.fullName}
                                </TableCell>
                                <TableCell className="text-sm text-zinc-500">{request.phone ?? '—'}</TableCell>
                                <TableCell className="text-sm">{request.epsName ?? '—'}</TableCell>
                                <TableCell className="max-w-[320px]">
                                    <details className="group text-sm text-zinc-600 dark:text-zinc-300">
                                        <summary className="cursor-pointer list-none truncate group-open:whitespace-normal">
                                            {request.message}
                                        </summary>
                                    </details>
                                </TableCell>
                                <TableCell>
                                    <span
                                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
                                            request.status === 'PENDING'
                                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                        }`}
                                    >
                                        {request.status === 'PENDING' ? 'Pendiente' : 'Revisada'}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    {request.status === 'PENDING' ? (
                                        <MarkReviewedButton requestId={request.id} />
                                    ) : (
                                        <span className="text-xs text-zinc-400 whitespace-nowrap">
                                            {request.reviewedAt ? formatAppointmentCompact(request.reviewedAt) : '—'}
                                        </span>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>

            <div className="flex items-center justify-between text-sm text-zinc-500">
                <span>
                    Página {page} de {totalPages} — {filteredTotal} solicitud(es)
                </span>
                <div className="flex gap-2">
                    {page > 1 && (
                        <Link
                            href={pageHref(page - 1)}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            Anterior
                        </Link>
                    )}
                    {page < totalPages && (
                        <Link
                            href={pageHref(page + 1)}
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
