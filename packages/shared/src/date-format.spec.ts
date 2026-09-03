import {
  DEFAULT_TIMEZONE,
  formatAppointmentCompact,
  formatAppointmentLong,
  formatAppointmentShort,
  formatDateOnly,
  formatDateShort,
  formatTimeOnly,
} from './date-format';

/**
 * Los helpers canónicos de fecha. CLAUDE.md los declara obligatorios y hay una
 * regla de ESLint que prohíbe saltárselos, por un motivo medido: los
 * contenedores corren en UTC y, sin `timeZone` explícito, la cita que el
 * paciente recibe por WhatsApp sale CINCO HORAS adelantada.
 *
 * Así que lo primero que se afirma en cada función es lo mismo: la hora que
 * produce es la de Bogotá, no la del proceso. El resto —formato, mayúsculas,
 * el "p m" sin puntos que los TTS leen bien— es contrato de presentación que
 * un refactor puede romper sin que ninguna otra prueba se entere.
 */

/** 2026-06-03T20:00:00Z = miércoles 3 de junio, 03:00 p. m. en Bogotá. */
const TARDE = new Date('2026-06-03T20:00:00.000Z');
/** 2026-06-04T02:30:00Z = miércoles 3 de junio, 09:30 p. m. en Bogotá. */
const NOCHE_QUE_CRUZA = new Date('2026-06-04T02:30:00.000Z');
/** 2026-06-03T13:05:00Z = miércoles 3 de junio, 08:05 a. m. en Bogotá. */
const MANANA = new Date('2026-06-03T13:05:00.000Z');

describe('la zona horaria es la del producto, no la del proceso', () => {
  const FUNCIONES = [
    ['formatAppointmentLong', formatAppointmentLong],
    ['formatAppointmentCompact', formatAppointmentCompact],
    ['formatAppointmentShort', formatAppointmentShort],
    ['formatTimeOnly', formatTimeOnly],
  ] as const;

  it.each(FUNCIONES)('%s muestra 03:00, no las 20:00 de UTC', (_n, fn) => {
    const texto = fn(TARDE);
    expect(texto).toContain('03:00');
    expect(texto).not.toContain('20:00');
  });

  it.each([
    ['formatAppointmentLong', formatAppointmentLong],
    ['formatAppointmentCompact', formatAppointmentCompact],
    ['formatDateOnly', formatDateOnly],
    ['formatDateShort', formatDateShort],
  ] as const)(
    '%s: una cita de la noche NO se corre al día siguiente',
    (_n, fn) => {
      // 02:30 UTC del jueves es todavía miércoles en Bogotá. Sin `timeZone`,
      // el paciente vería la fecha de mañana.
      const texto = fn(NOCHE_QUE_CRUZA).toLowerCase();
      expect(texto).toMatch(/miércoles|mié|03\/06/);
      expect(texto).not.toMatch(/jueves|jue|04\/06/);
    },
  );

  it('la zona se puede sobrescribir para una clínica fuera de Colombia', () => {
    // 20:00 UTC = 22:00 en Madrid.
    const texto = formatTimeOnly(TARDE, { timeZone: 'Europe/Madrid' });
    expect(texto).toContain('10:00');
    expect(texto).toMatch(/p\s?m/i);
  });

  it('la constante de zona por defecto es la de Colombia', () => {
    expect(DEFAULT_TIMEZONE).toBe('America/Bogota');
  });
});

describe('entrada', () => {
  const FUNCIONES = [
    ['formatAppointmentLong', formatAppointmentLong],
    ['formatAppointmentCompact', formatAppointmentCompact],
    ['formatAppointmentShort', formatAppointmentShort],
    ['formatDateOnly', formatDateOnly],
    ['formatTimeOnly', formatTimeOnly],
    ['formatDateShort', formatDateShort],
  ] as const;

  it.each(FUNCIONES)('%s acepta un Date y su ISO indistintamente', (_n, fn) => {
    expect(fn(TARDE)).toBe(fn(TARDE.toISOString()));
  });
});

