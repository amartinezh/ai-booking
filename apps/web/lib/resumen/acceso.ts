import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';

const DRIVER = 'cnt-sanvicente-anserma';

/**
 * ORG_ADMIN de una clínica con el espejo ENCENDIDO y el driver de Anserma: el
 * único que ve el resumen de la atención en el panel. Nunca dice cuál llave
 * falló. Se comprueba en CADA acción y ruta, nunca solo al cargar la pantalla.
 */
export async function adminDelResumen(): Promise<{ organizationId: string; userId: string; role: string } | null> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    const espejo = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: session.organizationId },
        select: { driverKey: true, enabled: true },
    });
    if (!espejo || !espejo.enabled || espejo.driverKey !== DRIVER) return null;
    return { organizationId: session.organizationId, userId: session.userId, role: session.role };
}

/**
 * «Envíos de documentos» (D14): el Administrador y el Agente de Reservas de una
 * clínica con el espejo de Anserma encendido y el resumen de la atención
 * habilitado. Nunca ven el contenido clínico, solo el seguimiento.
 */
export async function personalDeEnvios(): Promise<{ organizationId: string; userId: string; role: string } | null> {
    const session = await getSession();
    if (!session || !session.organizationId) return null;
    if (session.role !== 'ORG_ADMIN' && session.role !== 'BOOKING_AGENT') return null;
    const espejo = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: session.organizationId },
        select: { driverKey: true, enabled: true, resumenAtencion: true },
    });
    const r = espejo?.resumenAtencion;
    if (!espejo || !espejo.enabled || espejo.driverKey !== DRIVER) return null;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
    return { organizationId: session.organizationId, userId: session.userId, role: session.role };
}
