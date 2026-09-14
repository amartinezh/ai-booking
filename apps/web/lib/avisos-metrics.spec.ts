import { deliveryRate, aggregateDeliveryRate } from './avisos-metrics';

describe('deliveryRate', () => {
    it('todos entregados: 100%', () => {
        expect(deliveryRate({ sent: 10, failed: 0 })).toBe(100);
    });

    it('todos fallidos: 0%', () => {
        expect(deliveryRate({ sent: 0, failed: 10 })).toBe(0);
    });

    it('mixto: redondea al entero más cercano', () => {
        expect(deliveryRate({ sent: 2, failed: 1 })).toBe(67); // 66.66… → 67
    });

    it('sin intentos (lote en BORRADOR): null, no 0%', () => {
        expect(deliveryRate({ sent: 0, failed: 0 })).toBeNull();
    });
});

describe('aggregateDeliveryRate', () => {
    it('suma sent/failed de varios lotes antes de calcular el porcentaje', () => {
        // 9/10 + 1/2 calculado por separado daría 90% y 50% — agregado da 10/12.
        const result = aggregateDeliveryRate([
            { sent: 9, failed: 1 },
            { sent: 1, failed: 1 },
        ]);
        expect(result).toBe(83); // 10/12 = 83.33… → 83
    });

    it('lotes sin intentos no distorsionan el agregado', () => {
        const result = aggregateDeliveryRate([
            { sent: 10, failed: 0 },
            { sent: 0, failed: 0 }, // BORRADOR
        ]);
        expect(result).toBe(100);
    });

    it('lista vacía: null', () => {
        expect(aggregateDeliveryRate([])).toBeNull();
    });

    it('todos los lotes sin intentos: null', () => {
        expect(
            aggregateDeliveryRate([
                { sent: 0, failed: 0 },
                { sent: 0, failed: 0 },
            ]),
        ).toBeNull();
    });
});
