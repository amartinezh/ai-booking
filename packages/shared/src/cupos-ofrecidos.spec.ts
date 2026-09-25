import {
  CUPOS_OFRECIDOS,
  normalizarCuposOfrecidos,
  seleccionarCuposManianaTarde,
} from './cupos-ofrecidos';

/** Cupo a esa hora de Bogotá (UTC-5) del 30 de septiembre de 2026. */
const cupo = (hhmm: string, dia = 30) => {
  const [h, m] = hhmm.split(':').map(Number);
  return {
    id: `${dia}-${hhmm}`,
    fecha: new Date(Date.UTC(2026, 8, dia, h + 5, m)),
  };
};
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('seleccionarCuposManianaTarde', () => {
  // 🐛 El caso de la retroalimentación: agenda llena, los 10 más próximos
  // caían todos en la mañana y la tarde no aparecía.
  it('con muchos cupos ofrece 3 de mañana y 3 de tarde', () => {
    const cupos = [
      ...[
        '07:00',
        '07:15',
        '07:30',
        '07:45',
        '08:00',
        '08:15',
        '08:30',
        '08:45',
      ].map((h) => cupo(h)),
      ...['14:00', '14:15', '14:30', '14:45', '15:00'].map((h) => cupo(h)),
    ];
    expect(ids(seleccionarCuposManianaTarde(cupos, 6))).toEqual([
      '30-07:00',
      '30-07:15',
      '30-07:30',
      '30-14:00',
      '30-14:15',
      '30-14:30',
    ]);
  });

  it('las 12 en punto ya son tarde, las 11:59 todavía mañana', () => {
    const r = seleccionarCuposManianaTarde(
      [cupo('11:59'), cupo('12:00'), cupo('09:00'), cupo('13:00')],
      2,
    );
    expect(ids(r)).toEqual(['30-09:00', '30-12:00']);
  });

  it('si la tarde no alcanza, la mañana completa (y al revés)', () => {
    const soloUnaTarde = [
      ...['07:00', '07:15', '07:30', '07:45', '08:00', '08:15'].map((h) =>
        cupo(h),
      ),
      cupo('16:00'),
    ];
    expect(ids(seleccionarCuposManianaTarde(soloUnaTarde, 6))).toEqual([
      '30-07:00',
      '30-07:15',
      '30-07:30',
      '30-07:45',
      '30-08:00',
      '30-16:00',
    ]);

    const soloUnaManiana = [
      cupo('10:00'),
      ...['14:00', '14:15', '14:30', '14:45', '15:00', '15:15'].map((h) =>
        cupo(h),
      ),
    ];
    expect(ids(seleccionarCuposManianaTarde(soloUnaManiana, 6))).toEqual([
      '30-10:00',
      '30-14:00',
      '30-14:15',
      '30-14:30',
      '30-14:45',
      '30-15:00',
    ]);
  });

  it('con menos cupos que el total los devuelve todos, en orden', () => {
    const r = seleccionarCuposManianaTarde([cupo('15:00'), cupo('08:00')], 6);
    expect(ids(r)).toEqual(['30-08:00', '30-15:00']);
  });

  it('devuelve en orden cronológico aunque la tarde de hoy vaya antes que la mañana de mañana', () => {
    const cupos = [
      cupo('14:00', 30),
      cupo('15:00', 30),
      cupo('08:00', 31),
      cupo('09:00', 31),
    ];
    expect(ids(seleccionarCuposManianaTarde(cupos, 2))).toEqual([
      '30-14:00',
      '31-08:00',
    ]);
  });

  it('con un total impar la mañana se lleva el extra', () => {
    const cupos = ['07:00', '08:00', '09:00', '14:00', '15:00', '16:00'].map(
      (h) => cupo(h),
    );
    expect(ids(seleccionarCuposManianaTarde(cupos, 5))).toEqual([
      '30-07:00',
      '30-08:00',
      '30-09:00',
      '30-14:00',
      '30-15:00',
    ]);
  });

  // ⚠️ En UTC las 8 a. m. de Bogotá son las 13 h: sin zona se irían a la tarde.
  it('no usa el reloj del contenedor: la franja se decide en America/Bogota', () => {
    const cupos = ['08:00', '08:15', '08:30', '14:00'].map((h) => cupo(h));
    expect(ids(seleccionarCuposManianaTarde(cupos, 2))).toEqual([
      '30-08:00',
      '30-14:00',
    ]);
  });
});

describe('normalizarCuposOfrecidos', () => {
  it.each([
    [null, CUPOS_OFRECIDOS.DEFAULT],
    [undefined, CUPOS_OFRECIDOS.DEFAULT],
    [0, CUPOS_OFRECIDOS.DEFAULT],
    ['abc', CUPOS_OFRECIDOS.DEFAULT],
    [1, CUPOS_OFRECIDOS.MIN],
    [8, 8],
    ['4', 4],
    [99, CUPOS_OFRECIDOS.MAX],
  ])('%p → %p', (entrada, esperado) => {
    expect(normalizarCuposOfrecidos(entrada)).toBe(esperado);
  });
});
