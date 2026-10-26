import { corteDeEstadisticas, diaCorto, diasEntre, esHoraFueraDeOficina, horaCorta } from './periodo';

describe('estadísticas — el corte de cada día', () => {
    it('antes de las 6 a. m. de Bogotá sigue el corte de ayer: el día anterior aún no está a la vista', () => {
        // 05:59 en Bogotá (UTC-5).
        const c = corteDeEstadisticas(new Date('2026-10-26T10:59:00Z'), 'America/Bogota');
        expect(c).toEqual({
            hasta: '2026-10-25',
            ultimoDia: '2026-10-24',
            hastaUtc: new Date('2026-10-25T05:00:00Z'),
        });
    });

    it('desde las 6 a. m. entra el día anterior completo, nunca el de hoy a medias', () => {
        const c = corteDeEstadisticas(new Date('2026-10-26T11:00:00Z'), 'America/Bogota');
        expect(c.hasta).toBe('2026-10-26');
        expect(c.ultimoDia).toBe('2026-10-25');
        // Medianoche del 26 en Bogotá.
        expect(c.hastaUtc.toISOString()).toBe('2026-10-26T05:00:00.000Z');
    });

    it('cuenta la hora de la clínica, no la del servidor (UTC)', () => {
        // 23:30 del 25 en Bogotá = 04:30 UTC del 26: para la clínica todavía es el 25.
        const c = corteDeEstadisticas(new Date('2026-10-26T04:30:00Z'), 'America/Bogota');
        expect(c.hasta).toBe('2026-10-25');
        expect(c.ultimoDia).toBe('2026-10-24');
    });

    it('cruza el fin de mes', () => {
        const c = corteDeEstadisticas(new Date('2026-11-01T12:00:00Z'), 'America/Bogota');
        expect(c.ultimoDia).toBe('2026-10-31');
    });
});

describe('estadísticas — ayudas de fechas y horas', () => {
    it('los días de un rango, los dos extremos incluidos', () => {
        expect(diasEntre('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
        expect(diasEntre('2026-10-26', '2026-10-25')).toEqual([]);
    });

    it('etiquetas cortas para los ejes', () => {
        expect(diaCorto('2026-10-25')).toBe('dom 25');
        expect(diaCorto('2026-10-26')).toBe('lun 26');
        expect(horaCorta(0)).toBe('12 a. m.');
        expect(horaCorta(6)).toBe('6 a. m.');
        expect(horaCorta(12)).toBe('12 p. m.');
        expect(horaCorta(17)).toBe('5 p. m.');
    });

    it('fuera de oficina: antes de las 7 a. m. o desde las 5 p. m.', () => {
        expect([6, 7, 16, 17].map(esHoraFueraDeOficina)).toEqual([true, false, false, true]);
    });
});
