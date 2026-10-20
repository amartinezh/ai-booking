import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Prisma } from '@agenia/database';
import { SOLICITUD_CITAS, TEXTO_TIPO_LIMITE, etiquetaMotivoSolicitudCitas, etiquetaPeriodo } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { formatAppointmentCompact } from '@/lib/date';
import { puedeConfigurarLimiteCitas, puedeGestionarLimiteCitas } from '@/lib/limite-citas/acceso';
import RevisarSolicitud from './RevisarSolicitud';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type EstadoFiltro = 'pendientes' | 'aprobadas' | 'rechazadas' | 'sin-radicar' | 'todas';

const WHERE_POR_FILTRO: Record<EstadoFiltro, Prisma.AppointmentLimitRequestWhereInput> = {
    pendientes: { status: 'PENDING' },
    aprobadas: { status: 'APPROVED' },
    rechazadas: { status: 'REJECTED' },
    'sin-radicar': { status: 'INVITED' },
    // «Todas» son las que el paciente radicó; las invitaciones sin llenar van aparte.
    todas: { status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
};

const ESTADO: Record<string, { texto: string; clase: string }> = {
    INVITED: { texto: 'Sin radicar', clase: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
    PENDING: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
    APPROVED: { texto: 'Aprobada', clase: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' },
    REJECTED: { texto: 'Rechazada', clase: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' },
};

// ─────────────────────────────────────────────────────────────
// SOLICITUDES DE MÁS CITAS — pacientes que el asistente frenó por el límite
// de citas del día o del mes (/dashboard/limites-citas) y que piden una
// revisión desde el enlace que les envió (/solicitud-citas/{id}).
// La ven ORG_ADMIN y BOOKING_AGENT.
// ─────────────────────────────────────────────────────────────
export default async function SolicitudesCitasPage({
    searchParams,
}: {
    searchParams: Promise<{ estado?: string; page?: string; q?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (!puedeGestionarLimiteCitas(session)) redirect('/dashboard');

    const params = await searchParams;
    const estado: EstadoFiltro = params.estado && params.estado in WHERE_POR_FILTRO ? (params.estado as EstadoFiltro) : 'pendientes';
    const page = Math.max(1, Number(params.page) || 1);
    const q = (params.q ?? '').trim().slice(0, 60);
    const organizationId = session.organizationId;

    const busqueda: Prisma.AppointmentLimitRequestWhereInput = q
        ? {
              OR: [
                  // La cédula se guarda sin ceros a la izquierda (LimiteCitasService).
                  { cedula: { contains: q.replace(/\D/g, '').replace(/^0+/, '') || q } },
                  { fullName: { contains: q, mode: 'insensitive' } },
              ],
          }
        : {};
    const where: Prisma.AppointmentLimitRequestWhereInput = {
        organizationId,
        ...WHERE_POR_FILTRO[estado],
        ...busqueda,
    };

    const [porEstado, filteredTotal, rows, org] = await Promise.all([
        prisma.appointmentLimitRequest.groupBy({
            by: ['status'],
            where: { organizationId, ...busqueda },
            _count: { _all: true },
        }),
        prisma.appointmentLimitRequest.count({ where }),
        prisma.appointmentLimitRequest.findMany({
            where,
            orderBy: estado === 'sin-radicar' ? { createdAt: 'desc' } : [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
        prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    ]);

    const timeZone = org?.timezone ?? undefined;
    const fecha = (d: Date) => formatAppointmentCompact(d, { timeZone });
    const cuenta = (s: string) => porEstado.find((g) => g.status === s)?._count._all ?? 0;
    const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
    const ahora = new Date();

    const href = (cambios: { estado?: EstadoFiltro; page?: number }) => {
        const u = new URLSearchParams();
        u.set('estado', cambios.estado ?? estado);
        if (cambios.page && cambios.page > 1) u.set('page', String(cambios.page));
        if (q) u.set('q', q);
        return `/dashboard/solicitudes-citas?${u.toString()}`;
    };

    const FILTROS: Array<{ key: EstadoFiltro; label: string; count: number }> = [
        { key: 'pendientes', label: 'Pendientes', count: cuenta('PENDING') },
        { key: 'aprobadas', label: 'Aprobadas', count: cuenta('APPROVED') },
        { key: 'rechazadas', label: 'Rechazadas', count: cuenta('REJECTED') },
        { key: 'todas', label: 'Todas', count: cuenta('PENDING') + cuenta('APPROVED') + cuenta('REJECTED') },
        { key: 'sin-radicar', label: 'Sin radicar', count: cuenta('INVITED') },
    ];

    return (
        <div className="max-w-7xl mx-auto animate-fade-in space-y-8">
            <header>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    📝 Solicitudes de más citas
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Pacientes a los que el asistente no les agendó porque ya tenían el máximo de citas del día o del mes (
                    {puedeConfigurarLimiteCitas(session) ? (
                        <Link href="/dashboard/limites-citas" className="text-teal-600 hover:underline font-medium">
                            Límite de citas
                        </Link>
                    ) : (
                        'Límite de citas'
                    )}
                    ) y que explican por qué necesitan más. Al <strong>aprobar</strong>, el asistente les permite agendar las
                    citas adicionales que conceda, solo para ese día o ese mes.
                </p>
            </header>

            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex flex-wrap gap-2">
                    {FILTROS.map((filtro) => (
                        <Link
                            key={filtro.key}
                            href={href({ estado: filtro.key })}
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
                <form method="get" className="flex gap-2 lg:ml-auto">
                    <input type="hidden" name="estado" value={estado} />
                    <input
                        name="q"
                        defaultValue={q}
                        placeholder="Buscar por documento o nombre…"
                        className="w-64 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm dark:text-white"
                    />
                    <button
                        type="submit"
                        className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900"
                    >
                        Buscar
                    </button>
                </form>
            </div>

            {estado === 'sin-radicar' && (
                <p className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                    El asistente les envió el enlace para pedir la revisión, pero aún no la han llenado. El enlace sirve{' '}
                    {SOLICITUD_CITAS.VIGENCIA_ENLACE_DIAS} días. Si conviene, llame al paciente.
                </p>
            )}

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Radicada</TableHead>
                        <TableHead>Paciente</TableHead>
                        <TableHead>Contacto</TableHead>
                        <TableHead>Límite alcanzado</TableHead>
                        <TableHead>Cita que pedía</TableHead>
                        <TableHead>Caso</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Acción</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="py-10 text-center text-zinc-400">
                                {estado === 'pendientes' && !q
                                    ? 'No hay solicitudes pendientes por revisar. 🎉'
                                    : 'No hay solicitudes en este filtro.'}
                            </TableCell>
                        </TableRow>
                    ) : (
                        rows.map((r) => {
                            const vencida = r.status === 'INVITED' && r.expiresAt <= ahora;
                            const estadoVista = ESTADO[r.status] ?? ESTADO.PENDING;
                            return (
                                <TableRow key={r.id}>
                                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                                        {r.submittedAt ? (
                                            fecha(r.submittedAt)
                                        ) : (
                                            <>
                                                Enlace enviado
                                                <br />
                                                {fecha(r.createdAt)}
                                            </>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <p className="font-medium text-zinc-800 dark:text-zinc-100">{r.fullName}</p>
                                        <p className="font-mono text-xs text-zinc-500">{r.cedula}</p>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <p className="text-zinc-700 dark:text-zinc-200 whitespace-nowrap">{r.phone ?? '—'}</p>
                                        <p className="text-xs text-zinc-400">{r.channel === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'}</p>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                                            {TEXTO_TIPO_LIMITE[r.kind].nombre}
                                        </p>
                                        <p className="text-xs text-zinc-500">{etiquetaPeriodo(r.kind, r.periodKey, timeZone)}</p>
                                        <p className="text-xs text-zinc-400">
                                            Tenía {r.countAtRequest} de {r.limitAtRequest} permitida
                                            {r.limitAtRequest === 1 ? '' : 's'}
                                        </p>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <p className="text-zinc-700 dark:text-zinc-200">{r.serviceName ?? '—'}</p>
                                        {r.requestedSlotAt && (
                                            <p className="text-xs text-zinc-500 whitespace-nowrap">{fecha(r.requestedSlotAt)}</p>
                                        )}
                                        {r.operation === 'RESCHEDULE' && (
                                            <p className="text-xs text-zinc-400">Al cambiar una cita de fecha</p>
                                        )}
                                    </TableCell>
                                    <TableCell className="max-w-[320px] text-sm">
                                        {r.message ? (
                                            <>
                                                <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                                                    {etiquetaMotivoSolicitudCitas(r.reasonCategory)}
                                                </p>
                                                <details className="group text-zinc-600 dark:text-zinc-300">
                                                    <summary className="cursor-pointer list-none truncate group-open:whitespace-normal">
                                                        {r.message}
                                                    </summary>
                                                </details>
                                                {r.extraRequested && (
                                                    <p className="text-xs text-zinc-400 mt-1">
                                                        Pide {r.extraRequested} cita{r.extraRequested === 1 ? '' : 's'} adicional
                                                        {r.extraRequested === 1 ? '' : 'es'}
                                                    </p>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-zinc-400">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <span
                                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${estadoVista.clase}`}
                                        >
                                            {vencida ? 'Enlace vencido' : estadoVista.texto}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                        {r.status === 'PENDING' ? (
                                            <RevisarSolicitud
                                                requestId={r.id}
                                                adicionalesPedidas={r.extraRequested}
                                                periodo={r.kind === 'DAILY' ? 'ese día' : 'ese mes'}
                                            />
                                        ) : r.status === 'APPROVED' || r.status === 'REJECTED' ? (
                                            <div className="max-w-[220px] space-y-0.5 text-zinc-500">
                                                {r.status === 'APPROVED' && r.extraGranted ? (
                                                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                                                        +{r.extraGranted} cita{r.extraGranted === 1 ? '' : 's'}
                                                    </p>
                                                ) : null}
                                                {r.reviewedByEmail && <p className="truncate">{r.reviewedByEmail}</p>}
                                                {r.reviewedAt && <p className="whitespace-nowrap">{fecha(r.reviewedAt)}</p>}
                                                {r.reviewNote && <p className="italic text-zinc-600 dark:text-zinc-300">«{r.reviewNote}»</p>}
                                            </div>
                                        ) : (
                                            <span className="text-zinc-400 whitespace-nowrap">
                                                {vencida ? '—' : `Vence ${fecha(r.expiresAt)}`}
                                            </span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })
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
                            href={href({ page: page - 1 })}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            Anterior
                        </Link>
                    )}
                    {page < totalPages && (
                        <Link
                            href={href({ page: page + 1 })}
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
