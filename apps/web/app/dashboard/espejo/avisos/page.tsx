import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import { getAvisosConfigAction, listBatchesAction } from '@/app/actions/avisos';
import AvisosClient from './components/AvisosClient';

/**
 * Avisos masivos de cancelación — EXCLUSIVO del driver cnt-sanvicente-anserma.
 * Ver docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md.
 *
 * Las tres llaves (§1): rol (ORG_ADMIN u BOOKING_AGENT — §1.3), espejo con el
 * driver correcto, y la bandera `avisosMasivos.enabled`. Las dos primeras se
 * comprueban aquí para decidir si la RUTA existe; la tercera decide si se ve
 * el flujo de tres pasos o solo el panel de configuración (y ese panel, a su
 * vez, solo lo ve `ORG_ADMIN`).
 */
export default async function AvisosPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN' && session.role !== 'BOOKING_AGENT') redirect('/dashboard');

    const { conAvisosDriver, conAvisos } = await getTenantMirrorFlags(session.organizationId);
    const isOrgAdmin = session.role === 'ORG_ADMIN';

    // Llaves 1+2 (rol ya comprobado arriba; falta el driver): sin el espejo
    // ENCENDIDO con exactamente `driverKey = 'cnt-sanvicente-anserma'`, esta
    // ruta no existe para NADIE — ni siquiera para ORG_ADMIN, que no puede
    // "configurar" un espejo que no es el suyo (exclusividad, requisito 6).
    // El espejo mismo se prende desde /dashboard/espejo; esta pantalla no lo
    // hace por él.
    if (!conAvisosDriver) redirect('/dashboard');

    const [configRes, batchesRes] = await Promise.all([
        isOrgAdmin ? getAvisosConfigAction() : Promise.resolve(null),
        conAvisos ? listBatchesAction() : Promise.resolve(null),
    ]);

    return (
        <div className="p-6 md:p-8 max-w-6xl mx-auto w-full">
            <AvisosClient
                isOrgAdmin={isOrgAdmin}
                conAvisos={conAvisos}
                initialConfig={configRes?.success ? configRes.config : null}
                initialBatches={batchesRes?.success ? batchesRes.batches : []}
            />
        </div>
    );
}
