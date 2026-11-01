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
