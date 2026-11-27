/**
 * 📊 Lo que la ventana «En lista de espera» muestra de cada persona para ver a los
 * atascados (2026-11-26, docs/PLAN_PERMANENCIA_LISTA_ESPERA.md L7): cuántas ofertas
 * recibió, cuántos días rechazó, con qué palabras rechazó la última vez y si tiene
 * pendiente la pregunta «¿todavía necesita la cita?».
 *
 * El 26-nov la mitad de la cola (9 de 18) llevaba tres días rechazados o más, y de
 * esas ofertas solo el 3,6 % terminó en cita.
 */
import type { PrismaClient } from '@agenia/database';

type Db = Pick<PrismaClient, 'interactionLog'>;

export interface ResumenDeLaEntrada {
    ofertas: number;
    diasRechazados: number;
    ultimoRechazo: string | null;
    preguntaPendiente: boolean;
}

const RECHAZO_MAX = 120;

/** Lo que dice la metadata de la entrada (pura). */
export function leerMetadataDeLaEntrada(metadata: unknown): { diasRechazados: number; preguntaPendiente: boolean } {
    const m =
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? (metadata as { diasRechazados?: unknown; preguntaSigueDesde?: unknown })
            : {};
    return {
        diasRechazados: Array.isArray(m.diasRechazados) ? m.diasRechazados.length : 0,
        preguntaPendiente: typeof m.preguntaSigueDesde === 'string',
    };
}

/**
 * Las ofertas y el último rechazo salen de la bitácora del asistente
 * (`InteractionLog`), desde que la persona se anotó. Si la consulta falla, la fila
 * se muestra sin esos datos.
 */
export async function resumenDeLaEntrada(
    db: Db,
    e: { organizationId: string; whatsappId: string; createdAt: Date; metadata: unknown },
): Promise<ResumenDeLaEntrada> {
    const deLaMetadata = leerMetadataDeLaEntrada(e.metadata);
    try {
        const desde = { organizationId: e.organizationId, whatsappId: e.whatsappId, createdAt: { gte: e.createdAt } };
        const [ofertas, rechazo] = await Promise.all([
            db.interactionLog.count({ where: { ...desde, status: 'WAITLIST_NOTIFIED' } }),
            db.interactionLog.findFirst({
                where: {
                    ...desde,
                    OR: [
                        { metadata: { path: ['event'], equals: 'WAITLIST_OFFER_REJECTED' } },
                        { metadata: { path: ['step'], equals: 'WAITLIST_TARDIA_NO' } },
                    ],
                },
                orderBy: { createdAt: 'desc' },
                select: { userMessage: true },
            }),
        ]);
        const texto = rechazo?.userMessage?.replace(/\s+/g, ' ').trim() || null;
        return {
            ofertas,
            ...deLaMetadata,
            ultimoRechazo: texto && texto.length > RECHAZO_MAX ? `${texto.slice(0, RECHAZO_MAX - 1)}…` : texto,
        };
    } catch {
        return { ofertas: 0, ...deLaMetadata, ultimoRechazo: null };
    }
}
