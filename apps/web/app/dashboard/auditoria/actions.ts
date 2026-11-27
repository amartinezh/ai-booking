'use server';

import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { getErrorMessage } from '../../../lib/error';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import { enmascarar } from '@/lib/actividad/catalogo';
import { quitarDeLaListaDeEspera } from '@/lib/lista-espera/quitar';

/**
 * 🚪 «Quitar de la lista» en la ventana «En lista de espera» de la Caja Negra
 * (2026-11-26, docs/PLAN_PERMANENCIA_LISTA_ESPERA.md L7). Los mismos dos perfiles
 * que ven esa lista (`waiting-list/route.ts`): administrador y agente de reservas.
 * Una acción de servidor es un endpoint público: el rol y la clínica se revisan aquí.
 * Queda la constancia en la Actividad de usuarios.
 */
export async function quitarDeLaListaDeEsperaAction(
    entryId: string,
    nota?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        const session = await getSession();
        if (!session?.organizationId || (session.role !== 'ORG_ADMIN' && session.role !== 'BOOKING_AGENT')) {
            return { ok: false, error: 'No tiene permisos para cambiar la lista de espera.' };
        }
        if (typeof entryId !== 'string' || !entryId) return { ok: false, error: 'Falta la persona que quiere quitar.' };
        const organizationId = session.organizationId;
        const notaLimpia = typeof nota === 'string' ? nota.trim() : '';

        const r = await quitarDeLaListaDeEspera(prisma, {
            organizationId,
            entryId,
            quien: session.email || session.userId,
            nota: notaLimpia || null,
        });
        if (!r.ok) return r;

        await registrarActividad({
            action: 'WAITLIST_ENTRY_REMOVED',
            message: `Quitó de la lista de espera la entrada ${entryId}`,
            actor: actorDeSesion(session),
            organizationId,
            metadata: {
                detalle: [r.servicio, `paciente ${enmascarar(r.cedula)}`, notaLimpia ? `nota: ${notaLimpia.slice(0, 300)}` : null]
                    .filter(Boolean)
                    .join(' · '),
                entrada: entryId,
            },
        });
        return { ok: true };
    } catch (e: unknown) {
        console.error('No se pudo quitar a la persona de la lista de espera:', getErrorMessage(e));
        return { ok: false, error: 'No se pudo quitar de la lista. Inténtelo de nuevo.' };
    }
}
