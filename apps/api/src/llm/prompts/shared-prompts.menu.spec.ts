import { buildVocabularyAnchor } from './shared-prompts';

/**
 * Menús que aceptan letra O nombre (servicio, EPS). Caso real del 2026-09-28:
 * una «A» hablada en el menú de servicios salía `ininteligible` porque el LLM
 * no sabía que ahí se esperaba una letra.
 */
describe('buildVocabularyAnchor — menú con letras y nombres', () => {
  const menu = buildVocabularyAnchor({
    letterOptions: ['A', 'B'],
    services: ['Medicina General'],
    menuAcceptsNames: true,
  });

  it('dice qué letras valen y que una letra suelta no es ininteligible', () => {
    expect(menu).toContain('Letras válidas del menú actual: A, B.');
    expect(menu).toMatch(/NO lo marques `ininteligible`/);
  });

  it('acepta el NOMBRE y prohíbe convertirlo en letra (no se sesga contra «Sura»)', () => {
    expect(menu).toMatch(/LETRA de la opción o con su NOMBRE/);
    expect(menu).toMatch(/NO lo conviertas en una letra/);
    // La regla de los horarios («preferir la letra más cercana») NO aplica aquí.
    expect(menu).not.toMatch(/preferir la letra más cercana/);
  });

  it('el catálogo sigue anclado en su bloque', () => {
    expect(menu).toContain(
      'Servicios / especialidades válidas: Medicina General.',
    );
  });

  it('sin la marca, el modo letra de horarios queda EXACTAMENTE como antes', () => {
    const horarios = buildVocabularyAnchor({ letterOptions: ['A', 'B'] });
    expect(horarios).toMatch(/preferir la letra más cercana/);
    expect(horarios).not.toMatch(/NOMBRE/);
    expect(
      buildVocabularyAnchor({
        letterOptions: ['A', 'B'],
        menuAcceptsNames: false,
      }),
    ).toBe(horarios);
  });

  it('la marca sin letras no agrega nada', () => {
    expect(buildVocabularyAnchor({ menuAcceptsNames: true })).toBe('');
  });
});
