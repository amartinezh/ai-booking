/**
 * 🚪 Quitar a una persona de la lista de espera desde el panel (2026-11-26,
 * docs/PLAN_PERMANENCIA_LISTA_ESPERA.md L7).
 *
 * Antes la ventana «En lista de espera» de la Caja Negra solo mostraba la cola: el
 * personal no podía sacar a nadie, ni siquiera al médico director del hospital, que
 * llevaba días pidiéndolo por el chat. La entrada queda `CANCELLED` con el motivo
 * `QUITADO_POR_PERSONAL`, quién y cuándo (lo mismo que deja el chat con
 * `PIDIO_SALIR`), y el asistente no le vuelve a ofrecer cupos.
 *
 * Solo entradas que esperan: una con una oferta por contestar tiene su cupo
 * apartado, y lo suelta el asistente (al responder o al vencer).
 */
import type { Prisma, PrismaClient } from '@agenia/database';

type Db = Pick<PrismaClient, 'waitlistEntry'>;

export type ResultadoQuitar =
    | { ok: true; servicio: string; cedula: string }
    | { ok: false; error: string };

export const MOTIVO_QUITADO_POR_PERSONAL = 'QUITADO_POR_PERSONAL';

const NOTA_MAX = 300;

export async function quitarDeLaListaDeEspera(
    db: Db,
    p: { organizationId: string; entryId: string; quien: string; nota?: string | null; ahora?: Date },
): Promise<ResultadoQuitar> {
    const entrada = await db.waitlistEntry.findFirst({
        where: { id: p.entryId, organizationId: p.organizationId },
        include: { patient: { select: { cedula: true } }, service: { select: { name: true } } },
    });
    if (!entrada) return { ok: false, error: 'Esa persona ya no está en la lista de espera.' };
    if (entrada.status === 'NOTIFIED') {
        return {
            ok: false,
            error: 'Tiene una oferta de cupo por contestar. Inténtelo de nuevo cuando la responda o venza (a lo sumo en 2 horas).',
        };
    }
    if (entrada.status !== 'WAITING') return { ok: false, error: 'Esa persona ya no está en la lista de espera.' };

    const antes =
        entrada.metadata && typeof entrada.metadata === 'object' && !Array.isArray(entrada.metadata)
            ? (entrada.metadata as Record<string, unknown>)
            : {};
    // La pregunta «¿todavía necesita la cita?» ya no está pendiente.
    const conservado = { ...antes };
    delete conservado.preguntaSigueDesde;
    const nota = p.nota?.trim().slice(0, NOTA_MAX) || null;
    const { count } = await db.waitlistEntry.updateMany({
        // Con el estado que se leyó: si en medio le llegó una oferta, no se toca.
        where: { id: entrada.id, organizationId: p.organizationId, status: 'WAITING' },
        data: {
            status: 'CANCELLED',
            metadata: {
                ...conservado,
                motivo: MOTIVO_QUITADO_POR_PERSONAL,
                quitadoPor: p.quien,
                salioEn: (p.ahora ?? new Date()).toISOString(),
                ...(nota ? { nota } : {}),
            } as Prisma.InputJsonObject,
        },
    });
    if (count === 0) {
        return { ok: false, error: 'Le acaba de llegar una oferta de cupo o ya salió de la lista. Actualice la lista.' };
    }
    return { ok: true, servicio: entrada.service.name, cedula: entrada.patient.cedula };
}
