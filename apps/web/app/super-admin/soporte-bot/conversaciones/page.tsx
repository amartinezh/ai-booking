import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import {
    ROL_LEGIBLE,
    TEXTO_MOTIVO_CIERRE,
    filtroDeConversaciones,
    periodoDeCifras,
    type FiltroConversaciones,
    type MotivoCierre,
    type UserRole,
} from '@agenia/shared';
import { formatAppointmentCompact } from '@/lib/date';
import { getConversacionesAsistente } from '@/app/actions/support-bot';
import ResultadoDeLaConversacion from './ResultadoDeLaConversacion';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RUTA = '/super-admin/soporte-bot/conversaciones';
const SELECT =
    'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm dark:text-white';

const FILTROS: Array<[FiltroConversaciones, string]> = [
    ['TODAS', 'Todas'],
    ['CON_CASO', 'Terminaron en caso'],
    ['SIN_CUBRIR', 'El manual no cubrió algo'],
    ['NO_UTIL', '«No, abrir un caso»'],
];

/**
 * Las conversaciones del asistente (docs/PLAN_BOT_SOPORTE.md §3.7, Fase 5): solo
 * lectura, las de los últimos 7 o 30 días (se guardan 180), de a 50. Solo SUPER_ADMIN.
 */
export default async function ConversacionesPage({
    searchParams,
}: {
    searchParams: Promise<{ dias?: string; clinica?: string; filtro?: string; cursor?: string }>;
}) {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const q = await searchParams;
    const dias = periodoDeCifras(q.dias);
    const filtro = filtroDeConversaciones(q.filtro);
    const clinica = q.clinica || null;
    const [res, clinicas] = await Promise.all([
        getConversacionesAsistente({ dias, clinica, filtro, cursor: q.cursor || null }),
        prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const siguiente = (cursor: string) => {
        const p = new URLSearchParams({ dias: String(dias), filtro, cursor });
        if (clinica) p.set('clinica', clinica);
        return `${RUTA}?${p.toString()}`;
    };

    return (
        <div className="max-w-6xl mx-auto animate-fade-in pb-10 space-y-6">
            <header>
                <Link href="/super-admin/soporte-bot" className="text-sm text-indigo-600 hover:underline">
                    ← Asistente de soporte
                </Link>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mt-2">
                    Conversaciones del asistente
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 mt-1 max-w-3xl">
                    Lo que el personal habló con el asistente, solo para leer. Se guardan 180 días. Abrir una queda en
                    la bitácora del sistema.
                </p>
            </header>

            <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtros">
                <label className="text-sm">
                    <span className="block text-xs text-zinc-500 mb-1">Periodo</span>
                    <select name="dias" defaultValue={String(dias)} className={SELECT}>
                        <option value="7">Últimos 7 días</option>
                        <option value="30">Últimos 30 días</option>
                    </select>
                </label>
                <label className="text-sm">
                    <span className="block text-xs text-zinc-500 mb-1">Clínica</span>
                    <select name="clinica" defaultValue={clinica ?? ''} className={SELECT}>
                        <option value="">Todas</option>
                        {clinicas.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="text-sm">
                    <span className="block text-xs text-zinc-500 mb-1">Cuáles</span>
                    <select name="filtro" defaultValue={filtro} className={SELECT}>
                        {FILTROS.map(([v, t]) => (
                            <option key={v} value={v}>
                                {t}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="submit"
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700"
                >
                    Ver
                </button>
            </form>

            {!res.ok ? (
                <p role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                    {res.error}
                </p>
            ) : res.data.filas.length === 0 ? (
                <p className="text-sm text-zinc-500">No hay conversaciones con esos filtros.</p>
            ) : (
                <>
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                        {res.data.filas.map((c) => (
                            <li key={c.id}>
                                <Link
                                    href={`${RUTA}/${c.id}`}
                                    className="flex flex-col sm:flex-row sm:items-center gap-2 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                            {c.clinica} · {c.correo}
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {ROL_LEGIBLE[c.rol as UserRole] ?? c.rol} · {formatAppointmentCompact(c.inicio)} ·{' '}
                                            {c.mensajes} mensajes
                                            {c.motivoCierre &&
                                                ` · ${TEXTO_MOTIVO_CIERRE[c.motivoCierre as MotivoCierre] ?? c.motivoCierre}`}
                                        </p>
                                    </div>
                                    <ResultadoDeLaConversacion c={c} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                    {res.data.siguiente && (
                        <Link
                            href={siguiente(res.data.siguiente)}
                            className="inline-flex text-sm font-semibold text-indigo-600 hover:underline"
                        >
                            Ver las siguientes
                        </Link>
                    )}
                </>
            )}
        </div>
    );
}
