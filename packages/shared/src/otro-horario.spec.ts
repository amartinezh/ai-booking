import {
  diaComunDeLosCupos,
  esRechazo,
  etiquetaOtroHorario,
  inicioDelDiaSiguiente,
  interpretarOtroHorario,
  ventanaOtroHorario,
} from './otro-horario';
import { franjaDelCupo } from './cupos-ofrecidos';

// Martes 27 de octubre de 2026, 07:43 en Bogotá (12:43 UTC): la hora a la que
// el paciente terminado en 2168 escribió «para mañana no hay».
const now = new Date('2026-10-27T12:43:00Z');
const opts = { now };

const dia = (p: ReturnType<typeof interpretarOtroHorario>) =>
  p?.fecha ? p.fecha.desde.toISOString() : null;

describe('interpretarOtroHorario — lo que escribieron en el menú de cupos (26 y 27-oct)', () => {
  it.each([
    ['para mañana no hay', '2026-10-28T05:00:00.000Z'],
    ['Para mañana no hay', '2026-10-28T05:00:00.000Z'],
    ['Mañana', '2026-10-28T05:00:00.000Z'],
    ['Puede ser para mañana', '2026-10-28T05:00:00.000Z'],
    ['Podría ser para el miércoles 28 de octubre por favor', '2026-10-28T05:00:00.000Z'],
    ['Necesito una cita para miércoles 28 de octubre', '2026-10-28T05:00:00.000Z'],
    ['el jueves', '2026-10-29T05:00:00.000Z'],
    ['¿y para hoy?', '2026-10-27T05:00:00.000Z'],
  ])('«%s» pide ese día', (texto, desde) => {
    const p = interpretarOtroHorario(texto, opts);
    expect(dia(p)).toBe(desde);
    expect(p?.otroDia).toBe(false);
  });

  it('«miércoles 28» un miércoles 28 es ese mismo día, no el de la semana entrante', () => {
    const miercoles = new Date('2026-10-28T12:00:00Z');
    const p = interpretarOtroHorario('el miércoles 28', { now: miercoles });
    expect(dia(p)).toBe('2026-10-28T05:00:00.000Z');
  });

  it.each([
    ['en la tarde', 'TARDE'],
    ['Por la tarde por favor', 'TARDE'],
    ['Mas tarde no se puede', 'TARDE'],
    ['Muy temprano las citas', 'TARDE'],
    ['más temprano', 'MANANA'],
    ['para la mañana', 'MANANA'],
    ['en la mañanita', 'MANANA'],
    ['muy tarde', 'MANANA'],
    ['a las 3', 'TARDE'],
    ['a las 9', 'MANANA'],
    ['10:30 a. m.', 'MANANA'],
    ['no puedo en la mañana', 'TARDE'],
    ['no me sirve en la tarde', 'MANANA'],
  ])('«%s» pide la franja %s, sin día', (texto, franja) => {
    const p = interpretarOtroHorario(texto, opts);
    // La hora, si la dijo, viaja aparte (ver «la hora que pide» abajo).
    expect(p).toMatchObject({ fecha: null, franja, otroDia: false });
  });

  it('«mañana en la tarde» pide el día y la franja', () => {
    const p = interpretarOtroHorario('mañana en la tarde', opts);
    expect(dia(p)).toBe('2026-10-28T05:00:00.000Z');
    expect(p?.franja).toBe('TARDE');
  });

  it('«para la mañana» es la franja, no el día siguiente', () => {
    expect(interpretarOtroHorario('para la mañana', opts)?.fecha).toBeNull();
  });

  it.each([
    'No',
    'No.',
    'ninguno',
    'Ninguna me sirve',
    'no me sirven',
    'no puedo',
    'otro día',
    'Otra fecha por favor',
    'un día diferente',
  ])('«%s» pide otro día', (texto) => {
    expect(interpretarOtroHorario(texto, opts)).toEqual({
      fecha: null,
      franja: null,
      otroDia: true,
    });
  });

  it('«no puedo mañana» no pide mañana: pide otro día', () => {
    expect(interpretarOtroHorario('no puedo mañana', opts)).toEqual({
      fecha: null,
      franja: null,
      otroDia: true,
    });
  });

  it.each(['Otro horario', 'otra hora', 'más opciones', 'Quiero cambiar el horario'])(
    '«%s» pide los que siguen',
    (texto) => {
      expect(interpretarOtroHorario(texto, opts)).toEqual({
        fecha: null,
        franja: null,
        otroDia: false,
      });
    },
  );

  it.each(['A', 'gracias', 'Muchas gracias', 'Si', 'ok', '', '   ', '1054927777'])(
    '«%s» no es un pedido de otro horario',
    (texto) => {
      expect(interpretarOtroHorario(texto, opts)).toBeNull();
    },
  );

  it('null y undefined → null', () => {
    expect(interpretarOtroHorario(null, opts)).toBeNull();
    expect(interpretarOtroHorario(undefined, opts)).toBeNull();
  });
});

