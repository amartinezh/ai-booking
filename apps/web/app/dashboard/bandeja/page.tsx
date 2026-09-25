import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import { resolverActorBandeja } from '@/lib/bandeja/acceso';
import { leerFiltros } from '@/lib/bandeja/filtros';
import { estadoAvisos, listarExcepciones } from '@/lib/bandeja/servicio';
import BandejaClient from './BandejaClient';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Bandeja de excepciones de sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #3):
 * lo que el vigilante encontró y alguien tiene que atender. Este `redirect` es solo
 * cortesía: quien de verdad decide qué se ve y qué se puede hacer es el servidor en
 * cada lectura y en cada acción (`lib/bandeja/`).
 *
 * Solo en clínicas con espejo: sin un HIS al otro lado no hay nada que sincronizar.
 */
export default async function BandejaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const a = await resolverActorBandeja(prisma, await getSession());
    if (!a.ok) redirect('/dashboard');

    const { conEspejo } = await getTenantMirrorFlags(a.actor.organizationId);
    if (!conEspejo) redirect('/dashboard');

    const filtros = leerFiltros(await searchParams);
    const [lista, avisos] = await Promise.all([
        listarExcepciones(prisma, a.actor, filtros),
        estadoAvisos(prisma, a.actor),
    ]);

    return (
        <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
            {lista.success ? (
                <BandejaClient
                    lista={lista.data}
                    filtros={filtros}
                    medicos={lista.data.medicos}
                    avisos={avisos.success ? avisos.data : null}
                    puedeConfigurarAvisos={a.actor.permisos.configurarAvisos}
                />
            ) : (
                <div className="p-4 bg-amber-50 text-amber-700 rounded-lg font-medium border border-amber-200">
                    {lista.error}
                </div>
            )}
        </div>
    );
}
