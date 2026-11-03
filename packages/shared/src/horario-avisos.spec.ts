import {
  HORARIO_AVISOS_POR_DEFECTO,
  horaDelDiaATexto,
  horaDelDiaLegible,
  horarioAvisosDe,
  leerHoraDelDia,
  problemaDeHorarioAvisos,
  proximaVentanaDeAvisos,
  puedeAvisarAhora,
  textoHorarioAvisos,
  type HorarioAvisos,
} from './horario-avisos';

/**
 * Cuándo salen los avisos a los agendadores (docs/PLAN_AVISOS_AGENDADORES.md §8).
 * Fechas reales de 2026 en Bogotá (UTC-5): el lunes 2 de noviembre es festivo
 * (Todos los Santos trasladado) y el 8 es domingo.
 */
const bogota = (isoLocal: string) => new Date(`${isoLocal}:00-05:00`);
const LABORAL: HorarioAvisos = { aCualquierHora: false, desdeMin: 7 * 60, hastaMin: 17 * 60 };

describe('puedeAvisarAhora', () => {
  it('«a cualquier hora» (lo de siempre): también de madrugada, un domingo o un festivo', () => {
    for (const t of ['2026-11-03T03:00', '2026-11-08T10:00', '2026-11-02T22:00']) {
      expect(puedeAvisarAhora(bogota(t), HORARIO_AVISOS_POR_DEFECTO)).toBe(true);
    }
  });

  it.each([
    ['martes 6:59 a. m.', '2026-11-03T06:59', false],
    ['martes 7:00 a. m. (desde, incluido)', '2026-11-03T07:00', true],
    ['martes 4:59 p. m.', '2026-11-03T16:59', true],
    ['martes 5:00 p. m. (hasta, excluido)', '2026-11-03T17:00', false],
    ['martes 10:00 p. m.', '2026-11-03T22:00', false],
    ['sábado 10:00 a. m.', '2026-11-07T10:00', true],
    ['domingo 10:00 a. m.', '2026-11-08T10:00', false],
    ['lunes 2 de noviembre (festivo) 10:00 a. m.', '2026-11-02T10:00', false],
    ['lunes 16 de noviembre (festivo) 10:00 a. m.', '2026-11-16T10:00', false],
    ['lunes 9 de noviembre (hábil) 10:00 a. m.', '2026-11-09T10:00', true],
  ])('solo en horario laboral, %s → %s', (_n, t, esperado) => {
    expect(puedeAvisarAhora(bogota(t), LABORAL)).toBe(esperado);
  });

  it('con minutos: de 7:30 a 4:30', () => {
    const h = { aCualquierHora: false, desdeMin: 450, hastaMin: 990 };
    expect(puedeAvisarAhora(bogota('2026-11-03T07:29'), h)).toBe(false);
    expect(puedeAvisarAhora(bogota('2026-11-03T07:30'), h)).toBe(true);
    expect(puedeAvisarAhora(bogota('2026-11-03T16:29'), h)).toBe(true);
    expect(puedeAvisarAhora(bogota('2026-11-03T16:30'), h)).toBe(false);
  });

  it('la hora es la de la clínica, no la del servidor (UTC)', () => {
    // 12:30 UTC = 7:30 en Bogotá pero 6:30 en Ciudad de México.
    const t = new Date('2026-11-03T12:30:00Z');
    expect(puedeAvisarAhora(t, LABORAL, 'America/Bogota')).toBe(true);
    expect(puedeAvisarAhora(t, LABORAL, 'America/Mexico_City')).toBe(false);
  });
});

