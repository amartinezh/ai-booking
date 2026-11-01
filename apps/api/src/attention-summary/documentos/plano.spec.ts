import { Maquetador, partirEnRenglones, type Medidor } from './plano';

// El maquetador: parte en renglones con la medida de la letra y reparte en
// hojas sin partir un bloque que cabe entero. Un medidor de ancho fijo (5
// puntos por letra) hace las cuentas exactas.
const medidor: Medidor = { ancho: (t) => t.length * 5 };
const texto = (r: { texto: string }[]) => r.map((t) => t.texto).join('');

describe('partirEnRenglones', () => {
  it('parte por palabras sin espacios colgando', () => {
    const r = partirEnRenglones(
      medidor,
      [{ texto: 'uno dos tres cuatro' }],
      10,
      40,
    );
    expect(r.map(texto)).toEqual(['uno dos', 'tres', 'cuatro']);
  });

  it('respeta los saltos de línea del médico y parte una palabra que no cabe', () => {
    const r = partirEnRenglones(medidor, [{ texto: 'AB\nABCDEFGHIJ' }], 10, 25);
    expect(r.map(texto)).toEqual(['AB', 'ABCDE', 'FGHIJ']);
  });

  it('conserva la negrita de cada trozo dentro del renglón', () => {
    const [r] = partirEnRenglones(
      medidor,
      [{ texto: 'Vía: ', negrita: true }, { texto: 'ORAL' }],
      10,
      200,
    );
    expect(r).toEqual([
      { texto: 'Vía: ', negrita: true },
      { texto: 'ORAL', negrita: false },
    ]);
  });

  it('un texto vacío da un renglón vacío (no desaparece)', () => {
    expect(partirEnRenglones(medidor, [{ texto: '' }], 10, 50)).toEqual([[]]);
  });
});

describe('Maquetador', () => {
  // Renglones de 10 * 1,32 = 13,2 puntos; cuerpo de 100 puntos = 7 renglones.
  const nuevo = () => new Maquetador(medidor, 0, 100, 0, 500);

  it('un bloque que no cabe en lo que queda empieza en la hoja siguiente', () => {
    const m = nuevo();
    m.colocar(m.bloque().parrafo('a\nb\nc\nd\ne'));
    m.colocar(m.bloque().parrafo('f\ng\nh'));
    const hojas = m.terminar();
    expect(hojas).toHaveLength(2);
    expect(
      hojas[1].map((e) => (e.tipo === 'texto' ? e.texto : '')).join(''),
    ).toBe('fgh');
  });

  it('un bloque más largo que una hoja se parte renglón por renglón', () => {
    const m = nuevo();
    m.colocar(
      m
        .bloque()
        .parrafo(Array.from({ length: 10 }, (_, i) => `r${i}`).join('\n')),
    );
    const hojas = m.terminar();
    expect(hojas.map((h) => h.length)).toEqual([7, 3]);
  });

  it('un espacio no abre una hoja nueva', () => {
    const m = nuevo();
    m.colocar(m.bloque().parrafo('a\nb\nc\nd\ne\nf\ng'));
    m.colocar(m.bloque().espacio(10).parrafo('h'), { junto: false });
    const [, segunda] = m.terminar();
    expect(segunda).toEqual([
      expect.objectContaining({ texto: 'h', base: 10 }),
    ]);
  });

  it('«Etiqueta: valor» en columnas, sin los vacíos', () => {
    const m = nuevo();
    m.colocar(
      m.bloque().campos(
        [
          ['A', '1'],
          ['B', null],
          ['C', '3'],
        ],
        2,
      ),
    );
    const textos = m
      .terminar()[0]
      .map((e) => (e.tipo === 'texto' ? `${e.texto}@${Math.round(e.x)}` : ''));
    expect(textos).toEqual(['A: @0', '1@15', 'C: @256', '3@271']);
  });
});
