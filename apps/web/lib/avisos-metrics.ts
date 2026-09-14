/**
 * Avisos masivos — Fase 3 (§10, "métrica de entrega"). Ver
 * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md.
 *
 * Puramente aritmético sobre los contadores que `MassNoticeBatch` ya
 * guarda (`sent`/`failed`/`skipped`) — nada nuevo que consultar. `skipped`
 * queda fuera del cálculo a propósito: no es un intento fallido de WhatsApp,
 * es un destinatario que nunca se pudo intentar (sin teléfono ni BSUID) —
 * mezclarlo con `failed` culparía a Meta de algo que pasó antes de que
 * existiera la oportunidad de escribirle.
 */

export interface DeliveryCounts {
    sent: number;
    failed: number;
}

/**
 * Porcentaje de entrega de UN lote. `null` cuando todavía no se ha
 * intentado nada (sent + failed === 0) — un lote en BORRADOR no tiene tasa
 * de entrega, tiene ausencia de dato, y 0% lo confundiría con un lote que
 * se envió entero y falló entero.
 */
export function deliveryRate({ sent, failed }: DeliveryCounts): number | null {
    const attempted = sent + failed;
    if (attempted === 0) return null;
    return Math.round((sent / attempted) * 100);
}

/**
 * Agrega la entrega de varios lotes en una sola tasa — para el resumen del
 * historial. Los lotes sin intentos (BORRADOR) no aportan al total: ni
 * suman a favor ni en contra.
 */
export function aggregateDeliveryRate(batches: DeliveryCounts[]): number | null {
    const totals = batches.reduce(
        (acc, b) => ({ sent: acc.sent + b.sent, failed: acc.failed + b.failed }),
        { sent: 0, failed: 0 },
    );
    return deliveryRate(totals);
}
