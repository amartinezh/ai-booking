/**
 * LÍMITE DE CITAS POR PACIENTE — quién gestiona y la cifra del menú.
 *
 * La configuración del límite (/dashboard/limites-citas) y la bandeja de
 * solicitudes de más citas (/dashboard/solicitudes-citas) son de ORG_ADMIN y
 * BOOKING_AGENT: quien agenda es quien atiende a esos pacientes. Las páginas y
 * sus acciones de servidor lo vuelven a comprobar con esta misma función; el
 * menú solo decide si aparece el enlace.
 */
import type { PrismaClient } from '@agenia/database';
import type { SessionPayload } from '../session';

export type SesionGestora = SessionPayload & { organizationId: string };

export function puedeGestionarLimiteCitas(
    sesion: SessionPayload | null | undefined,
): sesion is SesionGestora {
    return (
        !!sesion?.organizationId &&
        (sesion.role === 'ORG_ADMIN' || sesion.role === 'BOOKING_AGENT')
    );
}

/**
 * Solicitudes radicadas que esperan revisión, para la cifra del menú. Lo pide el
 * layout de TODO el dashboard: ante cualquier error responde 0 (sin cifra) y deja
 * el rastro en el log, igual que la bandeja de sincronización.
 */
export async function solicitudesCitasPendientes(
    db: Pick<PrismaClient, 'appointmentLimitRequest'>,
    sesion: SessionPayload | null | undefined,
): Promise<number> {
    if (!puedeGestionarLimiteCitas(sesion)) return 0;
    try {
        return await db.appointmentLimitRequest.count({
            where: { organizationId: sesion.organizationId, status: 'PENDING' },
        });
    } catch (error: unknown) {
        console.error('[limite-citas] no se pudo contar las solicitudes pendientes del menú', {
            error: error instanceof Error ? error.message : String(error),
        });
        return 0;
    }
}