describe('proximaVentanaDeAvisos — para decir en la pantalla cuándo sale', () => {
  it('dentro del horario: ahora mismo', () => {
    const t = bogota('2026-11-03T10:00');
    expect(proximaVentanaDeAvisos(t, LABORAL)).toEqual(t);
  });

  it('de madrugada: hoy a la hora de inicio', () => {
    expect(proximaVentanaDeAvisos(bogota('2026-11-03T05:00'), LABORAL)).toEqual(bogota('2026-11-03T07:00'));
  });

  it('el sábado en la noche: el lunes, saltando el domingo', () => {
    expect(proximaVentanaDeAvisos(bogota('2026-11-07T18:00'), LABORAL)).toEqual(bogota('2026-11-09T07:00'));
  });

  it('el domingo antes del lunes festivo: el martes', () => {
    expect(proximaVentanaDeAvisos(bogota('2026-11-01T10:00'), LABORAL)).toEqual(bogota('2026-11-03T07:00'));
  });

  it('a cualquier hora: ahora', () => {
    const t = bogota('2026-11-08T03:00');
    expect(proximaVentanaDeAvisos(t, HORARIO_AVISOS_POR_DEFECTO)).toEqual(t);
  });
});

describe('horarioAvisosDe — lo guardado en la base', () => {
  it('sin nada guardado: a cualquier hora, con 7:00 a 17:00 propuesto', () => {
    expect(horarioAvisosDe(null)).toEqual({ aCualquierHora: true, desdeMin: 420, hastaMin: 1020 });
    expect(horarioAvisosDe({})).toEqual(HORARIO_AVISOS_POR_DEFECTO);
  });

  it('solo en horario laboral, con el horario de la clínica', () => {
    expect(horarioAvisosDe({ alertsOutsideHours: false, alertsHoursFromMin: 450, alertsHoursToMin: 990 })).toEqual({
      aCualquierHora: false,
      desdeMin: 450,
      hastaMin: 990,
    });
  });

  it.each([
    ['al revés', 1020, 420],
    ['de menos de una hora', 420, 450],
    ['fuera del día', -10, 1020],
    ['después de medianoche', 420, 1500],
    ['vacío', null, null],
  ])('un rango %s cae a 7:00-17:00 (nunca a «no avisar jamás»)', (_n, desde, hasta) => {
    expect(horarioAvisosDe({ alertsOutsideHours: false, alertsHoursFromMin: desde, alertsHoursToMin: hasta })).toEqual({
      aCualquierHora: false,
      desdeMin: 420,
      hastaMin: 1020,
    });
  });
});

describe('horas del día: leer, escribir y decir', () => {
  it.each([
    ['07:00', 420],
    ['7:05', 425],
    [' 17:30 ', 1050],
    ['00:00', 0],
    ['24:00', 1440],
    ['24:30', null],
    ['25:00', null],
    ['7:60', null],
    ['siete', null],
    [7, null],
  ])('leerHoraDelDia(%j) → %j', (texto, esperado) => {
    expect(leerHoraDelDia(texto)).toBe(esperado);
  });

  it('horaDelDiaATexto es lo que espera un campo de hora', () => {
    expect(horaDelDiaATexto(420)).toBe('07:00');
    expect(horaDelDiaATexto(1050)).toBe('17:30');
  });

  it.each([
    [420, '7:00 a. m.'],
    [1020, '5:00 p. m.'],
    [750, '12:30 p. m.'],
    [720, '12:00 m.'],
    [0, '12:00 a. m.'],
    [1440, '12:00 de la noche'],
  ])('horaDelDiaLegible(%d) → «%s»', (min, esperado) => {
    expect(horaDelDiaLegible(min)).toBe(esperado);
  });

  it('textoHorarioAvisos', () => {
    expect(textoHorarioAvisos(HORARIO_AVISOS_POR_DEFECTO)).toBe('a cualquier hora');
    expect(textoHorarioAvisos(LABORAL)).toBe('de lunes a sábado, de 7:00 a. m. a 5:00 p. m., sin domingos ni festivos');
  });

  it('problemaDeHorarioAvisos', () => {
    expect(problemaDeHorarioAvisos(420, 1020)).toBeNull();
    expect(problemaDeHorarioAvisos(null, 1020)).toMatch(/Escribe la hora/);
    expect(problemaDeHorarioAvisos(1020, 420)).toMatch(/después de la de inicio/);
    expect(problemaDeHorarioAvisos(420, 450)).toMatch(/al menos una hora/);
  });
});
