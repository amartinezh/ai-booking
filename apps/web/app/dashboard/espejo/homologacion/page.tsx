import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { tieneEspejo } from '@/app/actions/espejo';
import { getHomologacionData } from '@/app/actions/homologacion';
import HomologacionClient from './components/HomologacionClient';

/**
 * Homologación manual de médicos del HIS ↔ AgenIA.
 *
 * Sub-página de /dashboard/espejo por la misma razón que /auditoria: es un
 * drill-down, no un estado a mostrar de entrada. Ver homologacion.ts (actions)
 * para el porqué del paso manual.
 */
export default async function HomologacionPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');
    if (!(await tieneEspejo())) redirect('/dashboard/espejo');

    const res = await getHomologacionData();

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
            {res.success ? (
                <HomologacionClient his={res.data.his} agenia={res.data.agenia} />
            ) : (
                <div className="p-4 bg-amber-50 text-amber-700 rounded-lg font-medium border border-amber-200">
                    {res.error}
                </div>
            )}
        </div>
    );
}
