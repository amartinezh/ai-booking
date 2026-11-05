import { pideOtroMomentoQueElCupo } from './oferta-otro-momento';

/**
 * 🗓️ 2026-11-05: a una oferta del lunes 9 a la 1:00 p. m., «Me sirve para mañana
 * viernes» se tomó como SÍ y se le agendó el lunes. Hoy es jueves 5 de noviembre.
 */
describe('pideOtroMomentoQueElCupo', () => {
  const AHORA = new Date('2026-11-05T13:23:00Z'); // jueves 5, 8:23 en Bogotá
  const LUNES_1PM = new Date('2026-11-09T18:00:00Z'); // lunes 9, 1:00 p. m.
  const VIERNES_630 = new Date('2026-11-06T11:30:00Z'); // viernes 6, 6:30 a. m.
  const opts = { timeZone: 'America/Bogota', now: AHORA };

  it.each([
    ['Me sirve para mañana viernes', LUNES_1PM], // caso real
    ['Sí, pero el viernes', LUNES_1PM],
    ['Perfecto, para el martes', LUNES_1PM],
    ['Sí, a las 12', LUNES_1PM],
    ['Me sirve, pero más tardecita', VIERNES_630],
    ['Sí, en la tarde', VIERNES_630],
    ['Sí, pero otro día', LUNES_1PM],
  ])('«%s» pide otro momento', (texto, cupo) => {
    expect(pideOtroMomentoQueElCupo(texto, cupo, opts)).toBe(true);
  });

  it.each([
    ['Sí', LUNES_1PM],
    ['Me sirve', LUNES_1PM],
    ['Perfecto, muchas gracias', LUNES_1PM],
    ['Sí, el lunes estoy allá', LUNES_1PM],
    ['Sí, a la 1', LUNES_1PM],
    ['Listo, a la 1 de la tarde', LUNES_1PM],
    ['Sí, mañana temprano', VIERNES_630],
    ['Me sirve para mañana', VIERNES_630],
    ['', LUNES_1PM],
  ])('«%s» no pide otro momento', (texto, cupo) => {
    expect(pideOtroMomentoQueElCupo(texto, cupo, opts)).toBe(false);
  });
});
