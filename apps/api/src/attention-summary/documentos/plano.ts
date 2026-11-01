/**
 * 📐 El plano de una hoja: qué texto, línea o imagen va y dónde (en puntos,
 * 1/72 de pulgada, con el origen arriba a la izquierda).
 *
 * El PDF y la imagen se dibujan del MISMO plano (render-pdf.ts y
 * render-imagen.ts): por construcción dicen lo mismo, renglón por renglón, que
 * es lo que pide el plan (§3.9: «la imagen sale del mismo PDF, nunca dicen cosas
 * distintas»). El maquetador parte los textos en renglones con la medida real
 * de la letra que usan los dos.
 */

/** Hoja carta (21,6 × 27,9 cm) con márgenes de 1,5 cm. */
export const HOJA = { ancho: 612, alto: 792, margen: 42.5 } as const;

/** Letra del cuerpo: el plan pide 10 puntos como mínimo (el HIS usa ~7). */
export const TAM = {
  cuerpo: 10,
  seccion: 11,
  titulo: 13,
  hospital: 12,
  marca: 44,
} as const;

const INTERLINEADO = 1.32;

export interface Medidor {
  /** Ancho en puntos de `texto` con la letra del documento. */
  ancho(texto: string, tam: number, negrita: boolean): number;
}

export type Elemento =
  | {
      tipo: 'texto';
      x: number;
      /** Línea base del renglón (no el borde de arriba): los dos motores la ubican igual. */
      base: number;
      texto: string;
      tam: number;
      negrita: boolean;
    }
  | {
      tipo: 'linea';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      grosor: number;
    }
  | {
      tipo: 'imagen';
      x: number;
      y: number;
      ancho: number;
      alto: number;
      datos: Buffer;
    }
  /** Marca de agua en diagonal, centrada en la hoja y detrás de todo. */
  | { tipo: 'marca'; texto: string };

export type Hoja = Elemento[];

export interface Trozo {
  texto: string;
  negrita?: boolean;
}

interface Renglon {
  alto: number;
  dibujar(y: number): Elemento[];
}

export interface OpcionesParrafo {
  tam?: number;
  negrita?: boolean;
  /** Corre todo el párrafo hacia la derecha. */
  sangria?: number;
  /** Viñeta «• » con los renglones siguientes alineados al texto. */
  vineta?: boolean;
  /** Ancho disponible; por defecto, el de la columna del bloque. */
  ancho?: number;
  /** Alineado a la derecha (solo para textos de un renglón). */
  derecha?: boolean;
}

const aTrozos = (c: string | Trozo[], negrita: boolean): Trozo[] =>
  typeof c === 'string' ? [{ texto: c, negrita }] : c;

/**
 * Un bloque de renglones ya medidos que se coloca de una vez (para que, por
 * ejemplo, un medicamento no quede partido entre dos hojas).
 */
export class Bloque {
  readonly renglones: Renglon[] = [];

  constructor(
    private readonly medidor: Medidor,
    private readonly izquierda: number,
    private readonly anchoColumna: number,
  ) {}

  get alto(): number {
    return this.renglones.reduce((n, r) => n + r.alto, 0);
  }

  espacio(alto: number): this {
    this.renglones.push({ alto, dibujar: () => [] });
    return this;
  }

  linea(grosor = 0.6, aire = 4): this {
    const x1 = this.izquierda;
    const x2 = this.izquierda + this.anchoColumna;
    this.renglones.push({
      alto: aire * 2,
      dibujar: (y) => [
        { tipo: 'linea', x1, y1: y + aire, x2, y2: y + aire, grosor },
      ],
    });
    return this;
  }

