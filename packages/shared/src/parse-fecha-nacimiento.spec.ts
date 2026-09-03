import {
  parseFechaNacimiento,
  parseSexo,
  parseRegimen,
  formatFechaNacimiento,
} from './parse-fecha-nacimiento';

// Reloj fijo: sin esto los tests de edad y de año de dos dígitos cambiarían
// de resultado cada 1 de enero.
const HOY = new Date('2026-08-31T12:00:00.000Z');
const parse = (t: string) => parseFechaNacimiento(t, { hoy: HOY });

describe('parseFechaNacimiento', () => {
  describe('formatos que un paciente escribe de verdad', () => {
    it.each([
      ['15/03/1980', '1980-03-15'],
      ['15-03-1980', '1980-03-15'],
      ['15.03.1980', '1980-03-15'],
      ['5/3/1980', '1980-03-05'],
      ['15/3/80', '1980-03-15'],
      ['15 de marzo de 1980', '1980-03-15'],
      ['15 marzo 1980', '1980-03-15'],
      ['15 de marzo del 1980', '1980-03-15'],
      ['15 mar 1980', '1980-03-15'],
      ['1980-03-15', '1980-03-15'],
      ['  15 / 03 / 1980  ', '1980-03-15'],
    ])('%s → %s', (entrada, esperado) => {
      expect(parse(entrada)?.iso.slice(0, 10)).toBe(esperado);
    });

    it('acepta el mes con tildes y en mayúsculas', () => {
      expect(parse('15 de MARZO de 1980')?.iso.slice(0, 10)).toBe('1980-03-15');
      expect(parse('3 de Diciembre de 1975')?.iso.slice(0, 10)).toBe(
        '1975-12-03',
      );
    });
  });

  // ⚠️ El error que más caro sale: leer 03/05 como 5 de marzo en vez de 3 de
  // mayo le cambia la edad al paciente y con ella el rango que el HIS valida.
  it('lee DD/MM, no MM/DD (convención colombiana)', () => {
    const r = parse('03/05/1980');
    expect(r?.date.getUTCDate()).toBe(3);
    expect(r?.date.getUTCMonth()).toBe(4); // mayo
  });

  describe('años de dos dígitos: siempre hacia atrás', () => {
    it('"80" es 1980', () => {
      expect(parse('15/03/80')?.date.getUTCFullYear()).toBe(1980);
    });

    it('"26" es 2026 (un bebé), no 1926', () => {
      expect(parse('15/03/26')?.date.getUTCFullYear()).toBe(2026);
    });

    it('"27" es 1927, porque 2027 aún no ha llegado', () => {
      expect(parse('15/03/27')?.date.getUTCFullYear()).toBe(1927);
    });
  });

  describe('rechaza lo que no puede ser una fecha de nacimiento', () => {
    it('una fecha futura', () => {
      expect(parse('15/03/2027')).toBeNull();
      expect(parseFechaNacimiento('01/09/2026', { hoy: HOY })).toBeNull();
    });

    it('un día que no existe en ese mes', () => {
      expect(parse('31/02/1980')).toBeNull();
      expect(parse('31/04/1990')).toBeNull();
    });

    it('el 29 de febrero de un año NO bisiesto', () => {
      expect(parse('29/02/1981')).toBeNull();
      expect(parse('29/02/1980')?.iso.slice(0, 10)).toBe('1980-02-29');
    });

    it('un mes fuera de rango', () => {
      expect(parse('15/13/1980')).toBeNull();
      expect(parse('15/00/1980')).toBeNull();
    });

    it('más de 120 años: casi seguro una errata', () => {
      expect(parse('15/03/1850')).toBeNull();
    });

    it('texto que no es una fecha', () => {
      expect(parse('no me acuerdo')).toBeNull();
      expect(parse('mañana')).toBeNull();
      expect(parse('15 de marzo')).toBeNull(); // sin año
      expect(parse('')).toBeNull();
      expect(parseFechaNacimiento(null)).toBeNull();
    });

    it('un mes en letras que no existe', () => {
      expect(parse('15 de marxo de 1980')).toBeNull();
    });
  });

  describe('edad', () => {
    it('cuenta años cumplidos, no calendario', () => {
      // Cumple el 15 de marzo; el 31 de agosto de 2026 ya los cumplió.
      expect(parse('15/03/1980')?.edad).toBe(46);
    });

    it('descuenta el año si aún no ha llegado su cumpleaños', () => {
      // Cumple el 31 de diciembre: a 31 de agosto todavía no.
      expect(parse('31/12/1980')?.edad).toBe(45);
    });

    it('el mismo día del cumpleaños ya cuenta', () => {
      expect(parse('31/08/2000')?.edad).toBe(26);
    });

    it('un recién nacido da 0, no null', () => {
      expect(parse('30/08/2026')?.edad).toBe(0);
    });
  });

  it('devuelve medianoche UTC, que es como viaja por el protocolo', () => {
    const r = parse('15/03/1980');
    expect(r?.iso).toBe('1980-03-15T00:00:00.000Z');
  });
});