describe('ventanaOtroHorario', () => {
  // Los tres cupos que vio el 27-oct, todos del martes.
  const ofrecidos = [
    new Date('2026-10-27T15:10:00Z'), // 10:10 a. m.
    new Date('2026-10-27T15:30:00Z'), // 10:30 a. m.
    new Date('2026-10-27T17:30:00Z'), // 12:30 p. m.
  ];

  it('con día: ese día', () => {
    const p = interpretarOtroHorario('el jueves', opts)!;
    expect(ventanaOtroHorario(p, ofrecidos, opts)).toEqual({
      desde: new Date('2026-10-29T05:00:00Z'),
      hasta: new Date('2026-10-30T04:59:59.999Z'),
    });
  });

  it('otro día: desde la medianoche siguiente al último ofrecido, sin tope', () => {
    const p = interpretarOtroHorario('otro día', opts)!;
    expect(ventanaOtroHorario(p, ofrecidos, opts)).toEqual({
      desde: new Date('2026-10-28T05:00:00Z'),
      hasta: null,
    });
  });

  it('otro día sin cupos ofrecidos: desde mañana', () => {
    const p = interpretarOtroHorario('otro día', opts)!;
    expect(ventanaOtroHorario(p, [], opts).desde).toEqual(
      new Date('2026-10-28T05:00:00Z'),
    );
  });

  it('franja u «otro horario»: desde ahora', () => {
    for (const texto of ['en la tarde', 'otro horario']) {
      const p = interpretarOtroHorario(texto, opts)!;
      expect(ventanaOtroHorario(p, ofrecidos, opts)).toEqual({
        desde: now,
        hasta: null,
      });
    }
  });

  it('inicioDelDiaSiguiente: la medianoche de Bogotá, no la de UTC', () => {
    // 11:30 p. m. del martes en Bogotá ya es miércoles en UTC.
    expect(inicioDelDiaSiguiente([new Date('2026-10-28T04:30:00Z')], opts)).toEqual(
      new Date('2026-10-28T05:00:00Z'),
    );
  });
});

describe('etiquetaOtroHorario', () => {
  it('con el día escrito por el asistente, no la frase del paciente', () => {
    const p = interpretarOtroHorario(
      'Podría ser para el miércoles 28 de octubre por favor',
      opts,
    )!;
    expect(etiquetaOtroHorario(p)).toBe('miércoles 28 de octubre');
  });

  it('día y franja', () => {
    const p = interpretarOtroHorario('mañana en la tarde', opts)!;
    expect(etiquetaOtroHorario(p)).toBe('miércoles 28 de octubre en la tarde');
  });

  it('solo franja', () => {
    expect(etiquetaOtroHorario(interpretarOtroHorario('más temprano', opts)!)).toBe(
      'la mañana',
    );
  });

  it('una semana: del primero al último día', () => {
    const p = interpretarOtroHorario('la otra semana', opts)!;
    expect(etiquetaOtroHorario(p)).toBe(
      'del lunes 2 de noviembre al domingo 8 de noviembre',
    );
  });

  it('otro día u «otro horario»: sin etiqueta', () => {
    expect(etiquetaOtroHorario(interpretarOtroHorario('otro día', opts)!)).toBeNull();
    expect(etiquetaOtroHorario(interpretarOtroHorario('otro horario', opts)!)).toBeNull();
  });
});

