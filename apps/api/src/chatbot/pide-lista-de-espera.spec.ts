import { pideListaDeEspera } from './pide-lista-de-espera';

describe('pideListaDeEspera — anotarse en la lista desde el menú de horarios', () => {
  it.each([
    'lista de espera', // caso real, 2026-11-17
    'Lista de espera',
    'quiero la lista de espera',
    'Anóteme en la lista',
    'apúntenme en la lista de espera por favor',
    'me pone en la lista',
    'lista espera',
  ])('«%s» → sí', (frase) => {
    expect(pideListaDeEspera(frase)).toBe(true);
  });

  it.each([
    'no quiero lista de espera',
    'No me anote en la lista',
    'A',
    'otra',
    'Otro día',
    'la de las 6',
    'listo',
    'espera un momento',
    '',
    null,
  ])('«%s» → no', (frase) => {
    expect(pideListaDeEspera(frase)).toBe(false);
  });
});
