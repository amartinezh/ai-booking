import {
  formatSpokenDayLabel,
  formatSpokenTime,
  formatAppointmentSpoken,
} from './date-format';

/**
 * `now` de referencia: jueves 4 de junio de 2026, 15:00 UTC = 10:00 en Bogotá.
 * (Mismo ancla que parse-fecha-preferida.spec.) Bogotá es UTC−5 sin DST.
 */
const NOW = new Date('2026-06-04T15:00:00.000Z');
const opts = { now: NOW };

describe('formatSpokenDayLabel', () => {
  it('mismo día → "hoy"', () => {
    // Jun 4 15:00 Bogotá.
    expect(formatSpokenDayLabel('2026-06-04T20:00:00.000Z', opts)).toBe('hoy');
  });
  it('día siguiente → "mañana"', () => {
    // Jun 5 09:00 Bogotá.
    expect(formatSpokenDayLabel('2026-06-05T14:00:00.000Z', opts)).toBe(
      'mañana',
    );
  });
  it('a dos días → "pasado mañana"', () => {
    // Jun 6 12:00 Bogotá.
    expect(formatSpokenDayLabel('2026-06-06T17:00:00.000Z', opts)).toBe(
      'pasado mañana',
    );
  });
  it('más lejano → "el <weekday> <día> de <mes>" sin coma', () => {
    // Jun 8 2026 = lunes.
    expect(formatSpokenDayLabel('2026-06-08T13:30:00.000Z', opts)).toBe(
      'el lunes 8 de junio',
    );
  });
});

describe('formatSpokenTime', () => {
  it.each([
    ['2026-06-04T20:00:00.000Z', '3 de la tarde'],
    ['2026-06-04T14:00:00.000Z', '9 de la mañana'],
    ['2026-06-04T17:00:00.000Z', 'mediodía'],
    ['2026-06-04T13:30:00.000Z', '8 y media de la mañana'],
    ['2026-06-04T18:00:00.000Z', '1 de la tarde'],
    ['2026-06-04T23:15:00.000Z', '6 y cuarto de la tarde'],
    ['2026-06-05T00:00:00.000Z', '7 de la noche'],
  ])('%s → "%s"', (iso, expected) => {
    expect(formatSpokenTime(iso)).toBe(expected);
  });
});

describe('formatAppointmentSpoken (concordancia)', () => {
  it('"hoy a las 3 de la tarde"', () => {
    expect(formatAppointmentSpoken('2026-06-04T20:00:00.000Z', opts)).toBe(
      'hoy a las 3 de la tarde',
    );
  });
  it('"hoy a la 1 de la tarde" (singular)', () => {
    expect(formatAppointmentSpoken('2026-06-04T18:00:00.000Z', opts)).toBe(
      'hoy a la 1 de la tarde',
    );
  });
  it('"pasado mañana al mediodía"', () => {
    expect(formatAppointmentSpoken('2026-06-06T17:00:00.000Z', opts)).toBe(
      'pasado mañana al mediodía',
    );
  });
  it('"mañana a las 9 de la mañana"', () => {
    expect(formatAppointmentSpoken('2026-06-05T14:00:00.000Z', opts)).toBe(
      'mañana a las 9 de la mañana',
    );
  });
});