describe('formatAppointmentLong — el formato de los mensajes al paciente', () => {
  it('día de la semana, día, mes y hora en 12 h', () => {
    const texto = formatAppointmentLong(TARDE);

    expect(texto.toLowerCase()).toContain('miércoles');
    expect(texto).toContain('3 de junio');
    expect(texto).toContain('a las 03:00');
  });

  it('🔊 el meridiano va SIN puntos: los TTS leen mejor «p m» que «p. m.»', () => {
    const texto = formatAppointmentLong(TARDE);
    expect(texto).toMatch(/p\sm$/);
    expect(texto).not.toContain('p. m.');
  });

  it('la mañana se marca como a m', () => {
    expect(formatAppointmentLong(MANANA)).toMatch(/08:05 a\sm$/);
  });
});

describe('formatAppointmentCompact — listados de varias citas', () => {
  it('abrevia el día y el mes, y conserva el 12 h', () => {
    const texto = formatAppointmentCompact(TARDE);

    expect(texto.toLowerCase()).toMatch(/^mi[ée]/);
    expect(texto.toLowerCase()).toContain('jun');
    expect(texto).toMatch(/03:00 p\sm$/);
  });

  it('no usa el formato 24 h: sería asimétrico con el mensaje largo', () => {
    // Es el defecto original: el menú decía "03:00 p m" y el resumen "15:00",
    // y el paciente lo leía como dos citas distintas.
    expect(formatAppointmentCompact(TARDE)).not.toContain('15:00');
  });
});

describe('formatAppointmentShort — fecha numérica + hora', () => {
  it('dd/mm/aaaa con hora de 12 h', () => {
    expect(formatAppointmentShort(TARDE)).toBe('03/06/2026 03:00 p m');
  });

  it('los días y meses de un dígito van con cero a la izquierda', () => {
    const texto = formatAppointmentShort(new Date('2026-01-05T15:00:00.000Z'));
    expect(texto.startsWith('05/01/2026')).toBe(true);
  });
});

describe('formatDateOnly / formatDateShort — sin hora', () => {
  it('la larga no lleva hora', () => {
    const texto = formatDateOnly(TARDE);
    expect(texto.toLowerCase()).toContain('miércoles');
    expect(texto).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('la corta es dd/mm/aaaa y tampoco lleva hora', () => {
    expect(formatDateShort(TARDE)).toBe('03/06/2026');
  });
});

describe('formatTimeOnly', () => {
  it('devuelve solo la hora, sin fecha', () => {
    const texto = formatTimeOnly(TARDE);
    expect(texto).toBe('03:00 p m');
    expect(texto).not.toContain('junio');
  });

  it('con `withSeconds` añade los segundos (monitores, gráficos)', () => {
    const texto = formatTimeOnly(new Date('2026-06-03T20:00:45.000Z'), {
      withSeconds: true,
    });
    expect(texto).toBe('03:00:45 p m');
  });

  it('sin `withSeconds` NO los añade', () => {
    expect(formatTimeOnly(new Date('2026-06-03T20:00:45.000Z'))).toBe(
      '03:00 p m',
    );
  });

  it('medianoche y mediodía se distinguen', () => {
    // 05:00 UTC = 00:00 en Bogotá; 17:00 UTC = 12:00.
    expect(formatTimeOnly(new Date('2026-06-03T05:00:00.000Z'))).toMatch(
      /12:00 a\sm/,
    );
    expect(formatTimeOnly(new Date('2026-06-03T17:00:00.000Z'))).toMatch(
      /12:00 p\sm/,
    );
  });
});

describe('cleanMeridiem — ninguna salida deja puntos ni espacios dobles', () => {
  const CON_HORA = [
    formatAppointmentLong,
    formatAppointmentCompact,
    formatAppointmentShort,
    formatTimeOnly,
  ];

  it.each(CON_HORA.map((f, i) => [i, f]))(
    'la función #%i produce un meridiano limpio',
    (_i, fn) => {
      const texto = (fn as (d: Date) => string)(TARDE);
      const meridiano = texto.slice(texto.search(/[ap]\s?m/i));
      expect(meridiano).not.toContain('.');
      expect(meridiano).not.toMatch(/\s{2,}/);
    },
  );
});

describe('el locale también se puede sobrescribir', () => {
  it('en inglés cambia el nombre del día, no la zona', () => {
    const texto = formatDateOnly(TARDE, { locale: 'en-US' });
    expect(texto.toLowerCase()).toContain('wednesday');
    expect(texto).toContain('June');
  });
});
