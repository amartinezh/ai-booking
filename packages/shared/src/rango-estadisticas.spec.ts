import { resolverRangoEstadisticas, horaLocalAUtc } from './rango-estadisticas';

// 30-sep-2026 20:30 en Bogotá = 1-oct-2026 01:30 UTC. Es la hora exacta en la
// que el cálculo en UTC ya daba «mañana» como «hoy».
const NOCHE_BOGOTA = new Date('2026-10-01T01:30:00.000Z');

describe('resolverRangoEstadisticas — hora de Bogotá, no UTC', () => {
  it('🕗 a las 8:30 p. m. de Bogotá «hoy» sigue siendo el 30 de septiembre', () => {
    const r = resolverRangoEstadisticas({ range: 'TODAY', now: NOCHE_BOGOTA });
    expect(r.gte.toISOString()).toBe('2026-09-30T05:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(r.granularidad).toBe('hour');
    expect(r.buckets).toHaveLength(24);
    expect(r.buckets[0]).toBe('2026-09-30T00');
    expect(r.buckets[23]).toBe('2026-09-30T23');
  });

  it('la semana va de lunes a domingo locales', () => {
    // 30-sep-2026 es miércoles.
    const r = resolverRangoEstadisticas({ range: 'WEEK', now: NOCHE_BOGOTA });
    expect(r.buckets).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(r.gte.toISOString()).toBe('2026-09-28T05:00:00.000Z');
  });

  it('un domingo pertenece a la semana que empezó el lunes anterior', () => {
    const domingo = new Date('2026-10-04T15:00:00.000Z');
    const r = resolverRangoEstadisticas({ range: 'WEEK', now: domingo });
    expect(r.buckets[0]).toBe('2026-09-28');
  });

  it('el mes es el de Bogotá: a las 8:30 p. m. del 30-sep sigue siendo septiembre', () => {
    const r = resolverRangoEstadisticas({ range: 'MONTH', now: NOCHE_BOGOTA });
    expect(r.buckets).toHaveLength(30);
    expect(r.buckets[0]).toBe('2026-09-01');
    expect(r.lt.toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });

  it('el año se grafica por mes, con los 12 tramos', () => {
    const r = resolverRangoEstadisticas({ range: 'YEAR', now: NOCHE_BOGOTA });
    expect(r.granularidad).toBe('month');
    expect(r.buckets).toHaveLength(12);
    expect(r.gte.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('el 31 de diciembre en la noche no salta al año siguiente', () => {
    const r = resolverRangoEstadisticas({
      range: 'YEAR',
      now: new Date('2027-01-01T03:00:00.000Z'), // 31-dic-2026 22:00 Bogotá
    });
    expect(r.buckets[0]).toBe('2026-01');
  });

  it('personalizado: fechas incluidas, por día', () => {
    const r = resolverRangoEstadisticas({
      range: 'CUSTOM',
      startDate: '2026-09-01',
      endDate: '2026-09-15',
    });
    expect(r.granularidad).toBe('day');
    expect(r.buckets).toHaveLength(15);
    expect(r.lt.toISOString()).toBe('2026-09-16T05:00:00.000Z');
  });

  it('personalizado de un solo día se grafica por hora', () => {
    const r = resolverRangoEstadisticas({
      range: 'CUSTOM',
      startDate: '2026-09-10',
      endDate: '2026-09-10',
    });
    expect(r.granularidad).toBe('hour');
  });

  it('personalizado largo se grafica por mes e incluye el mes en que termina', () => {
    const r = resolverRangoEstadisticas({
      range: 'CUSTOM',
      startDate: '2026-01-15',
      endDate: '2026-06-10',
    });
    expect(r.granularidad).toBe('month');
    expect(r.buckets).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it.each([
    ['fechas invertidas', '2026-09-10', '2026-09-01'],
    ['fecha inválida', '2026-02-31', '2026-03-01'],
    ['sin fechas', undefined, undefined],
  ])('personalizado con %s cae al mes en curso', (_c, startDate, endDate) => {
    const r = resolverRangoEstadisticas({
      range: 'CUSTOM',
      startDate,
      endDate,
      now: NOCHE_BOGOTA,
    });
    expect(r.buckets[0]).toBe('2026-09-01');
  });

  it('respeta otra zona (multi-tenant)', () => {
    const r = resolverRangoEstadisticas({
      range: 'TODAY',
      now: NOCHE_BOGOTA,
      timeZone: 'Europe/Madrid',
    });
    // En Madrid ya es 1-oct 03:30 (UTC+2 en verano).
    expect(r.buckets[0]).toBe('2026-10-01T00');
    expect(r.gte.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });
});

describe('horaLocalAUtc', () => {
  it('medianoche de Bogotá = 05:00 UTC', () => {
    expect(horaLocalAUtc(2026, 9, 30, 0).toISOString()).toBe(
      '2026-09-30T05:00:00.000Z',
    );
  });

  it('acierta a ambos lados de un cambio de horario de verano', () => {
    expect(horaLocalAUtc(2026, 3, 28, 0, 'Europe/Madrid').toISOString()).toBe(
      '2026-03-27T23:00:00.000Z',
    );
    expect(horaLocalAUtc(2026, 3, 30, 0, 'Europe/Madrid').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    );
  });
});
