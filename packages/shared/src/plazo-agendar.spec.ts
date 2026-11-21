import {
  PLAZO_AGENDAR,
  dentroDelPlazoParaAgendar,
  diaCuentaParaElPlazo,
  finDelPlazoParaAgendar,
  normalizarPlazoAgendar,
  porQueNoCuentaParaElPlazo,
  primerDiaParaVerElCupo,
  resumenCuposDelPlazo,
  textoPlazoAgendar,
  ultimoDiaParaAgendar,
  validarPlazoAgendar,
} from './plazo-agendar';
import { sumarDiasAFecha } from './bloqueos-agenda';

// Viernes 23 de octubre de 2026, 10:00 a. m. en Bogotá (UTC-5).
const VIERNES_10AM = new Date('2026-10-23T15:00:00Z');
const bogota = (iso: string) => new Date(`${iso}-05:00`);

describe('plazo máximo para agendar por el asistente', () => {
  describe('con 3 días un viernes: viernes, sábado y lunes (el domingo no cuenta)', () => {
    it('el último día es el lunes 26', () => {
      expect(ultimoDiaParaAgendar('2026-10-23', 3)).toBe('2026-10-26');
    });

    it('queda fuera desde la medianoche del martes 27 en Bogotá', () => {
      expect(finDelPlazoParaAgendar(VIERNES_10AM, 3)).toEqual(
        bogota('2026-10-27T00:00:00'),
      );
    });

    it.each([
      ['2026-10-23T16:00:00', true], // hoy
      ['2026-10-25T10:00:00', true], // el domingo queda en medio
      ['2026-10-26T23:59:00', true], // el último minuto del lunes
      ['2026-10-27T00:00:00', false], // el martes, ya no
      ['2026-10-27T07:00:00', false],
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

  it('con 1 día, solo hoy; un domingo, el lunes', () => {
    expect(ultimoDiaParaAgendar('2026-10-23', 1)).toBe('2026-10-23');
    expect(ultimoDiaParaAgendar('2026-10-25', 1)).toBe('2026-10-26');
  });

  // 🗓️ 2026-10-31: los domingos y los festivos no cuentan. El jueves 29 y el
  // viernes 30 de octubre (lunes 2 de noviembre festivo) el plazo de 4 días
  // llegaba al domingo o al lunes y el chat no ofrecía el martes, ya abierto.
  describe('con 4 días, sin contar domingos ni festivos', () => {
    it.each([
      ['2026-10-26', '2026-10-29'], // lunes → jueves
      ['2026-10-23', '2026-10-27'], // viernes de una semana normal → martes
      ['2026-10-24', '2026-10-28'], // sábado → miércoles
      ['2026-10-25', '2026-10-29'], // domingo (no cuenta) → jueves
      ['2026-10-29', '2026-11-03'], // jueves 29, lunes 2 festivo → martes 3
      ['2026-10-30', '2026-11-04'], // viernes 30 → miércoles 4
      ['2026-10-31', '2026-11-05'], // sábado 31 → jueves 5
      ['2026-11-02', '2026-11-06'], // hoy festivo (no cuenta) → viernes 6
    ])('hoy %s → hasta el %s', (hoy, ultimo) => {
      expect(ultimoDiaParaAgendar(hoy, 4)).toBe(ultimo);
    });

    it('el viernes 30 de octubre el chat ya ofrece el martes 3 de noviembre', () => {
      const viernes30 = bogota('2026-10-30T09:00:00');
      expect(
        dentroDelPlazoParaAgendar(bogota('2026-11-03T15:30:00'), viernes30, 4),
      ).toBe(true);
    });

    it('Semana Santa: el jueves y el viernes santos no cuentan', () => {
      // Miércoles 1 de abril de 2026: mié, (jue y vie santos), sáb, (dom), lun, mar.
      expect(ultimoDiaParaAgendar('2026-04-01', 4)).toBe('2026-04-07');
    });
  });

  it('por qué un día no cuenta', () => {
    expect(porQueNoCuentaParaElPlazo('2026-11-01')).toBe('DOMINGO');
    expect(porQueNoCuentaParaElPlazo('2026-11-02')).toBe('FESTIVO');
    expect(porQueNoCuentaParaElPlazo('2026-11-03')).toBeNull();
    // El sábado cuenta, aunque el hospital no dé citas por el asistente ese día.
    expect(diaCuentaParaElPlazo('2026-10-31')).toBe(true);
  });

  it('pasa de mes y de año', () => {
    // Viernes 30, sábado 31, (domingo 1, lunes 2 festivo), martes 3.
    expect(ultimoDiaParaAgendar('2026-10-30', 3)).toBe('2026-11-03');
    // Jueves 31 de diciembre, (1 de enero festivo), sábado 2.
    expect(ultimoDiaParaAgendar('2026-12-31', 2)).toBe('2027-01-02');
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
    expect(textoPlazoAgendar(1)).toBe('1 día');
    expect(textoPlazoAgendar(2)).toBe('2 días');
    expect(textoPlazoAgendar(15)).toBe('15 días');
  });
});

describe('lo que el plazo le deja ofrecer hoy al asistente', () => {
  // Viernes 23 de octubre, 3:27 p. m. en Bogotá: cuando se puso el plazo en 2 días.
  const VIERNES_TARDE = new Date('2026-10-23T20:27:00Z');
  const SABADOS = {
    date: '2026-10-24',
    repeatWeekly: true,
    startMinute: null,
    endMinute: null,
  };
  // Un cupo del sábado (bloqueado) y los del lunes y el martes.
  const CUPOS = [
    bogota('2026-10-24T08:00:00'),
    bogota('2026-10-26T08:20:00'),
    bogota('2026-10-26T12:00:00'),
    bogota('2026-10-27T07:00:00'),
  ];

  it('con 2 días un viernes: ningún cupo hoy; el del lunes se ve desde el sábado, y harían falta 3 días', () => {
    expect(
      resumenCuposDelPlazo({
        inicios: CUPOS,
        ahora: VIERNES_TARDE,
        dias: 2,
        reglas: [SABADOS],
      }),
    ).toEqual({
      enElPlazo: 0,
      total: 3, // el del sábado no cuenta: está bloqueado
      primerDia: '2026-10-26',
      ultimoDia: '2026-10-24',
      desde: '2026-10-24',
      plazoMinimo: 3, // viernes, sábado y lunes: el domingo no cuenta
    });
  });

  it('con 3 días: los del lunes sí; con 4, también el del martes', () => {
    const tres = resumenCuposDelPlazo({
      inicios: CUPOS,
      ahora: VIERNES_TARDE,
      dias: 3,
      reglas: [SABADOS],
    });
    expect(tres.enElPlazo).toBe(2);
    expect(tres.desde).toBeNull();
    expect(
      resumenCuposDelPlazo({
        inicios: CUPOS,
        ahora: VIERNES_TARDE,
        dias: 4,
        reglas: [SABADOS],
      }).enElPlazo,
    ).toBe(3);
  });

  it('sin límite: todos, y nada de «desde»', () => {
    const r = resumenCuposDelPlazo({
      inicios: CUPOS,
      ahora: VIERNES_TARDE,
      dias: null,
      reglas: [SABADOS],
    });
    expect(r).toMatchObject({ enElPlazo: 3, total: 3, ultimoDia: null, desde: null });
  });

  it('no cuenta lo que empieza antes de la anticipación mínima (60 min)', () => {
    const r = resumenCuposDelPlazo({
      inicios: [new Date(VIERNES_TARDE.getTime() + 30 * 60_000)],
      ahora: VIERNES_TARDE,
      dias: 2,
      reglas: [],
    });
    expect(r).toMatchObject({ enElPlazo: 0, total: 0, primerDia: null, desde: null, plazoMinimo: null });
  });

  it('primerDiaParaVerElCupo: sin contar domingos ni festivos', () => {
    // Con 2 días, el lunes se ve desde el sábado (y desde el domingo).
    expect(primerDiaParaVerElCupo('2026-10-26', 2)).toBe('2026-10-24');
    // Con 1, desde el domingo anterior: ese día no cuenta, el lunes sí.
    expect(primerDiaParaVerElCupo('2026-10-26', 1)).toBe('2026-10-25');
    expect(primerDiaParaVerElCupo('2026-10-27', 1)).toBe('2026-10-27');
    // El martes 3 de noviembre (lunes 2 festivo), con 4 días: desde el jueves 29.
    expect(primerDiaParaVerElCupo('2026-11-03', 4)).toBe('2026-10-29');
    // Un cupo de domingo se ve como uno del siguiente día que cuenta.
    expect(primerDiaParaVerElCupo('2026-11-01', 3)).toBe('2026-10-30');
  });

  it('primerDiaParaVerElCupo y ultimoDiaParaAgendar dicen lo mismo', () => {
    // Para cada día y cada plazo: desde el día que dice, el cupo ya se ve; el día
    // anterior, todavía no.
    for (let i = 0; i < 120; i++) {
      const cupo = sumarDiasAFecha('2026-10-01', i);
      for (let dias = 1; dias <= 7; dias++) {
        const desde = primerDiaParaVerElCupo(cupo, dias);
        expect(desde <= cupo).toBe(true);
        expect(ultimoDiaParaAgendar(desde, dias)! >= cupo).toBe(true);
        expect(
          ultimoDiaParaAgendar(sumarDiasAFecha(desde, -1), dias)! < cupo,
        ).toBe(true);
      }
    }
  });
});

describe('con «Sábados por el asistente» encendida, el sábado no cuenta (2026-11-21)', () => {
  // La semana del diagnóstico: el hospital abre el sábado ese mismo sábado y es
  // para la zona rural, así que de miércoles a viernes el plazo perdía un día.
  const SIN_SABADO = { sabadoNoCuenta: true };

  it('jueves 19 con 4 días: hasta el martes 24 (antes, el lunes 23)', () => {
    expect(ultimoDiaParaAgendar('2026-11-19', 4, SIN_SABADO)).toBe('2026-11-24');
    expect(ultimoDiaParaAgendar('2026-11-19', 4)).toBe('2026-11-23');
  });

  it('miércoles y viernes también ganan el día; lunes y martes no cambian', () => {
    expect(ultimoDiaParaAgendar('2026-11-18', 4, SIN_SABADO)).toBe('2026-11-23');
    expect(ultimoDiaParaAgendar('2026-11-20', 4, SIN_SABADO)).toBe('2026-11-25');
    expect(ultimoDiaParaAgendar('2026-11-23', 4, SIN_SABADO)).toBe('2026-11-26');
    expect(ultimoDiaParaAgendar('2026-11-23', 4)).toBe('2026-11-26');
    expect(ultimoDiaParaAgendar('2026-11-24', 4, SIN_SABADO)).toBe('2026-11-27');
    expect(ultimoDiaParaAgendar('2026-11-24', 4)).toBe('2026-11-27');
  });

  it('un sábado o un domingo, el plazo empieza a contar el lunes', () => {
    expect(ultimoDiaParaAgendar('2026-11-21', 4, SIN_SABADO)).toBe('2026-11-26');
    expect(ultimoDiaParaAgendar('2026-11-22', 4, SIN_SABADO)).toBe('2026-11-26');
    expect(ultimoDiaParaAgendar('2026-11-21', 4)).toBe('2026-11-25');
  });

  it('el sábado se sigue ofreciendo: queda dentro del plazo', () => {
    const jueves = bogota('2026-11-19T08:00:00');
    const fin = finDelPlazoParaAgendar(jueves, 4, undefined, SIN_SABADO)!;
    expect(fin.toISOString()).toBe(bogota('2026-11-25T00:00:00').toISOString());
    // Sábado 21 a las 7 y martes 24 a las 3 p. m.: sí; miércoles 25: no.
    for (const [inicio, dentro] of [
      ['2026-11-21T07:00:00', true],
      ['2026-11-24T15:00:00', true],
      ['2026-11-25T07:00:00', false],
    ] as const) {
      expect(
        dentroDelPlazoParaAgendar(bogota(inicio), jueves, 4, undefined, SIN_SABADO),
      ).toBe(dentro);
    }
    // Y hoy sábado, los cupos de hoy mismo.
    const sabado = bogota('2026-11-21T06:30:00');
    expect(
      dentroDelPlazoParaAgendar(bogota('2026-11-21T09:00:00'), sabado, 4, undefined, SIN_SABADO),
    ).toBe(true);
  });

  it('por qué no cuenta: el sábado; un sábado festivo sigue siendo festivo', () => {
    expect(porQueNoCuentaParaElPlazo('2026-11-21', SIN_SABADO)).toBe('SABADO');
    expect(porQueNoCuentaParaElPlazo('2026-11-21')).toBeNull();
    expect(diaCuentaParaElPlazo('2026-11-21', SIN_SABADO)).toBe(false);
    expect(diaCuentaParaElPlazo('2026-11-20', SIN_SABADO)).toBe(true);
    expect(porQueNoCuentaParaElPlazo('2026-11-22', SIN_SABADO)).toBe('DOMINGO');
    // El 8 de diciembre (festivo que no se corre al lunes) de 2029 cae sábado.
    expect(porQueNoCuentaParaElPlazo('2029-12-08', SIN_SABADO)).toBe('FESTIVO');
  });

  it('desde cuándo se ve un cupo: el del martes 24, desde el jueves 19; el del sábado, como el del lunes', () => {
    expect(primerDiaParaVerElCupo('2026-11-24', 4, SIN_SABADO)).toBe('2026-11-19');
    expect(primerDiaParaVerElCupo('2026-11-24', 4)).toBe('2026-11-20');
    expect(primerDiaParaVerElCupo('2026-11-21', 4, SIN_SABADO)).toBe(
      primerDiaParaVerElCupo('2026-11-23', 4, SIN_SABADO),
    );
  });

  it('primerDiaParaVerElCupo y ultimoDiaParaAgendar dicen lo mismo', () => {
    for (let i = 0; i < 120; i++) {
      const cupo = sumarDiasAFecha('2026-10-01', i);
      for (let dias = 1; dias <= 7; dias++) {
        const desde = primerDiaParaVerElCupo(cupo, dias, SIN_SABADO);
        expect(desde <= cupo).toBe(true);
        expect(ultimoDiaParaAgendar(desde, dias, SIN_SABADO)! >= cupo).toBe(true);
        expect(
          ultimoDiaParaAgendar(sumarDiasAFecha(desde, -1), dias, SIN_SABADO)! < cupo,
        ).toBe(true);
      }
    }
  });

  it('lo que le deja ofrecer hoy: jueves 19 con 4 días, los cupos del martes 24 ya se ven', () => {
    const jueves = bogota('2026-11-19T08:00:00');
    const cupos = [bogota('2026-11-24T07:00:00'), bogota('2026-11-24T15:00:00')];
    const base = { inicios: cupos, ahora: jueves, dias: 4, reglas: [] };
    expect(resumenCuposDelPlazo({ ...base, sabadoNoCuenta: true })).toEqual({
      enElPlazo: 2,
      total: 2,
      primerDia: '2026-11-24',
      ultimoDia: '2026-11-24',
      desde: null,
      plazoMinimo: 4, // jueves, viernes, lunes y martes
    });
    // Sin la opción, lo de antes: ninguno hoy, «escríbanos desde el viernes».
    expect(resumenCuposDelPlazo(base)).toEqual({
      enElPlazo: 0,
      total: 2,
      primerDia: '2026-11-24',
      ultimoDia: '2026-11-23',
      desde: '2026-11-20',
      plazoMinimo: 5,
    });
  });
});
