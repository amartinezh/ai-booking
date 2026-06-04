import { parseFechaPreferida } from './parse-fecha-preferida';

/**
 * `now` de referencia: jueves 4 de junio de 2026, 15:00 UTC = 10:00 en Bogotá.
 * Bogotá no tiene DST → offset constante −05:00, así que el inicio de un día
 * local cae en las 05:00 UTC de ese mismo día.
 */
const NOW = new Date('2026-06-04T15:00:00.000Z');

const parse = (s: string | null | undefined, now: Date = NOW) =>
  parseFechaPreferida(s, { now });

describe('parseFechaPreferida', () => {
  describe('entradas no reconocidas → null (cae a comportamiento actual)', () => {
    it.each([null, undefined, '', '   ', 'para mí', 'no sé', 'cuanto antes'])(
      '%s → null',
      (input) => {
        expect(parse(input as any)).toBeNull();
      },
    );
  });

  describe('relativos', () => {
    it('"hoy" → día 4, ventana en horario Bogotá', () => {
      const r = parse('hoy');
      expect(r).not.toBeNull();
      expect(r!.precision).toBe('dia');
      expect(r!.label).toBe('hoy');
      expect(r!.desde.toISOString()).toBe('2026-06-04T05:00:00.000Z');
      expect(r!.hasta.toISOString()).toBe('2026-06-05T04:59:59.999Z');
    });

    it('"mañana" → día 5 (el test que atrapa el bug de TZ)', () => {
      const r = parse('mañana');
      expect(r!.precision).toBe('dia');
      // Bogotá 5-jun 00:00 = UTC 5-jun 05:00, NO 00:00Z.
      expect(r!.desde.toISOString()).toBe('2026-06-05T05:00:00.000Z');
      expect(r!.hasta.toISOString()).toBe('2026-06-06T04:59:59.999Z');
    });

    it('"para mañana" también resuelve a tomorrow', () => {
      expect(parse('para mañana')!.desde.toISOString()).toBe(
        '2026-06-05T05:00:00.000Z',
      );
    });

    it('"pasado mañana" → día 6', () => {
      const r = parse('pasado mañana');
      expect(r!.desde.toISOString()).toBe('2026-06-06T05:00:00.000Z');
    });

    it('"mañana por la mañana" conserva el día (tomorrow), no la franja', () => {
      expect(parse('mañana por la mañana')!.desde.toISOString()).toBe(
        '2026-06-05T05:00:00.000Z',
      );
    });

    it('"en la mañana" (franja sin fecha) → null', () => {
      expect(parse('en la mañana')).toBeNull();
    });
  });

  describe('días de la semana (próxima ocurrencia futura)', () => {
    it('"el lunes" desde un jueves → lunes 8', () => {
      const r = parse('el lunes');
      expect(r!.precision).toBe('dia');
      expect(r!.desde.toISOString()).toBe('2026-06-08T05:00:00.000Z');
    });

    it('"el jueves" cuando HOY es jueves → +7 (jueves 11), nunca hoy', () => {
      const r = parse('el jueves');
      expect(r!.desde.toISOString()).toBe('2026-06-11T05:00:00.000Z');
    });

    it('"el próximo viernes" → viernes 5', () => {
      expect(parse('el próximo viernes')!.desde.toISOString()).toBe(
        '2026-06-05T05:00:00.000Z',
      );
    });
  });

  describe('rangos de semana', () => {
    it('"esta semana" → hoy (jue 4) hasta domingo 7', () => {
      const r = parse('esta semana');
      expect(r!.precision).toBe('rango');
      expect(r!.desde.toISOString()).toBe('2026-06-04T05:00:00.000Z');
      expect(r!.hasta.toISOString()).toBe('2026-06-08T04:59:59.999Z'); // dom 7, fin de día
    });

    it('"la próxima semana" → lunes 8 a domingo 14', () => {
      const r = parse('la próxima semana');
      expect(r!.precision).toBe('rango');
      expect(r!.desde.toISOString()).toBe('2026-06-08T05:00:00.000Z');
      expect(r!.hasta.toISOString()).toBe('2026-06-15T04:59:59.999Z'); // dom 14, fin de día
    });

    it('"la semana que viene" equivale a próxima semana', () => {
      expect(parse('la semana que viene')!.desde.toISOString()).toBe(
        '2026-06-08T05:00:00.000Z',
      );
    });
  });

  describe('día de mes', () => {
    it('"25 de junio" → 25-jun mismo año', () => {
      expect(parse('25 de junio')!.desde.toISOString()).toBe(
        '2026-06-25T05:00:00.000Z',
      );
    });

    it('"3 de mayo" (ya pasó este año) → mayo del año siguiente', () => {
      expect(parse('3 de mayo')!.desde.toISOString()).toBe(
        '2027-05-03T05:00:00.000Z',
      );
    });

    it('"el 25" (suelto, >= hoy) → 25 de este mes', () => {
      expect(parse('el 25')!.desde.toISOString()).toBe(
        '2026-06-25T05:00:00.000Z',
      );
    });

    it('"el 1" (ya pasó este mes) → 1 del mes siguiente', () => {
      expect(parse('el 1')!.desde.toISOString()).toBe(
        '2026-07-01T05:00:00.000Z',
      );
    });
  });

  describe('robustez de zona horaria cerca de medianoche', () => {
    it('a las 23:30 de Bogotá (04:30Z) "mañana" usa el día local correcto', () => {
      // 2026-06-04T04:30Z = 2026-06-03 23:30 en Bogotá → hoy local = jun 3.
      const lateNight = new Date('2026-06-04T04:30:00.000Z');
      const r = parse('mañana', lateNight);
      // mañana respecto a jun 3 = jun 4.
      expect(r!.desde.toISOString()).toBe('2026-06-04T05:00:00.000Z');
    });
  });

  describe('label refleja las palabras del paciente', () => {
    it('conserva el texto original con tildes', () => {
      expect(parse('  el próximo Lunes ')!.label).toBe('el próximo Lunes');
    });
  });
});
