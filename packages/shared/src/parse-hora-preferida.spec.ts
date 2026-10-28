import { parseHoraPreferida, matchesHora } from './parse-hora-preferida';

describe('parseHoraPreferida', () => {
  // 2026-10-28: frases reales del menú de cupos que no se leían, y por eso el
  // asistente respondía «hay más de un horario que coincide».
  describe('como lo teclean los pacientes', () => {
    it.each([
      ['Miercoles 28 alas 9am con el doctor Santiago', 9, null, true],
      ['28 de octubre 3:00pm', 15, 0, true],
      ['A las 11;20 am, está bien', 11, 20, true],
      ['A las dos y cuarenta con el doctor Cardenas', 2, 40, false],
      ['a las dos y cuarenta y cinco', 2, 45, false],
      ['Jueves 7 50 Dr Germán García', 7, 50, false],
      ['Jueves 29 750 Dr Germán García', 7, 50, false],
      ['a las 930', 9, 30, false],
      ['a las 7 50 de la mañana', 7, 50, true],
    ])('"%s" → %s:%s', (frase, hour24, minute, meridiemKnown) => {
      expect(parseHoraPreferida(frase)).toEqual({ hour24, minute, meridiemKnown });
    });

    it.each(['el 28 de octubre', '24391096', 'la cédula es 1054918312', 'jueves 29'])(
      '"%s" no es una hora',
      (frase) => {
        expect(parseHoraPreferida(frase)).toBeNull();
      },
    );

    it('"a las 10" sigue siendo las 10, no 1:0', () => {
      expect(parseHoraPreferida('a las 10')).toEqual({
        hour24: 10,
        minute: null,
        meridiemKnown: false,
      });
    });
  });

  describe('no reconocido → null', () => {
    it.each([null, undefined, '', '   ', 'para mí', 'cuanto antes', 'mañana'])(
      '%s → null',
      (input) => {
        expect(parseHoraPreferida(input as any)).toBeNull();
      },
    );
  });

  describe('reloj explícito', () => {
    it('"15:30" → 15:30 inequívoco', () => {
      expect(parseHoraPreferida('a las 15:30')).toEqual({
        hour24: 15,
        minute: 30,
        meridiemKnown: true,
      });
    });
    it('"9:00 de la mañana" → 09:00 am', () => {
      expect(parseHoraPreferida('9:00 de la mañana')).toEqual({
        hour24: 9,
        minute: 0,
        meridiemKnown: true,
      });
    });
    it('"3:00 de la tarde" → 15:00', () => {
      expect(parseHoraPreferida('3:00 de la tarde')).toEqual({
        hour24: 15,
        minute: 0,
        meridiemKnown: true,
      });
    });
  });

  describe('hora suelta con y sin franja', () => {
    it('"a las 3" → 3, meridiano desconocido', () => {
      expect(parseHoraPreferida('a las 3')).toEqual({
        hour24: 3,
        minute: null,
        meridiemKnown: false,
      });
    });
    it('"a las 3 de la tarde" → 15, conocido', () => {
      expect(parseHoraPreferida('a las 3 de la tarde')).toEqual({
        hour24: 15,
        minute: null,
        meridiemKnown: true,
      });
    });
    it('"a las tres" (palabra) → 3', () => {
      expect(parseHoraPreferida('la quiero a las tres')).toEqual({
        hour24: 3,
        minute: null,
        meridiemKnown: false,
      });
    });
    it('"a las 9 de la mañana" → 9 am', () => {
      expect(parseHoraPreferida('a las 9 de la mañana')).toEqual({
        hour24: 9,
        minute: null,
        meridiemKnown: true,
      });
    });
  });

  describe('fracciones y expresiones', () => {
    it('"a las 3 y media" → 3:30', () => {
      expect(parseHoraPreferida('a las 3 y media')).toEqual({
        hour24: 3,
        minute: 30,
        meridiemKnown: false,
      });
    });
    it('"a las 9 y cuarto de la mañana" → 9:15 am', () => {
      expect(parseHoraPreferida('a las 9 y cuarto de la mañana')).toEqual({
        hour24: 9,
        minute: 15,
        meridiemKnown: true,
      });
    });
    it('"al mediodía" → 12:00', () => {
      expect(parseHoraPreferida('la quiero al mediodía')).toEqual({
        hour24: 12,
        minute: 0,
        meridiemKnown: true,
      });
    });
  });
});

describe('matchesHora (América/Bogotá, UTC−5)', () => {
  // 2026-06-03T20:00:00Z = 15:00 en Bogotá.
  const tresPm = new Date('2026-06-03T20:00:00.000Z');
  // 2026-06-03T14:00:00Z = 09:00 en Bogotá.
  const nueveAm = new Date('2026-06-03T14:00:00.000Z');
  // 2026-06-03T20:30:00Z = 15:30 en Bogotá.
  const tresTreintaPm = new Date('2026-06-03T20:30:00.000Z');

  it('"a las 3 de la tarde" hace match con 15:00', () => {
    expect(matchesHora(tresPm, parseHoraPreferida('3 de la tarde')!)).toBe(true);
  });

  it('"a las 3" (ambiguo) hace match con 15:00 vía +12h', () => {
    expect(matchesHora(tresPm, parseHoraPreferida('a las 3')!)).toBe(true);
  });

  it('"a las 3" NO hace match con 09:00', () => {
    expect(matchesHora(nueveAm, parseHoraPreferida('a las 3')!)).toBe(false);
  });

  it('minuto solo se exige cuando el paciente lo dijo', () => {
    // "a las 3" (sin minuto) matchea 15:00 y 15:30.
    expect(matchesHora(tresPm, parseHoraPreferida('a las 3')!)).toBe(true);
    expect(matchesHora(tresTreintaPm, parseHoraPreferida('a las 3')!)).toBe(
      true,
    );
    // "a las 3 y media" solo matchea 15:30.
    expect(matchesHora(tresPm, parseHoraPreferida('a las 3 y media')!)).toBe(
      false,
    );
    expect(
      matchesHora(tresTreintaPm, parseHoraPreferida('a las 3 y media')!),
    ).toBe(true);
  });
});