  parrafo(contenido: string | Trozo[], o: OpcionesParrafo = {}): this {
    const tam = o.tam ?? TAM.cuerpo;
    const sangria = o.sangria ?? 0;
    const vineta = o.vineta ? '• ' : '';
    const anchoVineta = vineta ? this.medidor.ancho(vineta, tam, false) : 0;
    const x0 = this.izquierda + sangria;
    const ancho = (o.ancho ?? this.anchoColumna) - sangria - anchoVineta;
    const lineas = partirEnRenglones(
      this.medidor,
      aTrozos(contenido, o.negrita ?? false),
      tam,
      ancho,
    );
    const alto = tam * INTERLINEADO;

    lineas.forEach((linea, i) => {
      const xTexto = x0 + anchoVineta;
      const anchoLinea = linea.reduce(
        (n, t) => n + this.medidor.ancho(t.texto, tam, !!t.negrita),
        0,
      );
      const inicio = o.derecha
        ? this.izquierda + (o.ancho ?? this.anchoColumna) - anchoLinea
        : xTexto;
      this.renglones.push({
        alto,
        dibujar: (y) => {
          const base = y + tam;
          const els: Elemento[] = [];
          if (vineta && i === 0)
            els.push({
              tipo: 'texto',
              x: x0,
              base,
              texto: '•',
              tam,
              negrita: false,
            });
          let x = inicio;
          for (const t of linea) {
            if (t.texto)
              els.push({
                tipo: 'texto',
                x,
                base,
                texto: t.texto,
                tam,
                negrita: !!t.negrita,
              });
            x += this.medidor.ancho(t.texto, tam, !!t.negrita);
          }
          return els;
        },
      });
    });
    return this;
  }

  /**
   * «Etiqueta: valor» en columnas. Cada celda se parte en renglones dentro de su
   * columna; la fila mide lo de su celda más alta. Los valores vacíos no salen.
   */
  campos(
    pares: [string, string | number | null | undefined][],
    columnas = 2,
    tam: number = TAM.cuerpo,
  ): this {
    const llenos = pares.filter(
      ([, v]) => v !== null && v !== undefined && String(v).trim() !== '',
    );
    const separacion = 12;
    const anchoCelda =
      (this.anchoColumna - separacion * (columnas - 1)) / columnas;
    const alto = tam * INTERLINEADO;
    for (let i = 0; i < llenos.length; i += columnas) {
      const fila = llenos
        .slice(i, i + columnas)
        .map(([etiqueta, valor]) =>
          partirEnRenglones(
            this.medidor,
            [
              { texto: `${etiqueta}: `, negrita: true },
              { texto: String(valor).trim() },
            ],
            tam,
            anchoCelda,
          ),
        );
      const renglonesFila = Math.max(...fila.map((c) => c.length));
      for (let r = 0; r < renglonesFila; r++) {
        this.renglones.push({
          alto,
          dibujar: (y) => {
            const els: Elemento[] = [];
            fila.forEach((celda, c) => {
              const linea = celda[r];
              if (!linea) return;
              let x = this.izquierda + c * (anchoCelda + separacion);
              for (const t of linea) {
                if (t.texto)
                  els.push({
                    tipo: 'texto',
                    x,
                    base: y + tam,
                    texto: t.texto,
                    tam,
                    negrita: !!t.negrita,
                  });
                x += this.medidor.ancho(t.texto, tam, !!t.negrita);
              }
            });
            return els;
          },
        });
      }
    }
    return this;
  }

  /** Un renglón con elementos ya ubicados (el logo, por ejemplo). */
  fijo(alto: number, dibujar: (y: number) => Elemento[]): this {
    this.renglones.push({ alto, dibujar });
    return this;
  }
}

/**
 * Parte los trozos en renglones de a lo sumo `ancho` puntos, palabra por
 * palabra; una palabra más larga que el renglón se parte por letras. Respeta
 * los saltos de línea del texto (el médico los escribe en la historia).
 */