// 2026-10-28, el miércoles: lo que escribieron con la versión del 27 y no se
// entendía o se entendía mal.
describe('interpretarOtroHorario — lo que escribieron el 27 y 28 de octubre', () => {
  // Miércoles 28 de octubre, 06:25 en Bogotá (11:25 UTC).
  const miercoles = { now: new Date('2026-10-28T11:25:00Z') };

  it('«Miercoles 3:30 pm» un miércoles a las 6 a. m. → esta tarde, no el 3 de noviembre', () => {
    const p = interpretarOtroHorario('Miercoles 3:30 pm', miercoles)!;
    expect(dia(p)).toBe('2026-10-28T05:00:00.000Z');
    expect(p.franja).toBe('TARDE');
    expect(p.hora).toEqual({ hour24: 15, minute: 30, meridiemKnown: true });
  });

  it('«Jueves 7 50 Dr Germán García» → el jueves 29 a las 7:50, no el 7 de noviembre', () => {
    const p = interpretarOtroHorario('Jueves 7 50 Dr Germán García', miercoles)!;
    expect(dia(p)).toBe('2026-10-29T05:00:00.000Z');
    expect(p.hora).toEqual({ hour24: 7, minute: 50, meridiemKnown: false });
  });

  it('«Puede ser el jueves 12 de octubre ?» → el jueves 29, no octubre de 2027', () => {
    const p = interpretarOtroHorario('Puede ser el jueves 12 de octubre ?', opts)!;
    expect(dia(p)).toBe('2026-10-29T05:00:00.000Z');
  });

  it.each(['Otra', 'otro', 'Otras', 'la otra'])('«%s» a secas pide los cupos que siguen', (texto) => {
    expect(interpretarOtroHorario(texto, opts)).toEqual({
      fecha: null,
      franja: null,
      otroDia: false,
    });
  });

  it.each(['Tarde', 'tarde', 'la tarde', 'en las tardes'])('«%s» a secas pide la tarde', (texto) => {
    expect(interpretarOtroHorario(texto, opts)).toMatchObject({
      fecha: null,
      franja: 'TARDE',
      otroDia: false,
    });
  });

  it('«El28 de octubre» → el miércoles 28', () => {
    expect(dia(interpretarOtroHorario('El28 de octubre', opts))).toBe(
      '2026-10-28T05:00:00.000Z',
    );
  });

  it('la hora que pide viaja en el pedido: «Para las 3:30 el jueves»', () => {
    const p = interpretarOtroHorario('Para las 3:30 el jueves', opts)!;
    expect(dia(p)).toBe('2026-10-29T05:00:00.000Z');
    expect(p.hora).toEqual({ hour24: 3, minute: 30, meridiemKnown: false });
  });

  it('con un rechazo no hay hora pedida: «no puedo a las 7»', () => {
    expect(interpretarOtroHorario('no puedo a las 7', opts)?.hora).toBeUndefined();
  });

  it('«Muchas gracias» y «Perdón es B» no son pedidos de otro horario', () => {
    expect(interpretarOtroHorario('Muchas gracias', opts)).toBeNull();
    expect(interpretarOtroHorario('Perdón es B', opts)).toBeNull();
  });
});

// 2026-10-29: «No quedaría bien para las 6:30» y el menú le reservó las 6:30.
describe('interpretarOtroHorario — rechaza una hora que nombra', () => {
  it.each([
    'No quedaría bien para las 6:30.',
    'no me sirve a las 7',
    'A las 8 no puedo',
    'no me queda a las 2:40',
    'no es posible a las 10',
  ])('«%s» pide los horarios que siguen, no esa hora ni otro día', (texto) => {
    expect(interpretarOtroHorario(texto, opts)).toEqual({
      fecha: null,
      franja: null,
      otroDia: false,
    });
  });

  it('«No quedaría bien en la mañana» sigue pidiendo la tarde', () => {
    expect(interpretarOtroHorario('No quedaría bien en la mañana', opts)).toMatchObject({
      franja: 'TARDE',
    });
  });

  it('«no puedo a las 7, otro día» pide otro día', () => {
    expect(interpretarOtroHorario('no puedo a las 7, otro día', opts)?.otroDia).toBe(true);
  });
});

describe('esRechazo', () => {
  it.each(['No quedaría bien para las 6:30', 'no me sirve', 'Ninguna', 'no', 'no podría ese día'])(
    '«%s» → sí',
    (t) => {
      expect(esRechazo(t)).toBe(true);
    },
  );
  it.each(['A las 6:30 por favor', 'B', 'mañana en la tarde', 'Nora', null])('«%s» → no', (t) => {
    expect(esRechazo(t)).toBe(false);
  });
});

describe('diaComunDeLosCupos', () => {
  it('todos del mismo día → ese día en palabras', () => {
    expect(
      diaComunDeLosCupos([
        new Date('2026-10-28T13:00:00Z'),
        new Date('2026-10-28T19:00:00Z'),
      ]),
    ).toBe('miércoles 28 de octubre');
  });

  it('de días distintos → null', () => {
    expect(
      diaComunDeLosCupos([
        new Date('2026-10-28T13:00:00Z'),
        new Date('2026-10-29T13:00:00Z'),
      ]),
    ).toBeNull();
  });
});

describe('franjaDelCupo', () => {
  it('la tarde empieza a las 12 de Bogotá', () => {
    expect(franjaDelCupo(new Date('2026-10-27T16:59:00Z'))).toBe('MANANA'); // 11:59
    expect(franjaDelCupo(new Date('2026-10-27T17:00:00Z'))).toBe('TARDE'); // 12:00
  });
});
