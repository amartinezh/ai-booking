import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getMenusForRole } from '@/lib/menus';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import { cargarConocimiento } from '@/lib/ayuda/cargar-conocimiento';
import type { ContenidoAyuda } from '@/lib/ayuda/tipos';
import AyudaClient from './AyudaClient';

export const dynamic = 'force-dynamic';

/**
 * Centro de ayuda. Por ahora solo para ORG_ADMIN: es el rol que ve todas las
 * opciones del menú, y la ayuda las explica todas. Se entra desde el botón
 * «Ayuda» de la página de Soporte.
 *
 * Todo el texto sale de docs/conocimiento/AGENIA.md (ver docs/conocimiento/README.md).
 */
export default async function AyudaPage({
    searchParams,
}: {
    searchParams: Promise<{ tema?: string; q?: string }>;
}) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard/soporte');

    let contenido: ContenidoAyuda;
    try {
        contenido = cargarConocimiento();
    } catch (e) {
        // Las pruebas y el CI impiden que un .md mal formado llegue aquí; si aun
        // así pasa, el resto del panel sigue funcionando y queda en el log.
        console.error('[ayuda] No se pudo leer el archivo de conocimiento:', e);
        return (
            <div className="max-w-3xl mx-auto w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <h1 className="text-lg font-semibold">La ayuda no está disponible en este momento</h1>
                <p className="mt-2 text-sm">
                    No pudimos cargar su contenido. Repórtalo al equipo técnico desde Soporte para que lo revise.
                </p>
                <Link href="/dashboard/soporte" className="mt-4 inline-block text-sm font-semibold underline-offset-2 hover:underline">
                    Volver a Soporte
                </Link>
            </div>
        );
    }

    const { tema, q } = await searchParams;
    // Las opciones del espejo solo existen en algunas clínicas: la ayuda las
    // explica igual, pero avisa cuáles no están en el menú de esta.
    const { conEspejo, conAvisos, conAvisosDriver } = await getTenantMirrorFlags(session.organizationId);
    const rutasDisponibles = getMenusForRole(session.role, { conEspejo, conAvisos, conAvisosDriver }).map((m) => m.href);

    return (
        <div className="max-w-6xl mx-auto w-full">
            <AyudaClient contenido={contenido} temaInicial={tema ?? null} consultaInicial={q ?? ''} rutasDisponibles={rutasDisponibles} />
        </div>
    );
}
