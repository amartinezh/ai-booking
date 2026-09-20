import { aUtc, partesLocales } from './zona-horaria';

describe('zona-horaria', () => {
  describe('aUtc', () => {
    it('Bogotá es UTC-5: 10:00 local = 15:00 UTC', () => {
      expect(aUtc('2026-09-22', '10:00', 'America/Bogota')?.toISOString()).toBe(
        '2026-09-22T15:00:00.000Z',
      );
    });

    it('la medianoche local cae en el día anterior… o siguiente en UTC, según el offset', () => {
      expect(aUtc('2026-09-22', '23:30', 'America/Bogota')?.toISOString()).toBe(
        '2026-09-23T04:30:00.000Z',
      );
    });

    it('respeta el horario de verano de otra zona (Nueva York: UTC-4 en verano, UTC-5 en invierno)', () => {
      expect(aUtc('2026-07-01', '12:00', 'America/New_York')?.toISOString()).toBe(
        '2026-07-01T16:00:00.000Z',
      );
      expect(aUtc('2026-01-15', '12:00', 'America/New_York')?.toISOString()).toBe(
        '2026-01-15T17:00:00.000Z',
      );
    });

    it('una hora que no existe (salto de primavera en Nueva York) → null', () => {
      expect(aUtc('2026-03-08', '02:30', 'America/New_York')).toBeNull();
    });

    it.each([
      ['2026-02-31', '10:00'],
      ['2026-13-01', '10:00'],
      ['22/09/2026', '10:00'],
      ['2026-09-22', '25:00'],
      ['2026-09-22', '10:60'],
      ['2026-09-22', '10'],
      ['', ''],
    ])('%s %s no es válido → null', (fecha, hora) => {
      expect(aUtc(fecha, hora, 'America/Bogota')).toBeNull();
    });
  });

  describe('partesLocales', () => {
    it('15:00 UTC = 10:00 en Bogotá, el mismo día', () => {
      expect(partesLocales('2026-09-22T15:00:00.000Z', 'America/Bogota')).toEqual({
        fecha: '2026-09-22',
        hora: '10:00',
      });
    });

    it('a las 03:00 UTC ya es "ayer" en Bogotá', () => {
      expect(partesLocales('2026-09-22T03:00:00.000Z', 'America/Bogota')).toEqual({
        fecha: '2026-09-21',
        hora: '22:00',
      });
    });

    it('acepta un Date y rechaza basura', () => {
      expect(partesLocales(new Date('2026-09-22T15:00:00Z'), 'America/Bogota')?.hora).toBe('10:00');
      expect(partesLocales('no es fecha', 'America/Bogota')).toBeNull();
    });

    it('ida y vuelta: aUtc y partesLocales son inversas', () => {
      for (const [f, h] of [['2026-09-22', '00:00'], ['2026-12-31', '23:59'], ['2026-01-01', '07:05']]) {
        const utc = aUtc(f, h, 'America/Bogota')!;
        expect(partesLocales(utc, 'America/Bogota')).toEqual({ fecha: f, hora: h });
      }
    });
  });
});
