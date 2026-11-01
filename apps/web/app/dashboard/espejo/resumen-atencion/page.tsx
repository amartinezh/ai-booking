import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getPanelResumenAtencionAction } from '@/app/actions/resumen-atencion';
import ResumenAtencionClient from './components/ResumenAtencionClient';

/**
 * Resumen de la atención — interruptores (docs/PLAN_RESUMEN_ATENCION.md §3.11).
 * EXCLUSIVO del driver cnt-sanvicente-anserma y solo ORG_ADMIN: la acción lo
 * comprueba y, si no cumple, esta ruta no existe para quien entra.
 *
 * Fase 1: solo se enciende la LECTURA (en sombra). Nada se le envía a nadie.
 */
export default async function ResumenAtencionPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');

    const res = await getPanelResumenAtencionAction();
    if (!res.success) redirect('/dashboard/espejo');

    return (
        <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
            <ResumenAtencionClient panel={res.panel} />
        </div>
    );
}
