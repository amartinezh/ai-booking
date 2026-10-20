import {
  HORARIO_EQUIPO_POR_DEFECTO,
  enHorarioDelEquipo,
  horarioEquipoDe,
  minutosHabilesEntre,
  proximaAperturaDelEquipo,
  textoCuandoLoVeElEquipo,
} from './soporte-horario';

// Bogotá es UTC−5 todo el año: las 8:00 de Colombia son las 13:00 UTC.
// 2026-10-19 es lunes; 2026-10-23 viernes; 2026-10-24 sábado.
const co = (iso: string) => new Date(`${iso}-05:00`);

describe('horarioEquipoDe', () => {
  it('sin configuración, lunes a viernes de 8 a 17 en Colombia (S14)', () => {
    expect(horarioEquipoDe()).toEqual(HORARIO_EQUIPO_POR_DEFECTO);
    expect(horarioEquipoDe(null)).toEqual({
      dias: [1, 2, 3, 4, 5],
      desdeHora: 8,
      hastaHora: 17,
      zona: 'America/Bogota',
    });
  });

  it('respeta un horario válido, ordena y quita días repetidos', () => {
    expect(
      horarioEquipoDe({
        teamDays: [6, 1, 1, 3],
        teamFromHour: 7,
        teamToHour: 24,
        teamTimeZone: 'America/Lima',
      }),
    ).toEqual({
      dias: [1, 3, 6],
      desdeHora: 7,
      hastaHora: 24,
      zona: 'America/Lima',
    });
  });

  it.each([
    [{ teamDays: [] }, 'sin días'],
    [{ teamDays: [0, 8, 2.5] }, 'días fuera de rango'],
  ])('vuelve a los días por defecto: %s (%s)', (config) => {
    expect(horarioEquipoDe(config).dias).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([
    [17, 8],
    [8, 8],
    [-1, 10],
    [8, 25],
    [8.5, 17],
    [null, 17],
  ])('horas sin sentido (%p → %p) vuelven a 8–17', (desde, hasta) => {
    const h = horarioEquipoDe({ teamFromHour: desde, teamToHour: hasta });
    expect([h.desdeHora, h.hastaHora]).toEqual([8, 17]);
  });

  it('una zona que no existe o vacía cae a Colombia', () => {
    expect(horarioEquipoDe({ teamTimeZone: 'Marte/Olympus' }).zona).toBe(
      'America/Bogota',
    );
    expect(horarioEquipoDe({ teamTimeZone: '  ' }).zona).toBe('America/Bogota');
  });
});

describe('enHorarioDelEquipo', () => {
  it.each([
    ['2026-10-19T08:00:00', true, 'lunes a las 8:00 en punto'],
    ['2026-10-19T16:59:59', true, 'lunes un segundo antes de las 17'],
    ['2026-10-19T17:00:00', false, 'lunes a las 17:00 ya cerró'],
    ['2026-10-19T07:59:59', false, 'lunes antes de abrir'],
    ['2026-10-23T12:00:00', true, 'viernes al mediodía'],
    ['2026-10-24T10:00:00', false, 'sábado'],
    ['2026-10-25T10:00:00', false, 'domingo'],
  ])('%s → %p (%s)', (iso, esperado) => {
    expect(enHorarioDelEquipo(co(iso))).toBe(esperado);
  });

  it('usa la hora de Colombia, no la del servidor (UTC)', () => {
    // 2026-10-20 02:00 UTC es lunes 19 a las 21:00 en Colombia: fuera de horario.
    expect(enHorarioDelEquipo(new Date('2026-10-20T02:00:00Z'))).toBe(false);
    // 2026-10-19 13:30 UTC es lunes 8:30 en Colombia: dentro.
    expect(enHorarioDelEquipo(new Date('2026-10-19T13:30:00Z'))).toBe(true);
  });

  it('una jornada hasta las 24 llega a la medianoche', () => {
    const h = horarioEquipoDe({
      teamDays: [1],
      teamFromHour: 20,
      teamToHour: 24,
    });
    expect(enHorarioDelEquipo(co('2026-10-19T23:59:00'), h)).toBe(true);
    expect(enHorarioDelEquipo(co('2026-10-20T00:00:00'), h)).toBe(false);
  });
});

describe('proximaAperturaDelEquipo', () => {
  it('en horario, es ahora mismo', () => {
    const ahora = co('2026-10-19T10:15:00');
    expect(proximaAperturaDelEquipo(ahora)).toEqual(ahora);
  });

  it('antes de abrir, hoy a las 8', () => {
    expect(proximaAperturaDelEquipo(co('2026-10-19T06:00:00'))).toEqual(
      co('2026-10-19T08:00:00'),
    );
  });

  it('después de cerrar, mañana a las 8', () => {
    expect(proximaAperturaDelEquipo(co('2026-10-19T18:00:00'))).toEqual(
      co('2026-10-20T08:00:00'),
    );
  });

  it('viernes en la noche y el fin de semana, el lunes a las 8', () => {
    expect(proximaAperturaDelEquipo(co('2026-10-23T17:30:00'))).toEqual(
      co('2026-10-26T08:00:00'),
    );
    expect(proximaAperturaDelEquipo(co('2026-10-25T09:00:00'))).toEqual(
      co('2026-10-26T08:00:00'),
    );
  });

  it('con un solo día a la semana, salta hasta ese día', () => {
    const soloMiercoles = horarioEquipoDe({ teamDays: [3] });
    expect(
      proximaAperturaDelEquipo(co('2026-10-21T18:00:00'), soloMiercoles),
    ).toEqual(co('2026-10-28T08:00:00'));
  });

  it('nunca falla aunque el horario llegue roto a mano (sin días)', () => {
    const roto = { ...HORARIO_EQUIPO_POR_DEFECTO, dias: [] };
    const ahora = co('2026-10-19T10:00:00');
    expect(proximaAperturaDelEquipo(ahora, roto)).toEqual(ahora);
  });
});

describe('minutosHabilesEntre', () => {
  it('dentro de la misma jornada, los minutos de reloj', () => {
    expect(
      minutosHabilesEntre(co('2026-10-19T09:00:00'), co('2026-10-19T11:00:00')),
    ).toBe(120);
  });

  it('la noche no cuenta: de 16:00 a 9:00 del día siguiente son 2 h', () => {
    expect(
      minutosHabilesEntre(co('2026-10-19T16:00:00'), co('2026-10-20T09:00:00')),
    ).toBe(120);
  });

  it('el fin de semana no cuenta: viernes 16:30 a lunes 9:30 son 2 h', () => {
    expect(
      minutosHabilesEntre(co('2026-10-23T16:30:00'), co('2026-10-26T09:30:00')),
    ).toBe(120);
  });

  it('un caso abierto el sábado empieza a contar el lunes a las 8', () => {
    expect(
      minutosHabilesEntre(co('2026-10-24T10:00:00'), co('2026-10-26T08:45:00')),
    ).toBe(45);
  });

  it('cero si el intervalo está vacío o al revés', () => {
    const t = co('2026-10-19T10:00:00');
    expect(minutosHabilesEntre(t, t)).toBe(0);
    expect(minutosHabilesEntre(t, co('2026-10-19T09:00:00'))).toBe(0);
  });

  it('suma varios días completos', () => {
    // Lunes 8:00 a miércoles 17:00: tres jornadas de 9 h.
    expect(
      minutosHabilesEntre(co('2026-10-19T08:00:00'), co('2026-10-21T17:00:00')),
    ).toBe(3 * 9 * 60);
  });
});

describe('textoCuandoLoVeElEquipo', () => {
  it('en horario', () => {
    expect(textoCuandoLoVeElEquipo(co('2026-10-19T10:00:00'))).toBe(
      'El equipo técnico está trabajando ahora: lo verá pronto.',
    );
  });

  it('de madrugada: hoy a las 8:00', () => {
    expect(textoCuandoLoVeElEquipo(co('2026-10-20T05:00:00'))).toBe(
      'El equipo técnico lo revisa desde hoy a las 8:00.',
    );
  });

  it('en la noche: mañana a las 8:00', () => {
    expect(textoCuandoLoVeElEquipo(co('2026-10-20T19:00:00'))).toBe(
      'El equipo técnico lo revisa desde mañana a las 8:00.',
    );
  });

  it('viernes en la noche: el lunes a las 8:00', () => {
    expect(textoCuandoLoVeElEquipo(co('2026-10-23T18:00:00'))).toBe(
      'El equipo técnico lo revisa desde el lunes a las 8:00.',
    );
  });

  it('usa la hora de inicio configurada', () => {
    const h = horarioEquipoDe({
      teamFromHour: 7,
      teamToHour: 16,
      teamDays: [1, 2, 3, 4, 5, 6],
    });
    expect(textoCuandoLoVeElEquipo(co('2026-10-23T18:00:00'), h)).toBe(
      'El equipo técnico lo revisa desde mañana a las 7:00.',
    );
    expect(textoCuandoLoVeElEquipo(co('2026-10-24T18:00:00'), h)).toBe(
      'El equipo técnico lo revisa desde el lunes a las 7:00.',
    );
  });
});
