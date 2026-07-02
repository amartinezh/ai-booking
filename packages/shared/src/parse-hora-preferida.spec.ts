import { parseHoraPreferida, matchesHora } from './parse-hora-preferida';

describe('parseHoraPreferida', () => {
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
