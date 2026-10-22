import {
    estadoDelDia,
    horaDeMinutos,
    minutosDeHora,
    moverMes,
    rangoCorto,
    semanasDelMes,
} from './calendario';

const SABADOS = { date: '2026-10-24', repeatWeekly: true, startMinute: null, endMinute: null };
const VIERNES_8_10 = { date: '2026-10-23', repeatWeekly: false, startMinute: 480, endMinute: 600 };

describe('semanasDelMes — octubre de 2026, hoy jueves 22', () => {
    const semanas = semanasDelMes(2026, 10, '2026-10-22', [SABADOS, VIERNES_8_10]);
    const dia = (fecha: string) => semanas.flat().find((d) => d.fecha === fecha)!;

    it('semanas de lunes a domingo: el 1 (jueves) va en la cuarta columna; 5 semanas', () => {
        expect(semanas).toHaveLength(5);
        expect(semanas[0].map((d) => d.fecha)).toEqual([
            '2026-09-28',
            '2026-09-29',
            '2026-09-30',
            '2026-10-01',
            '2026-10-02',
            '2026-10-03',
            '2026-10-04',
        ]);
        expect(semanas[0][0].delMes).toBe(false);
        expect(semanas[0][3].delMes).toBe(true);
        expect(semanas[4][6].fecha).toBe('2026-11-01');
    });

    it('hoy, pasados y futuros', () => {
        expect(dia('2026-10-22').hoy).toBe(true);
        expect(dia('2026-10-22').pasado).toBe(false);
        expect(dia('2026-10-21').pasado).toBe(true);
    });

    it('estados: el sábado todo el día, el viernes algunas horas, el resto libre', () => {
        expect(dia('2026-10-24').estado).toBe('completo');
        expect(dia('2026-10-31').estado).toBe('completo');
        expect(dia('2026-10-23').estado).toBe('parcial');
        expect(dia('2026-10-30').estado).toBe('libre');
        // Antes de que empiece la repetición, nada.
        expect(dia('2026-10-17').estado).toBe('libre');
    });

    it('cada día lleva sus bloqueos', () => {
        expect(dia('2026-10-23').reglas).toEqual([VIERNES_8_10]);
    });
});

describe('ayudantes', () => {
    it('estadoDelDia: un bloqueo de todo el día gana a uno de horas', () => {
        expect(estadoDelDia([])).toBe('libre');
        expect(estadoDelDia([VIERNES_8_10])).toBe('parcial');
        expect(estadoDelDia([VIERNES_8_10, SABADOS])).toBe('completo');
    });

    it('moverMes cruza el año', () => {
        expect(moverMes(2026, 12, 1)).toEqual({ anio: 2027, mes: 1 });
        expect(moverMes(2026, 1, -1)).toEqual({ anio: 2025, mes: 12 });
    });

    it('horas ↔ minutos', () => {
        expect(minutosDeHora('08:30')).toBe(510);
        expect(minutosDeHora('24:00')).toBeNull();
        expect(minutosDeHora('')).toBeNull();
        expect(horaDeMinutos(510)).toBe('08:30');
    });

    it('rango corto para la celda', () => {
        expect(rangoCorto(VIERNES_8_10)).toBe('8–10');
        expect(rangoCorto({ ...VIERNES_8_10, startMinute: 510 })).toBe('8:30–10');
        expect(rangoCorto(SABADOS)).toBe('Todo el día');
    });
});
