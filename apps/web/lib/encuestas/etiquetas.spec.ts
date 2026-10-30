import { decimal, etiquetaTramo, hoyLocal, porcentaje, rangoDePeriodo } from './etiquetas';

describe('periodos de la encuesta (hora de Bogotá)', () => {
  // 30-oct-2026 10:00 a. m. en Bogotá.
  const MANANA = new Date('2026-10-30T15:00:00Z');
  // 31-oct 03:00 UTC = 30-oct 10:00 p. m. en Bogotá: en UTC ya es otro día.
  const NOCHE = new Date('2026-10-31T03:00:00Z');

  it('🕔 «hoy» es el día de Bogotá, no el de UTC', () => {
    expect(hoyLocal(NOCHE)).toBe('2026-10-30');
  });

  it.each([
    ['7d', { startDate: '2026-10-24', endDate: '2026-10-30' }],
    ['30d', { startDate: '2026-10-01', endDate: '2026-10-30' }],
    ['90d', { startDate: '2026-08-02', endDate: '2026-10-30' }],
    ['mes', { startDate: '2026-10-01', endDate: '2026-10-30' }],
    ['mes-anterior', { startDate: '2026-09-01', endDate: '2026-09-30' }],
    ['anio', { startDate: '2026-01-01', endDate: '2026-10-30' }],
    ['todo', {}],
    ['personalizado', {}],
  ] as const)('%s', (periodo, esperado) => {
    expect(rangoDePeriodo(periodo, MANANA)).toEqual(esperado);
    // A las 10 p. m. sigue siendo el mismo día.
    expect(rangoDePeriodo(periodo, NOCHE)).toEqual(esperado);
  });

  it('el mes anterior a enero es diciembre del año pasado', () => {
    expect(rangoDePeriodo('mes-anterior', new Date('2027-01-15T15:00:00Z'))).toEqual({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });
  });

  it('febrero bisiesto termina el 29', () => {
    expect(rangoDePeriodo('mes-anterior', new Date('2028-03-10T15:00:00Z'))).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
  });
});

describe('formatos', () => {
  it.each([
    [0.8734, '87 %'],
    [1, '100 %'],
    [0, '0 %'],
    [null, '—'],
  ])('porcentaje(%p) = %s', (v, esperado) => {
    expect(porcentaje(v)).toBe(esperado);
  });

  it('decimal con coma', () => {
    expect(decimal(4.567)).toBe('4,6');
    expect(decimal(null)).toBe('—');
  });

  it.each([
    ['2026-10-30', 'day', '30 oct'],
    ['2026-10', 'month', 'oct 2026'],
    ['2026-10-30T00', 'hour', '12 a. m.'],
    ['2026-10-30T09', 'hour', '9 a. m.'],
    ['2026-10-30T12', 'hour', '12 p. m.'],
    ['2026-10-30T15', 'hour', '3 p. m.'],
  ] as const)('etiquetaTramo(%s, %s) = %s', (bucket, g, esperado) => {
    expect(etiquetaTramo(bucket, g)).toBe(esperado);
  });
});
