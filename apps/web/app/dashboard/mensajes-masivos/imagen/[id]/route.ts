import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { puedeUsarMensajesMasivos } from '@/lib/mensajes-masivos/acceso';

/**
 * 📢 La imagen de un envío de Mensajes masivos, para la vista previa y el
 * seguimiento (docs/PLAN_MENSAJES_MASIVOS.md §7). Solo para el administrador de
 * la clínica dueña del envío; nunca queda en caché compartida.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const sesion = await getSession();
    if (!puedeUsarMensajesMasivos(sesion)) return new Response('Acceso denegado', { status: 403 });
    const { id } = await params;
    const envio = await prisma.massCampaign.findFirst({
        where: { id, organizationId: sesion.organizationId },
        select: { imageData: true, imageMime: true },
    });
    if (!envio?.imageData || !envio.imageMime) return new Response('Sin imagen', { status: 404 });
    return new Response(new Uint8Array(envio.imageData), {
        headers: { 'Content-Type': envio.imageMime, 'Cache-Control': 'private, no-store' },
    });
}