export function partirEnRenglones(
  medidor: Medidor,
  trozos: Trozo[],
  tam: number,
  ancho: number,
): Trozo[][] {
  type Pieza = { texto: string; negrita: boolean; salto?: boolean };
  const piezas: Pieza[] = [];
  for (const t of trozos) {
    const negrita = !!t.negrita;
    const lineas = t.texto.replace(/\r\n?/g, '\n').split('\n');
    lineas.forEach((l, i) => {
      if (i > 0) piezas.push({ texto: '', negrita, salto: true });
      // Conserva los espacios como piezas aparte para medirlos.
      for (const p of l.split(/(\s+)/))
        if (p) piezas.push({ texto: p.replace(/\s+/g, ' '), negrita });
    });
  }

  const renglones: Trozo[][] = [];
  let actual: Trozo[] = [];
  let usado = 0;
  const cerrar = () => {
    // Sin espacios colgando al final del renglón.
    while (actual.length) {
      const ultimo = actual[actual.length - 1];
      ultimo.texto = ultimo.texto.trimEnd();
      if (ultimo.texto) break;
      actual.pop();
    }
    renglones.push(actual);
    actual = [];
    usado = 0;
  };
  const agregar = (texto: string, negrita: boolean) => {
    const ultimo = actual[actual.length - 1];
    if (ultimo && !!ultimo.negrita === negrita) ultimo.texto += texto;
    else actual.push({ texto, negrita });
    usado += medidor.ancho(texto, tam, negrita);
  };

  for (const p of piezas) {
    if (p.salto) {
      cerrar();
      continue;
    }
    const w = medidor.ancho(p.texto, tam, p.negrita);
    const esEspacio = !p.texto.trim();
    if (esEspacio) {
      if (usado > 0 && usado + w <= ancho) agregar(p.texto, p.negrita);
      continue;
    }
    if (usado + w <= ancho) {
      agregar(p.texto, p.negrita);
      continue;
    }
    if (usado > 0) cerrar();
    if (w <= ancho) {
      agregar(p.texto, p.negrita);
      continue;
    }
    // Palabra más larga que el renglón: se parte por letras.
    let resto = p.texto;
    while (resto) {
      let n = resto.length;
      while (n > 1 && medidor.ancho(resto.slice(0, n), tam, p.negrita) > ancho)
        n--;
      agregar(resto.slice(0, n), p.negrita);
      resto = resto.slice(n);
      if (resto) cerrar();
    }
  }
  if (actual.length || renglones.length === 0) cerrar();
  return renglones;
}

/**
 * Coloca bloques en hojas. Entre `arriba` y `abajo` va el cuerpo; el encabezado
 * y el pie se agregan después, cuando ya se sabe cuántas hojas son.
 */
export class Maquetador {
  private readonly hojas: Hoja[] = [];
  private y = 0;

  constructor(
    readonly medidor: Medidor,
    private readonly arriba: number,
    private readonly abajo: number,
    readonly izquierda: number = HOJA.margen,
    readonly ancho: number = HOJA.ancho - 2 * HOJA.margen,
  ) {
    this.nuevaHoja();
  }

  bloque(): Bloque {
    return new Bloque(this.medidor, this.izquierda, this.ancho);
  }

  private nuevaHoja(): void {
    this.hojas.push([]);
    this.y = this.arriba;
  }

  private get hojaVacia(): boolean {
    return this.y === this.arriba;
  }

  /**
   * Pone el bloque. Si `junto` y no cabe en lo que queda pero sí en una hoja
   * entera, empieza en la siguiente; si es más largo que una hoja, se parte.
   */
  colocar(b: Bloque, { junto = true }: { junto?: boolean } = {}): void {
    const restante = this.abajo - this.y;
    if (
      junto &&
      b.alto > restante &&
      b.alto <= this.abajo - this.arriba &&
      !this.hojaVacia
    )
      this.nuevaHoja();
    for (const r of b.renglones) {
      if (r.alto > this.abajo - this.y && !this.hojaVacia) this.nuevaHoja();
      // Un espacio al empezar la hoja no sirve de nada.
      if (this.hojaVacia && this.esEspacio(r)) continue;
      this.hojas[this.hojas.length - 1].push(...r.dibujar(this.y));
      this.y += r.alto;
    }
  }

  private esEspacio(r: Renglon): boolean {
    return r.dibujar(0).length === 0;
  }

  terminar(): Hoja[] {
    return this.hojas;
  }
}
