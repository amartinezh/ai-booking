import { reconocerEps } from './eps-colombia';

/**
 * Distingue «nombró una EPS real que la clínica no atiende» (se le ofrece cita
 * particular) de «escribió algo que no entendí» (se le repite el menú). Un falso
 * positivo le ofrecería particular a quien no nombró ninguna EPS; un falso negativo
 * lo deja en el bucle de reintentos. Y una EPS nombrada nunca se «acerca» a otra.
 */
describe('reconocerEps', () => {
  it.each([
    ['Coomeva', 'Coomeva'],
    ['tengo coomeva', 'Coomeva'],
    ['Mi EPS es la NUEVA EPS', 'Nueva EPS'],
    ['nueva e.p.s.', 'Nueva EPS'],
    ['SALUD TOTAL', 'Salud Total'],
    ['saludtotal', 'Salud Total'],
    ['eps sura', 'Sura'],
    ['Famisanar!!', 'Famisanar'],
    ['Asmet Salud', 'Asmet Salud'],
    ['Salud Mía', 'Salud Mía'],
    ['soy del magisterio', 'Magisterio (FOMAG)'],
    ['FOMAG', 'Magisterio (FOMAG)'],
    ['la S.O.S.', 'S.O.S. (Servicio Occidental de Salud)'],
    ['eps compensar', 'Compensar'],
    ['Emssanar', 'Emssanar'],
  ])('«%s» → %s', (texto, nombre) => {
    expect(reconocerEps(texto)).toBe(nombre);
  });

  it.each([
    ['vacío', ''],
    ['nulo', null],
    ['una letra del menú', 'B'],
    ['un saludo', 'hola buenas tardes'],
    ['particular', 'particular'],
    ['una palabra suelta', 'salud'],
    ['una palabra que contiene un alias', 'surabaya'],
    ['«compensar» como verbo', 'quiero compensar la cita'],
    ['«comparta» como verbo', 'comparta su ubicación'],
    ['«sos» suelto', 'sos'],
    ['el SISBÉN no es una EPS', 'tengo sisben'],
  ])('%s no es una EPS', (_caso, texto) => {
    expect(reconocerEps(texto)).toBeNull();
  });

  it('los nombres de las EPS de una clínica se reconocen igual que lo que escribe el paciente', () => {
    // Así se sabe si la EPS nombrada ESTÁ en el menú aunque se llame distinto.
    expect(reconocerEps('EPS SURA')).toBe(reconocerEps('sura'));
    expect(reconocerEps('Asociación Mutual Ser')).toBe(reconocerEps('mutualser'));
    expect(reconocerEps('NUEVA EPS S.A.')).toBe(reconocerEps('nueva eps'));
  });
});
