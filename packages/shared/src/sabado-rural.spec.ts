import {
  SABADO_RURAL,
  esDiaSabado,
  esSabado,
  normalizarSabadoRural,
  porcentajeDelDia,
  sabadoNoCuentaParaElPlazo,
  textoSabadoRural,
  tramosDeSabado,
  validarSabadoRural,
} from './sabado-rural';

const bogota = (iso: string) => new Date(`${iso}-05:00`);

describe('sábados solo para la zona rural', () => {
  describe('lo que viene de la base', () => {
    it('sin valor no hay regla especial', () => {
      expect(normalizarSabadoRural(null)).toBeNull();
      expect(normalizarSabadoRural(undefined)).toBeNull();
      expect(normalizarSabadoRural('')).toBeNull();
    });

    it('un dato raro deja el sábado como un día más', () => {
      for (const malo of [0, -1, 9, 101, NaN, 'cincuenta']) {
        expect(normalizarSabadoRural(malo)).toBeNull();
      }
    });

    it('10 a 100 se respeta (100 = solo zona rural, sin tope)', () => {
      expect(normalizarSabadoRural(50)).toBe(50);
      expect(normalizarSabadoRural('50')).toBe(50);
      expect(normalizarSabadoRural(SABADO_RURAL.MIN)).toBe(10);
      expect(normalizarSabadoRural(100)).toBe(100);
    });
  });

  describe('lo que llega del panel', () => {
    it('acepta «sin regla especial» y los enteros de 10 a 100', () => {
      expect(validarSabadoRural(null)).toEqual({ ok: true, porcentaje: null });
      expect(validarSabadoRural(50)).toEqual({ ok: true, porcentaje: 50 });
      expect(validarSabadoRural(100)).toEqual({ ok: true, porcentaje: 100 });
    });

    it('rechaza lo demás', () => {
      for (const malo of [9, 101, 0, 50.5, '50', undefined, NaN, {}]) {
        expect(validarSabadoRural(malo).ok).toBe(false);
      }
    });
  });

  describe('qué es sábado', () => {
    it('el sábado 21 de noviembre de 2026 lo es; el viernes 20 y el domingo 22 no', () => {
      expect(esDiaSabado('2026-11-21')).toBe(true);
      expect(esDiaSabado('2026-11-20')).toBe(false);
      expect(esDiaSabado('2026-11-22')).toBe(false);
      expect(esDiaSabado('no-es-fecha')).toBe(false);
    });

    it('cuenta la hora de la clínica: el sábado a las 11:30 p. m. en Bogotá ya es domingo en UTC y sigue siendo sábado', () => {
      expect(esSabado(bogota('2026-11-21T23:30:00'))).toBe(true);
      // El viernes a las 8 p. m. en Bogotá ya es sábado en UTC: no es sábado.
      expect(esSabado(bogota('2026-11-20T20:00:00'))).toBe(false);
    });
  });

  describe('los tramos de sábado', () => {
    it('de un martes a otro martes: el sábado completo, de medianoche a medianoche en Bogotá', () => {
      expect(
        tramosDeSabado(bogota('2026-11-17T10:00:00'), bogota('2026-11-24T10:00:00')),
      ).toEqual([
        { gte: bogota('2026-11-21T00:00:00'), lt: bogota('2026-11-22T00:00:00') },
      ]);
    });

    it('desde el mismo sábado por la mañana: el sábado entero (lo pasado ya lo quita la consulta)', () => {
      expect(
        tramosDeSabado(bogota('2026-11-21T09:00:00'), bogota('2026-11-23T00:00:00')),
      ).toEqual([
        { gte: bogota('2026-11-21T00:00:00'), lt: bogota('2026-11-22T00:00:00') },
      ]);
    });

    it('dos semanas: dos sábados', () => {
      expect(
        tramosDeSabado(bogota('2026-11-16T00:00:00'), bogota('2026-11-30T00:00:00')),
      ).toHaveLength(2);
    });

    it('sin sábado en la ventana, o una ventana al revés: ninguno', () => {
      expect(
        tramosDeSabado(bogota('2026-11-16T00:00:00'), bogota('2026-11-20T23:00:00')),
      ).toEqual([]);
      expect(
        tramosDeSabado(bogota('2026-11-24T00:00:00'), bogota('2026-11-16T00:00:00')),
      ).toEqual([]);
    });
  });

  describe('el tope de cada día', () => {
    it('con la regla encendida, el sábado lleva el suyo y los demás días el de la reserva', () => {
      const p = { porcentaje: 80, sabadoRural: 50 };
      expect(porcentajeDelDia('2026-11-21', p)).toBe(50);
      expect(porcentajeDelDia('2026-11-20', p)).toBe(80);
    });

    it('sin reserva entre semana, el sábado igual tiene su tope', () => {
      const p = { porcentaje: null, sabadoRural: 50 };
      expect(porcentajeDelDia('2026-11-21', p)).toBe(50);
      expect(porcentajeDelDia('2026-11-20', p)).toBeNull();
    });

    it('con 100 % el sábado no tiene tope, aunque entre semana haya reserva', () => {
      expect(porcentajeDelDia('2026-11-21', { porcentaje: 80, sabadoRural: 100 })).toBeNull();
    });

    it('con la regla apagada, el sábado es un día más', () => {
      expect(porcentajeDelDia('2026-11-21', { porcentaje: 80, sabadoRural: null })).toBe(80);
      expect(porcentajeDelDia('2026-11-21', { porcentaje: null, sabadoRural: null })).toBeNull();
    });
  });

  it('con la regla encendida, el sábado no cuenta para el plazo para agendar', () => {
    expect(sabadoNoCuentaParaElPlazo(50)).toBe(true);
    expect(sabadoNoCuentaParaElPlazo(100)).toBe(true);
    expect(sabadoNoCuentaParaElPlazo(null)).toBe(false);
    expect(sabadoNoCuentaParaElPlazo(undefined)).toBe(false);
    // Un dato raro deja el sábado como un día más, como en la regla misma.
    expect(sabadoNoCuentaParaElPlazo(5)).toBe(false);
    expect(sabadoNoCuentaParaElPlazo('abc')).toBe(false);
  });

  it('el texto para el panel', () => {
    expect(textoSabadoRural(null)).toBe('Sin regla especial');
    expect(textoSabadoRural(50)).toBe('Solo zona rural, hasta el 50 % de cada médico');
    expect(textoSabadoRural(100)).toBe('Solo zona rural, sin tope');
  });
});