describe('parseSexo', () => {
  it.each([
    ['M', 'M'], ['m', 'M'], ['masculino', 'M'], ['Hombre', 'M'], ['varon', 'M'],
    ['F', 'F'], ['femenino', 'F'], ['MUJER', 'F'], ['fem', 'F'],
  ])('%s → %s', (entrada, esperado) => {
    expect(parseSexo(entrada)).toBe(esperado);
  });

  it('no adivina ante algo ambiguo', () => {
    expect(parseSexo('no sé')).toBeNull();
    expect(parseSexo('otro')).toBeNull();
    expect(parseSexo('')).toBeNull();
    expect(parseSexo(null)).toBeNull();
  });

  it('acepta tildes: "varón" con tilde es lo que la gente escribe', () => {
    expect(parseSexo('varón')).toBe('M');
  });
});

describe('parseRegimen', () => {
  it.each([
    ['subsidiado', 'SUBSIDIADO'], ['SISBEN', 'SUBSIDIADO'], ['a', 'SUBSIDIADO'],
    ['1', 'SUBSIDIADO'], ['contributivo', 'CONTRIBUTIVO'],
    ['cotizante', 'CONTRIBUTIVO'], ['b', 'CONTRIBUTIVO'], ['2', 'CONTRIBUTIVO'],
  ])('%s → %s', (entrada, esperado) => {
    expect(parseRegimen(entrada)).toBe(esperado);
  });

  it('no adivina: sin régimen el convenio de facturación sale mal', () => {
    expect(parseRegimen('no sé')).toBeNull();
    expect(parseRegimen('particular')).toBeNull();
    expect(parseRegimen(null)).toBeNull();
  });

  // 🚨 SOLO CONOCE DOS VALORES — y eso es exactamente el hueco que destapó
  // G.7 del driver de Anserma (2026-09-03). El padrón de Fomag/magisterio
  // está el 100 % bajo un código de régimen del HIS que NO es ni SUBSIDIADO
  // ni CONTRIBUTIVO (encaja con lo que es el magisterio en Colombia: un
  // régimen de EXCEPCIÓN). Si algún día se le pregunta el régimen a un
  // paciente de ese tipo, ninguna respuesta suya calza aquí — 'excepcion',
  // 'magisterio' o 'ninguno de los dos' vuelven null igual que 'no sé'.
  //
  // No es un bug: es la prueba de que la pregunta «¿subsidiado o
  // contributivo?» no se le puede hacer a TODOS los pacientes por igual, y
  // de que un tercer régimen necesita su propio camino en el chatbot, no una
  // tercera opción aquí adivinada sin que el hospital lo confirme.
  it('🚨 un régimen de excepción (magisterio) no calza en ninguno de los dos', () => {
    expect(parseRegimen('excepcion')).toBeNull();
    expect(parseRegimen('magisterio')).toBeNull();
    expect(parseRegimen('ninguno de los dos')).toBeNull();
  });
});

describe('formatFechaNacimiento', () => {
  it('devuelve el día correcto, no el anterior', () => {
    // 🐛 Formatear en America/Bogota (UTC-5) una fecha guardada como
    // medianoche UTC la corre un día atrás: un 15/03/1980 se le devolvía al
    // paciente como "14 de marzo". Lo detectó el propio eco de confirmación.
    const f = parseFechaNacimiento('15/03/1980', { hoy: HOY })!;
    expect(formatFechaNacimiento(f.date)).toContain('15');
    expect(formatFechaNacimiento(f.date)).not.toContain('14');
  });

  it('incluye el año: confirmar "15 de marzo" sin año no confirma nada', () => {
    const f = parseFechaNacimiento('15/03/1980', { hoy: HOY })!;
    expect(formatFechaNacimiento(f.date)).toContain('1980');
  });

  it('el mes va en letras, que es como lo lee una persona', () => {
    const f = parseFechaNacimiento('15/03/1980', { hoy: HOY })!;
    expect(formatFechaNacimiento(f.date).toLowerCase()).toContain('marzo');
  });

  it('el 1 de enero no se cae al año anterior', () => {
    const f = parseFechaNacimiento('01/01/1990', { hoy: HOY })!;
    const out = formatFechaNacimiento(f.date);
    expect(out).toContain('1990');
    expect(out).toContain('1');
  });
});
