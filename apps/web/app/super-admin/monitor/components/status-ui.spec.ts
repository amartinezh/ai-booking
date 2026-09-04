import { statusLabel, fmtLatency, fmtDuration, fmtLocal } from './status-ui';

describe('statusLabel', () => {
    it.each([
        ['UP', 'Operativo'],
        ['DEGRADED', 'Degradado'],
        ['DOWN', 'Caído'],
    ])('%s → %s', (status, label) => {
        expect(statusLabel(status)).toBe(label);
    });

    it('pasa a través un status desconocido sin lanzar', () => {
        expect(statusLabel('WEIRD')).toBe('WEIRD');
    });
});

describe('fmtLatency', () => {
    it('muestra "—" para null/undefined', () => {
        expect(fmtLatency(null)).toBe('—');
        expect(fmtLatency(undefined)).toBe('—');
    });

    it('muestra milisegundos por debajo de 1000ms', () => {
        expect(fmtLatency(250)).toBe('250 ms');
    });

    it('muestra segundos con un decimal a partir de 1000ms', () => {
        expect(fmtLatency(1500)).toBe('1.5 s');
    });
});

describe('fmtDuration', () => {
    it('segundos por debajo de un minuto', () => {
        expect(fmtDuration(45_000)).toBe('45 s');
    });

    it('minutos por debajo de una hora', () => {
        expect(fmtDuration(18 * 60_000)).toBe('18 min');
    });

    it('horas exactas sin minutos residuales', () => {
        expect(fmtDuration(2 * 3_600_000)).toBe('2 h');
    });

    it('horas con minutos residuales', () => {
        expect(fmtDuration(2 * 3_600_000 + 14 * 60_000)).toBe('2 h 14 min');
    });
});

describe('fmtLocal', () => {
    it('muestra "—" para null (incidente aún sin resolver)', () => {
        expect(fmtLocal(null)).toBe('—');
    });

    it('formatea en la zona horaria de Bogotá vía @/lib/date', () => {
        // 18:00 UTC = 13:00 en Bogotá (UTC-5).
        expect(fmtLocal('2026-06-03T18:00:00.000Z')).toContain('01:00 p m');
    });
});
