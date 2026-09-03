import { PARTICULAR_EPS_NAME, isParticularEps } from './eps';

/**
 * «Particular» decide algo concreto: una cita de pago directo NO exige que el
 * paciente figure en el padrón de la EPS. Esa detección la hacen DOS flujos
 * distintos —el chatbot y el agendamiento manual del staff— y si divergen, un
 * paciente que paga de su bolsillo queda bloqueado en uno de los dos. Por eso
 * la comparación vive aquí y no duplicada en cada lado.
 */
describe('isParticularEps', () => {
  it('el nombre canónico es «Particular»', () => {
    expect(PARTICULAR_EPS_NAME).toBe('Particular');
    expect(isParticularEps(PARTICULAR_EPS_NAME)).toBe(true);
  });

  it.each([
    ['minúsculas', 'particular'],
    ['mayúsculas', 'PARTICULAR'],
    ['mezclado', 'PaRtIcUlAr'],
    ['con espacios alrededor', '  Particular  '],
    ['con tabulación', '\tparticular\n'],
  ])('%s cuenta como Particular', (_e, valor) => {
    expect(isParticularEps(valor)).toBe(true);
  });

  it.each([
    ['una EPS real', 'Nueva EPS'],
    ['un nombre que la contiene', 'Particulares Unidos'],
    ['un prefijo', 'Particu'],
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('%s NO es Particular', (_e, valor) => {
    expect(isParticularEps(valor)).toBe(false);
  });
});
