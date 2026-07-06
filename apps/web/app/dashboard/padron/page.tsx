import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { formatAppointmentCompact } from '@/lib/date';
import PadronUploader from './PadronUploader';
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
// PADRÓN EPS — pacientes dados de alta para agendar por EPS.
// Carga por CSV (Validar → Importar) + consulta del padrón vigente.
// ─────────────────────────────────────────────────────────────
export default async function PadronPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; page?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN' || !session.organizationId) redirect('/dashboard');

    const { q, page: pageParam } = await searchParams;
    const page = Math.max(1, Number(pageParam) || 1);
    const organizationId = session.organizationId;

    const where = {
        organizationId,
        ...(q
            ? {
                  OR: [
                      { cedula: { contains: q } },
                      { fullName: { contains: q, mode: 'insensitive' as const } },
                  ],
              }
            : {}),
    };

    const [total, totalActive, byEps, rows] = await Promise.all([
        prisma.epsEnrolledPatient.count({ where: { organizationId } }),
        prisma.epsEnrolledPatient.count({ where: { organizationId, isActive: true } }),
        prisma.epsEnrolledPatient.groupBy({
            by: ['epsId'],
            where: { organizationId, isActive: true },
            _count: { _all: true },
        }),
        prisma.epsEnrolledPatient.findMany({
            where,
            include: { eps: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
    ]);

    const filteredTotal = q ? await prisma.epsEnrolledPatient.count({ where }) : total;
    const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

    const epsNames = await prisma.eps.findMany({
        where: { id: { in: byEps.map((g) => g.epsId) } },
        select: { id: true, name: true },
    });
    const epsNameById = new Map(epsNames.map((eps) => [eps.id, eps.name]));

    const pageHref = (target: number) =>
        `/dashboard/padron?${new URLSearchParams({ ...(q ? { q } : {}), page: String(target) })}`;

    return (
        <div className="max-w-6xl mx-auto animate-fade-in space-y-8">
            <header>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    🪪 Padrón EPS (Altas)
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Solo los pacientes de este padrón pueden agendar citas <strong>por EPS</strong> a través del
                    asistente virtual. Las citas <em>Particular</em> (pago directo) no requieren alta.
                </p>
            </header>

            {/* Métricas del padrón */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
                    <p className="text-xs font-medium text-zinc-500">Pacientes en padrón</p>
                    <p className="text-2xl font-extrabold text-zinc-900 dark:text-white">{total}</p>
                </div>
                <div className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
                    <p className="text-xs font-medium text-zinc-500">Dados de alta (activos)</p>
                    <p className="text-2xl font-extrabold text-emerald-600">{totalActive}</p>
                </div>
                {byEps.slice(0, 2).map((group) => (
                    <div
                        key={group.epsId}
                        className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-4"
                    >
                        <p className="text-xs font-medium text-zinc-500 truncate" title={epsNameById.get(group.epsId)}>
                            {epsNameById.get(group.epsId) ?? 'EPS'}
                        </p>
                        <p className="text-2xl font-extrabold text-teal-600">{group._count._all}</p>
                    </div>
                ))}
            </section>

            <PadronUploader />

            {/* Padrón vigente */}
            <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                        Padrón vigente {q ? `— resultados para "${q}"` : ''}
                    </h2>
                    <form className="flex gap-2" action="/dashboard/padron">
                        <input
                            type="search"
                            name="q"
                            defaultValue={q ?? ''}
                            placeholder="Buscar por cédula o nombre…"
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-teal-400 focus:outline-none"
                        />
                        <button
                            type="submit"
                            className="rounded-lg bg-zinc-800 dark:bg-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
                        >
                            Buscar
                        </button>
                    </form>
                </div>

                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Cédula</TableHead>
                            <TableHead>Nombre completo</TableHead>
                            <TableHead>EPS</TableHead>
                            <TableHead>Teléfono</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Actualizado</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="py-10 text-center text-zinc-400">
                                    {q
                                        ? 'Sin resultados para la búsqueda.'
                                        : 'El padrón está vacío. Importe el CSV de pacientes dados de alta para habilitar el agendamiento por EPS.'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((patient) => (
                                <TableRow key={patient.id}>
                                    <TableCell className="font-mono text-sm">{patient.cedula}</TableCell>
                                    <TableCell className="font-medium text-zinc-800 dark:text-zinc-100">
                                        {patient.fullName}
                                    </TableCell>
                                    <TableCell className="text-sm">{patient.eps.name}</TableCell>
                                    <TableCell className="text-sm text-zinc-500">{patient.phone ?? '—'}</TableCell>
                                    <TableCell>
                                        <span
                                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                                patient.isActive
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                                            }`}
                                        >
                                            {patient.isActive ? 'De alta' : 'Inactivo'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                                        {formatAppointmentCompact(patient.updatedAt)}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>

                <div className="flex items-center justify-between text-sm text-zinc-500">
                    <span>
                        Página {page} de {totalPages} — {filteredTotal} registro(s)
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
            </section>
        </div>
    );
}
