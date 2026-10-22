import {
  bloqueoAplicaElDia,
  bloqueoVigente,
  cupoBloqueado,
  describirBloqueoAgenda,
  diaDeLaSemana,
  fechaEnPalabras,
  horaEnPalabras,
  intervalosBloqueados,
  minutoLocal,
  mismaRegla,
  proximasFechasDelBloqueo,
  sumarDiasAFecha,
  validarBloqueoAgenda,
  type ReglaBloqueoAgenda,
} from './bloqueos-agenda';

// Sábado 24 y viernes 23 de octubre de 2026 (Bogotá, UTC-5).
const SABADOS: ReglaBloqueoAgenda = {
  date: '2026-10-24',
  repeatWeekly: true,
  startMinute: null,
  endMinute: null,
};
const VIERNES_8_A_10: ReglaBloqueoAgenda = {
  date: '2026-10-23',
  repeatWeekly: false,
  startMinute: 8 * 60,
  endMinute: 10 * 60,
};
/** Un instante a una hora de Bogotá. */
const bogota = (fecha: string, hhmm: string) =>
  new Date(`${fecha}T${hhmm}:00-05:00`);

describe('fechas de calendario', () => {
  it('día de la semana, sumar días (fin de mes y de año)', () => {
    expect(diaDeLaSemana('2026-10-24')).toBe(6); // sábado
    expect(diaDeLaSemana('2026-10-25')).toBe(0); // domingo
    expect(sumarDiasAFecha('2026-10-31', 1)).toBe('2026-11-01');
    expect(sumarDiasAFecha('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDiasAFecha('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('minuto del día en la zona de la clínica, no en UTC', () => {
    // 13:30 UTC = 8:30 en Bogotá.
    expect(minutoLocal(new Date('2026-10-23T13:30:00Z'))).toBe(8 * 60 + 30);
    expect(minutoLocal(new Date('2026-10-23T13:30:00Z'), 'UTC')).toBe(
      13 * 60 + 30,
    );
  });
});

describe('bloqueoAplicaElDia', () => {
  it('«todos los sábados» desde el 24: ese sábado y los siguientes, no los anteriores ni otros días', () => {
    expect(bloqueoAplicaElDia(SABADOS, '2026-10-24')).toBe(true);
    expect(bloqueoAplicaElDia(SABADOS, '2026-10-31')).toBe(true);
    expect(bloqueoAplicaElDia(SABADOS, '2027-03-06')).toBe(true);
    expect(bloqueoAplicaElDia(SABADOS, '2026-10-17')).toBe(false); // sábado anterior
    expect(bloqueoAplicaElDia(SABADOS, '2026-10-25')).toBe(false); // domingo
  });

  it('un solo día: solo ese día', () => {
    expect(bloqueoAplicaElDia(VIERNES_8_A_10, '2026-10-23')).toBe(true);
    expect(bloqueoAplicaElDia(VIERNES_8_A_10, '2026-10-30')).toBe(false);
  });
});

describe('cupoBloqueado — cuenta la hora de la CITA, en Bogotá', () => {
  it('cualquier cita de un sábado bloqueado, a cualquier hora', () => {
    expect(cupoBloqueado(bogota('2026-10-24', '07:00'), [SABADOS])).toBe(true);
    expect(cupoBloqueado(bogota('2026-10-31', '23:50'), [SABADOS])).toBe(true);
    expect(cupoBloqueado(bogota('2026-10-26', '07:00'), [SABADOS])).toBe(false);
  });

  it('de 8 a 10: la de las 8:00 y la de las 9:40 sí; la de las 7:50 y la de las 10:00 no', () => {
    const reglas = [VIERNES_8_A_10];
    expect(cupoBloqueado(bogota('2026-10-23', '08:00'), reglas)).toBe(true);
    expect(cupoBloqueado(bogota('2026-10-23', '09:40'), reglas)).toBe(true);
    expect(cupoBloqueado(bogota('2026-10-23', '07:50'), reglas)).toBe(false);
    expect(cupoBloqueado(bogota('2026-10-23', '10:00'), reglas)).toBe(false);
  });

  it('la medianoche de UTC no confunde el día: el viernes 23 a las 8 p. m. en Bogotá es sábado 24 en UTC', () => {
    // 2026-10-24T01:00Z = viernes 23 a las 20:00 en Bogotá → no es sábado.
    expect(cupoBloqueado(new Date('2026-10-24T01:00:00Z'), [SABADOS])).toBe(
      false,
    );
  });

  it('sin reglas, nada', () => {
    expect(cupoBloqueado(bogota('2026-10-24', '08:00'), [])).toBe(false);
  });
});

describe('intervalosBloqueados — los tramos para la consulta', () => {
  it('«todos los sábados» en dos semanas: dos tramos de día completo, en UTC', () => {
    const tramos = intervalosBloqueados(
      [SABADOS],
      bogota('2026-10-22', '10:00'),
      bogota('2026-11-04', '10:00'),
    );
    expect(tramos.map((t) => [t.gte.toISOString(), t.lt.toISOString()])).toEqual([
      ['2026-10-24T05:00:00.000Z', '2026-10-25T05:00:00.000Z'],
      ['2026-10-31T05:00:00.000Z', '2026-11-01T05:00:00.000Z'],
    ]);
  });

  it('un rango de horas: [8:00, 10:00) de Bogotá', () => {
    const [t] = intervalosBloqueados(
      [VIERNES_8_A_10],
      bogota('2026-10-22', '00:00'),
      bogota('2026-10-30', '00:00'),
    );
    expect(t.gte.toISOString()).toBe('2026-10-23T13:00:00.000Z');
    expect(t.lt.toISOString()).toBe('2026-10-23T15:00:00.000Z');
  });

  it('cada cupo dentro de un tramo está bloqueado y viceversa (las dos funciones dicen lo mismo)', () => {
    const reglas = [SABADOS, VIERNES_8_A_10];
    const tramos = intervalosBloqueados(
      reglas,
      bogota('2026-10-22', '00:00'),
      bogota('2026-11-08', '00:00'),
    );
    for (let i = 0; i < 17 * 24 * 6; i++) {
      const t = new Date(bogota('2026-10-22', '00:00').getTime() + i * 600_000);
      const enTramo = tramos.some((x) => t >= x.gte && t < x.lt);
      expect([t.toISOString(), enTramo]).toEqual([
        t.toISOString(),
        cupoBloqueado(t, reglas),
      ]);
    }
  });

  it('tiene tope de días', () => {
    const tramos = intervalosBloqueados(
      [{ ...SABADOS, date: '2026-10-22', repeatWeekly: false }],
      bogota('2026-10-22', '00:00'),
      bogota('2036-10-22', '00:00'),
      undefined,
      { maxDias: 10 },
    );
    expect(tramos).toHaveLength(1);
  });
});

describe('proximasFechasDelBloqueo y vigencia', () => {
  it('las próximas fechas de «todos los sábados», desde hoy', () => {
    expect(proximasFechasDelBloqueo(SABADOS, '2026-10-22')).toEqual([
      '2026-10-24',
      '2026-10-31',
      '2026-11-07',
    ]);
    // Ya empezó: desde el próximo sábado a hoy.
    expect(proximasFechasDelBloqueo(SABADOS, '2026-11-02', 2)).toEqual([
      '2026-11-07',
      '2026-11-14',
    ]);
  });

  it('un día que ya pasó deja de estar vigente; una repetición no', () => {
    expect(bloqueoVigente(VIERNES_8_A_10, '2026-10-24')).toBe(false);
    expect(bloqueoVigente(VIERNES_8_A_10, '2026-10-23')).toBe(true);
    expect(bloqueoVigente(SABADOS, '2030-01-01')).toBe(true);
  });
});

describe('validarBloqueoAgenda — lo que llega del panel', () => {
  const HOY = '2026-10-22';

  it('todo el día, repetido', () => {
    expect(
      validarBloqueoAgenda(
        { date: '2026-10-24', repeatWeekly: true, note: '  Sábados  ' },
        HOY,
      ),
    ).toEqual({
      ok: true,
      regla: {
        date: '2026-10-24',
        repeatWeekly: true,
        startMinute: null,
        endMinute: null,
        note: 'Sábados',
      },
    });
  });

  it('un rango de horas', () => {
    expect(
      validarBloqueoAgenda(
        { date: '2026-10-23', startMinute: 480, endMinute: 600 },
        HOY,
      ),
    ).toMatchObject({
      ok: true,
      regla: { repeatWeekly: false, startMinute: 480, endMinute: 600, note: null },
    });
  });

  it('hoy se puede', () => {
    expect(validarBloqueoAgenda({ date: HOY }, HOY).ok).toBe(true);
  });

  it.each([
    [{ date: '' }, 'Elija un día'],
    [{ date: '2026-02-30' }, 'Elija un día'],
    [{ date: '2026-10-21' }, 'ya pasó'],
    [{ date: '2029-01-01' }, 'próximos dos años'],
    [{ date: '2026-10-23', startMinute: 480 }, 'hora inicial y la hora final'],
    [{ date: '2026-10-23', startMinute: 600, endMinute: 480 }, 'después de la hora inicial'],
    [{ date: '2026-10-23', startMinute: 600, endMinute: 600 }, 'después de la hora inicial'],
    [{ date: '2026-10-23', startMinute: -5, endMinute: 480 }, 'hora inicial y la hora final'],
    [{ date: '2026-10-23', startMinute: 480, endMinute: 1440 }, 'hora inicial y la hora final'],
    [{ date: '2026-10-23', startMinute: '8', endMinute: 600 }, 'hora inicial y la hora final'],
    [{ date: '2026-10-23', note: 'x'.repeat(121) }, 'hasta 120'],
  ])('%o → «%s»', (entrada, error) => {
    const r = validarBloqueoAgenda(entrada as never, HOY);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(error);
  });

  it('«repetir» solo con true (falla hacia un solo día)', () => {
    const r = validarBloqueoAgenda({ date: HOY, repeatWeekly: 'sí' }, HOY);
    expect(r.ok && r.regla.repeatWeekly).toBe(false);
  });
});

describe('en palabras', () => {
  it('fechas y horas', () => {
    expect(fechaEnPalabras('2026-10-24')).toBe('sábado 24 de octubre de 2026');
    expect(fechaEnPalabras('2026-10-24', { conAnio: false })).toBe(
      'sábado 24 de octubre',
    );
    expect(horaEnPalabras(480)).toBe('8:00 a. m.');
    expect(horaEnPalabras(12 * 60)).toBe('12:00 p. m.');
    expect(horaEnPalabras(0)).toBe('12:00 a. m.');
    expect(horaEnPalabras(13 * 60 + 5)).toBe('1:05 p. m.');
  });

  it('las dos reglas del hospital', () => {
    expect(describirBloqueoAgenda(SABADOS)).toEqual({
      cuando: 'Todos los sábados',
      horario: 'Todo el día',
      desde: 'Desde el sábado 24 de octubre de 2026',
    });
    expect(describirBloqueoAgenda(VIERNES_8_A_10)).toEqual({
      cuando: 'Viernes 23 de octubre de 2026',
      horario: 'De 8:00 a. m. a 10:00 a. m.',
      desde: null,
    });
  });

  it('mismaRegla', () => {
    expect(mismaRegla(SABADOS, { ...SABADOS })).toBe(true);
    expect(mismaRegla(SABADOS, { ...SABADOS, repeatWeekly: false })).toBe(false);
    expect(mismaRegla(VIERNES_8_A_10, { ...VIERNES_8_A_10, endMinute: 590 })).toBe(
      false,
    );
  });
});
