import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { permisosDeRol, resolverActor } from '@/lib/rastreo/acceso';
import { listarConsultas } from '@/lib/rastreo/servicio';
import TablaConsultas from '../components/TablaConsultas';

/** Bitácora de consultas de la clínica (solo ORG_ADMIN): quién consultó a quién y por qué. */
export default async function ConsultasPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
    const session = await getSession();
    if (!session?.organizationId || session.role === 'SUPER_ADMIN' || !permisosDeRol(session.role).verConsultas) {
        redirect('/dashboard');
    }

    const actor = await resolverActor(prisma, session);
    if (!actor.ok) redirect('/dashboard');

    const { pagina } = await searchParams;
    const r = await listarConsultas(prisma, actor.actor, { pagina: Number(pagina) });

    return (
        <div className="mx-auto w-full max-w-5xl space-y-5 p-2 md:p-4">
            <div>
                <Link href="/dashboard/rastreo" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    ← Rastreo de paciente
                </Link>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Consultas registradas</h1>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Cada búsqueda, cada expediente abierto y cada dato mostrado queda aquí con quién lo hizo y por qué. Los datos personales aparecen enmascarados.
                </p>
            </div>
            {r.success ? (
                <TablaConsultas lista={r.data} hrefBase="/dashboard/rastreo/consultas" />
            ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{r.error}</p>
            )}
        </div>
    );
}
