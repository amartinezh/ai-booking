import { PARTICULAR_EPS_NAME, isParticularEps, faltaRegimenParaElEspejo } from './eps';

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

/**
 * La regla gemela de `resolveConvenio` del driver: si una se mueve y la otra no,
 * vuelve el caso del 2026-09-26 (cita confirmada que el hospital nunca recibió).
 */
describe('faltaRegimenParaElEspejo', () => {
  const base = { espejoActivo: true, epsNit: '800130907', regimen: null };

  it('con espejo, EPS con NIT y sin régimen: falta', () => {
    expect(faltaRegimenParaElEspejo(base)).toBe(true);
  });

  it.each([
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['undefined', undefined],
  ])('un régimen %s cuenta como ausente', (_e, regimen) => {
    expect(faltaRegimenParaElEspejo({ ...base, regimen })).toBe(true);
  });

  it.each(['SUBSIDIADO', 'CONTRIBUTIVO'])('con régimen %s no falta', (regimen) => {
    expect(faltaRegimenParaElEspejo({ ...base, regimen })).toBe(false);
  });

  it('sin espejo activo no aplica', () => {
    expect(faltaRegimenParaElEspejo({ ...base, espejoActivo: false })).toBe(false);
  });

  it.each([
    ['sin NIT (null)', null],
    ['NIT vacío', ''],
    ['NIT en blanco', '  '],
  ])('una EPS %s viaja como particular: no hace falta régimen', (_e, epsNit) => {
    expect(faltaRegimenParaElEspejo({ ...base, epsNit })).toBe(false);
  });
});
