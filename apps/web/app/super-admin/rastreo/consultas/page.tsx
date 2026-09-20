import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { resolverActor } from '@/lib/rastreo/acceso';
import { listarConsultas } from '@/lib/rastreo/servicio';
import TablaConsultas from '@/app/dashboard/rastreo/components/TablaConsultas';

/** Bitácora de consultas de UNA clínica, para SUPER_ADMIN (elige cuál con `?org=`). */
export default async function SuperAdminConsultasPage({
    searchParams,
}: {
    searchParams: Promise<{ org?: string; pagina?: string }>;
}) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const { org, pagina } = await searchParams;

    const encabezado = (
        <div>
            <Link href="/super-admin/rastreo" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                ← Rastreo de paciente
            </Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Consultas registradas</h1>
        </div>
    );

    if (!org) {
        const organizaciones = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
        return (
            <div className="mx-auto w-full max-w-3xl space-y-5">
                {encabezado}
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Elige la organización cuyas consultas quieres revisar.</p>
                <ul className="space-y-2">
                    {organizaciones.map((o) => (
                        <li key={o.id}>
                            <Link
                                href={`/super-admin/rastreo/consultas?org=${o.id}`}
                                className="block rounded-lg border border-zinc-200 bg-white p-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                            >
                                {o.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    const actor = await resolverActor(prisma, session, org);
    if (!actor.ok) redirect('/super-admin/rastreo/consultas');
    const r = await listarConsultas(prisma, actor.actor, { pagina: Number(pagina) });

    return (
        <div className="mx-auto w-full max-w-5xl space-y-5">
            {encabezado}
            {r.success ? (
                <TablaConsultas lista={r.data} hrefBase={`/super-admin/rastreo/consultas?org=${org}`} />
            ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{r.error}</p>
            )}
        </div>
    );
}
