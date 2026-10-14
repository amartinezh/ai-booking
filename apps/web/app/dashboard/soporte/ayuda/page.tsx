import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getMenusForRole } from '@/lib/menus';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import AyudaClient from './AyudaClient';

export const dynamic = 'force-dynamic';

/**
 * Centro de ayuda. Por ahora solo para ORG_ADMIN: es el rol que ve todas las
 * opciones del menú, y la ayuda las explica todas. Se entra desde el botón
 * «Ayuda» de la página de Soporte.
 */
export default async function AyudaPage({
    searchParams,
}: {
    searchParams: Promise<{ tema?: string; q?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard/soporte');

    const { tema, q } = await searchParams;
    // Las opciones del espejo solo existen en algunas clínicas: la ayuda las
    // explica igual, pero avisa cuáles no están en el menú de esta.
    const { conEspejo, conAvisos, conAvisosDriver } = await getTenantMirrorFlags(session.organizationId);
    const rutasDisponibles = getMenusForRole(session.role, { conEspejo, conAvisos, conAvisosDriver }).map((m) => m.href);

    return (
        <div className="max-w-6xl mx-auto w-full">
            <AyudaClient temaInicial={tema ?? null} consultaInicial={q ?? ''} rutasDisponibles={rutasDisponibles} />
        </div>
    );
}
