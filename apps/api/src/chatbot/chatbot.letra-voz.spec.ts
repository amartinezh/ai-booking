import { ChatbotService } from './chatbot.service';

/**
 * `extractOptionLetter`: una letra repetida («A a», «be, be») elige esa letra.
 * Es lo que transcribe el STT cuando el paciente repite la letra para que se
 * le entienda (caso real en el menú de servicios, 2026-09-28). Solo si TODAS
 * las palabras son la misma letra: lo demás no elige nada.
 */
describe('ChatbotService.extractOptionLetter — letra repetida', () => {
  const letra = (t: string | null) =>
    (ChatbotService.prototype as any).extractOptionLetter.call({}, t) as string;

  it.each([
    ['A a', 'A'],
    ['a, a', 'A'],
    ['A. A. A.', 'A'],
    ['be be', 'B'],
    ['Be, be', 'B'],
    ['ce ce', 'C'],
    ['ah a', 'A'],
  ])('%p → %p', (entrada, esperada) => {
    expect(letra(entrada)).toBe(esperada);
  });

  it.each([
    'a b',
    'a medicina',
    'Medicina general',
    'Sura',
    'Nueva EPS',
    'a a a a',
    'quiero la a y la b',
    '',
  ])('%p no elige ninguna letra', (entrada) => {
    expect(letra(entrada)).toBe('');
  });

  it('lo que ya funcionaba sigue igual', () => {
    expect(letra('A')).toBe('A');
    expect(letra('la a')).toBe('A');
    expect(letra('la opción b')).toBe('B');
    expect(letra('be')).toBe('B');
    expect(letra('segunda')).toBe('B');
    expect(letra(null)).toBe('');
  });
});
