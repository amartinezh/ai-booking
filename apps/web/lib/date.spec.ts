import {
    DEFAULT_TIMEZONE,
    formatAppointmentLong,
    formatAppointmentCompact,
    formatDateShort,
    formatTimeOnly,
} from './date';

// Regresión del bug de "hora UTC": los contenedores corren en UTC, así que sin
// `timeZone: 'America/Bogota'` explícito estas fechas saldrían 5h adelantadas.
// Este wrapper es el único punto por el que el dashboard debe formatear fechas
// (ver CLAUDE.md) — si se rompe el re-export, todas las pantallas del panel
// vuelven a mostrar hora del navegador/contenedor en vez de la de la clínica.
describe('lib/date (wrapper de @agenia/shared)', () => {
    it('usa America/Bogota como zona horaria por defecto', () => {
        expect(DEFAULT_TIMEZONE).toBe('America/Bogota');
    });

    it('formatDateShort muestra la fecha en Bogotá aunque el Date sea medianoche UTC', () => {
        // 2026-06-03T00:00:00Z es 2026-06-02 19:00 en Bogotá (UTC-5): el día
        // calendario cambia. Si el wrapper no aplicara la TZ, saldría 03/06.
        const midnightUtc = new Date('2026-06-03T00:00:00.000Z');
        expect(formatDateShort(midnightUtc)).toBe('02/06/2026');
    });

    it('formatTimeOnly convierte una hora UTC a la hora de pared de Bogotá', () => {
        // 18:00 UTC = 13:00 en Bogotá (UTC-5).
        const date = new Date('2026-06-03T18:00:00.000Z');
        expect(formatTimeOnly(date)).toBe('01:00 p m');
    });

    it('formatAppointmentLong y formatAppointmentCompact respetan un timeZone explícito distinto', () => {
        const date = new Date('2026-06-03T18:00:00.000Z');
        // Sin overrides (Bogotá, UTC-5): 13:00. Con Madrid (UTC+2 en verano): 20:00.
        expect(formatAppointmentCompact(date, { timeZone: 'Europe/Madrid' })).toContain('08:00 p m');
        expect(formatAppointmentLong(date)).toContain('01:00 p m');
    });
});
