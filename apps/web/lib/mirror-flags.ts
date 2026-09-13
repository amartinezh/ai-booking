import { prisma } from './prisma';

/**
 * Banderas de navegación que dependen del espejo de un tenant — usadas por
 * `dashboard/layout.tsx` (sidebar) y `dashboard/page.tsx` (QuickAccessGrid),
 * antes duplicadas ahí como la misma consulta. Una sola lectura de
 * `HospitalMirrorConfig` calcula las dos.
 */
export interface TenantMirrorFlags {
    /** ¿Existe fila de espejo para este tenant? Igual que antes: NO exige `enabled=true` — el admin necesita ver el panel para poder reactivarlo. */
    conEspejo: boolean;
    /**
     * Llaves 1+2 del plan de avisos (espejo `enabled` + `driverKey` exacto),
     * SIN la Llave 3. Es la que decide si `ORG_ADMIN` puede ver el panel de
     * CONFIGURACIÓN de avisos — que tiene que poder prenderse la primera
     * vez, así que no puede exigir que ya esté prendido.
     */
    conAvisosDriver: boolean;
    /**
     * Avisos masivos — EXCLUSIVO del driver cnt-sanvicente-anserma (ver
     * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §1). Las
     * TRES llaves: `conAvisosDriver` + `avisosMasivos.enabled` — "si falta
     * cualquiera, no aparece el menú". Decide el flujo de 3 pasos.
     */
    conAvisos: boolean;
}

export async function getTenantMirrorFlags(
    organizationId: string | null | undefined,
): Promise<TenantMirrorFlags> {
    const empty: TenantMirrorFlags = { conEspejo: false, conAvisosDriver: false, conAvisos: false };
    if (!organizationId) return empty;

    const config = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { enabled: true, driverKey: true, avisosMasivos: true },
    });
    if (!config) return empty;

    const avisosMasivos = config.avisosMasivos as { enabled?: boolean } | null;
    const conAvisosDriver = config.enabled && config.driverKey === 'cnt-sanvicente-anserma';

    return {
        conEspejo: true,
        conAvisosDriver,
        conAvisos: conAvisosDriver && !!avisosMasivos?.enabled,
    };
}
