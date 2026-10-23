import {
  PLAZO_AGENDAR,
  dentroDelPlazoParaAgendar,
  finDelPlazoParaAgendar,
  normalizarPlazoAgendar,
  textoPlazoAgendar,
  ultimoDiaParaAgendar,
  validarPlazoAgendar,
} from './plazo-agendar';

// Viernes 23 de octubre de 2026, 10:00 a. m. en Bogotá (UTC-5).
const VIERNES_10AM = new Date('2026-10-23T15:00:00Z');
const bogota = (iso: string) => new Date(`${iso}-05:00`);

describe('plazo máximo para agendar por el asistente', () => {
  describe('con 3 días: hoy, mañana y pasado mañana', () => {
    it('el último día es el domingo 25', () => {
      expect(ultimoDiaParaAgendar('2026-10-23', 3)).toBe('2026-10-25');
    });

    it('queda fuera desde la medianoche del lunes 26 en Bogotá', () => {
      expect(finDelPlazoParaAgendar(VIERNES_10AM, 3)).toEqual(
        bogota('2026-10-26T00:00:00'),
      );
    });

    it.each([
      ['2026-10-23T16:00:00', true], // hoy
      ['2026-10-25T23:59:00', true], // el último minuto del domingo
      ['2026-10-26T00:00:00', false], // el lunes, ya no
      ['2026-10-26T07:00:00', false],
      ['2026-11-15T08:00:00', false],
    ])('cita %s → %s', (inicio, esperado) => {
      expect(dentroDelPlazoParaAgendar(bogota(inicio), VIERNES_10AM, 3)).toBe(
        esperado,
      );
    });
  });

  it('cuenta el día de la clínica, no el del contenedor (UTC)', () => {
    // Jueves 22 a las 9 p. m. en Bogotá = viernes 23 a las 2 a. m. en UTC.
    const juevesNoche = new Date('2026-10-23T02:00:00Z');
    // Con 1 día, solo el jueves: el viernes ya no.
    expect(
      dentroDelPlazoParaAgendar(bogota('2026-10-22T21:30:00'), juevesNoche, 1),
    ).toBe(true);
    expect(
      dentroDelPlazoParaAgendar(bogota('2026-10-23T07:00:00'), juevesNoche, 1),
    ).toBe(false);
  });

  it('con 1 día, solo hoy', () => {
    expect(ultimoDiaParaAgendar('2026-10-23', 1)).toBe('2026-10-23');
  });

  it('pasa de mes y de año', () => {
    expect(ultimoDiaParaAgendar('2026-10-30', 3)).toBe('2026-11-01');
    expect(ultimoDiaParaAgendar('2026-12-31', 2)).toBe('2027-01-01');
  });

  it('sin límite (null) no recorta nada: lo de siempre', () => {
    expect(ultimoDiaParaAgendar('2026-10-23', null)).toBeNull();
    expect(finDelPlazoParaAgendar(VIERNES_10AM, null)).toBeNull();
    expect(
      dentroDelPlazoParaAgendar(bogota('2027-06-01T08:00:00'), VIERNES_10AM, null),
    ).toBe(true);
  });

  describe('normalizarPlazoAgendar (lo que viene de la BD)', () => {
    it.each([
      [null, null],
      [undefined, null],
      ['', null],
      [0, null], // un dato raro nunca deja al asistente sin citas
      [-3, null],
      [Number.NaN, null],
      ['abc', null],
      [3, 3],
      ['7', 7],
      [2.6, 3],
      [10_000, PLAZO_AGENDAR.MAX],
    ])('%p → %p', (valor, esperado) => {
      expect(normalizarPlazoAgendar(valor)).toBe(esperado);
    });
  });

  describe('validarPlazoAgendar (lo que llega del panel)', () => {
    it('null es «sin límite» y un entero en rango vale', () => {
      expect(validarPlazoAgendar(null)).toEqual({ ok: true, dias: null });
      expect(validarPlazoAgendar(3)).toEqual({ ok: true, dias: 3 });
      expect(validarPlazoAgendar(365)).toEqual({ ok: true, dias: 365 });
    });

    it.each([0, -1, 366, 2.5, Number.NaN, '3', undefined, {}])(
      '%p es un error, no «sin límite»',
      (valor) => {
        expect(validarPlazoAgendar(valor)).toEqual({
          ok: false,
          error: expect.stringContaining('entre 1 y 365'),
        });
      },
    );
  });

  it('las opciones del panel están dentro del rango y en orden', () => {
    const opciones = [...PLAZO_AGENDAR.OPCIONES];
    expect(opciones).toEqual([...opciones].sort((a, b) => a - b));
    expect(opciones.every((d) => validarPlazoAgendar(d).ok)).toBe(true);
  });

  it('textoPlazoAgendar', () => {
    expect(textoPlazoAgendar(null)).toBe('Sin límite');
    expect(textoPlazoAgendar(1)).toBe('1 día (solo hoy)');
    expect(textoPlazoAgendar(2)).toBe('2 días (hoy y mañana)');
    expect(textoPlazoAgendar(3)).toBe('3 días (hoy, mañana y pasado mañana)');
    expect(textoPlazoAgendar(15)).toBe('15 días');
  });
});
