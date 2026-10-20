import type {
  CategoriaAyuda,
  ContenidoAyuda,
  GuiaAyuda,
  PortadaAyuda,
  PreguntaAyuda,
  ProblemaAyuda,
  TemaAyuda,
  TerminoGlosario,
} from './conocimiento-tipos';

// ─────────────────────────────────────────────────────────────
// LECTOR DEL ARCHIVO DE CONOCIMIENTO (docs/conocimiento/AGENIA.md).
//
// El centro de ayuda no tiene texto propio: todo lo que muestra sale de la
// parte del .md que va entre `<!-- AYUDA:INICIO -->` y `<!-- AYUDA:FIN -->`.
// El resto del archivo (cómo funciona el sistema por dentro, la bitácora) no
// se muestra en la página.
//
// El formato es Markdown corriente con unas pocas reglas fijas (están en
// docs/conocimiento/README.md):
//
//   ## Portada                          presentación y búsquedas frecuentes
//   ## Categoría: Título {#id}          una categoría; su párrafo es la descripción
//   ### 🚀 Título {#id}                 un tema (icono, título del menú, id)
//   - **Ruta:** `/dashboard/…`          ficha del tema (Ruta, Resumen,
//                                       Disponibilidad, Relacionados, Palabras clave)
//   #### Para qué sirve | Paso a paso | Qué ves en la pantalla |
//        Preguntas frecuentes | Si algo no sale bien
//   ##### Título de guía / pregunta / síntoma
//   ## Glosario {#glosario}             - **Término:** definición
//
// El texto se muestra tal cual: no se interpretan negritas ni enlaces dentro
// de un párrafo. Ante algo que no encaja, se lanza un error con la línea, para
// que una edición mal hecha no deje la ayuda a medias sin que nadie lo note.
// ─────────────────────────────────────────────────────────────

export const MARCA_INICIO = '<!-- AYUDA:INICIO -->';
export const MARCA_FIN = '<!-- AYUDA:FIN -->';

export class ErrorDeConocimiento extends Error {
  readonly linea: number;

  constructor(linea: number, mensaje: string) {
    super(`línea ${linea}: ${mensaje}`);
    this.name = 'ErrorDeConocimiento';
    this.linea = linea;
  }
}

// ── 1. Bloques de Markdown ─────────────────────────────────

interface Item {
  texto: string;
  linea: number;
}

type Bloque =
  | { tipo: 'titulo'; nivel: number; texto: string; linea: number }
  | { tipo: 'parrafo'; texto: string; linea: number }
  | { tipo: 'vineta'; texto: string; linea: number; sub: Item[] }
  | { tipo: 'numerado'; texto: string; linea: number }
  | { tipo: 'cita'; texto: string; linea: number };

/**
 * Parte las líneas en bloques: títulos, párrafos, viñetas (con un nivel de
 * subviñetas), pasos numerados y citas. Las líneas seguidas de un párrafo se
 * unen con un espacio, y una línea con sangría continúa la viñeta o el paso
 * anterior. Los comentarios `<!-- … -->` y las líneas `---` se ignoran.
 */
function bloquesDe(lineas: string[], primeraLinea: number): Bloque[] {
  const bloques: Bloque[] = [];
  // El bloque que puede recibir la línea siguiente como continuación.
  let abierto: Item | null = null;
  let ultimaVineta: Extract<Bloque, { tipo: 'vineta' }> | null = null;
  let enComentario = false;

  lineas.forEach((cruda, i) => {
    const n = primeraLinea + i;
    const l = cruda.replace(/\s+$/, '');

    if (enComentario) {
      if (l.includes('-->')) enComentario = false;
      return;
    }
    if (/^\s*<!--/.test(l)) {
      enComentario = !l.includes('-->');
      abierto = null;
      return;
    }
    if (l.trim() === '' || /^(-{3,}|\*{3,}|_{3,})$/.test(l)) {
      abierto = null;
      if (l.trim() !== '') ultimaVineta = null;
      return;
    }

    const titulo = /^(#{1,6})\s+(.+?)(\s+#+)?$/.exec(l);
    if (titulo) {
      bloques.push({
        tipo: 'titulo',
        nivel: titulo[1].length,
        texto: titulo[2].trim(),
        linea: n,
      });
      abierto = null;
      ultimaVineta = null;
      return;
    }

    const numerado = /^\d+[.)]\s+(.+)$/.exec(l);
    if (numerado) {
      const b: Bloque = {
        tipo: 'numerado',
        texto: numerado[1].trim(),
        linea: n,
      };
      bloques.push(b);
      abierto = b;
      ultimaVineta = null;
      return;
    }

    const vineta = /^[-*+]\s+(.+)$/.exec(l);
    if (vineta) {
      const b: Extract<Bloque, { tipo: 'vineta' }> = {
        tipo: 'vineta',
        texto: vineta[1].trim(),
        linea: n,
        sub: [],
      };
      bloques.push(b);
      abierto = b;
      ultimaVineta = b;
      return;
    }

    const subvineta = /^\s+[-*+]\s+(.+)$/.exec(l);
    if (subvineta) {
      if (!ultimaVineta)
        throw new ErrorDeConocimiento(n, 'subviñeta sin una viñeta encima.');
      const item: Item = { texto: subvineta[1].trim(), linea: n };
      ultimaVineta.sub.push(item);
      abierto = item;
      return;
    }

    const cita = /^>\s?(.*)$/.exec(l);
    if (cita) {
      const ultimo = bloques[bloques.length - 1];
      if (abierto && ultimo?.tipo === 'cita' && abierto === ultimo) {
        ultimo.texto = `${ultimo.texto} ${cita[1].trim()}`.trim();
      } else {
        const b: Bloque = { tipo: 'cita', texto: cita[1].trim(), linea: n };
        bloques.push(b);
        abierto = b;
      }
      ultimaVineta = null;
      return;
    }

    // Continuación: con sangría, de la viñeta o el paso; sin sangría, del párrafo.
    const conSangria = /^\s/.test(l);
    if (
      abierto &&
      (conSangria ||
        (bloques[bloques.length - 1] === abierto &&
          bloques[bloques.length - 1].tipo === 'parrafo'))
    ) {
      (abierto as Item).texto = `${(abierto as Item).texto} ${l.trim()}`;
      return;
    }

    const b: Bloque = { tipo: 'parrafo', texto: l.trim(), linea: n };
    bloques.push(b);
    abierto = b;
    ultimaVineta = null;
  });

  return bloques;
}

// ── 2. Piezas de una línea ─────────────────────────────────

/** `**Clave:** valor` → { clave, valor }. */
function campo(
  texto: string,
  linea: number,
  que: string,
): { clave: string; valor: string } {
  const m = /^\*\*(.+?):\*\*\s*(.*)$/.exec(texto);
  if (!m)
    throw new ErrorDeConocimiento(
      linea,
      `${que}: se esperaba «**Nombre:** texto» y llegó «${texto}».`,
    );
  const valor = m[2].trim();
  if (!valor)
    throw new ErrorDeConocimiento(linea, `${que}: «${m[1]}» está vacío.`);
  return { clave: m[1].trim(), valor };
}

/** «a, b, c» → ['a', 'b', 'c']. */
function lista(valor: string): string[] {
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «[Título](#id), [Otro](#otro)» → ['id', 'otro']. */
function enlaces(valor: string, linea: number, que: string): string[] {
  const ids: string[] = [];
  const resto = valor.replace(
    /\[[^\]]+\]\(#([a-z0-9-]+)\)/g,
    (_, id: string) => {
      ids.push(id);
      return '';
    },
  );
  if (ids.length === 0 || resto.replace(/[,\s]/g, '') !== '') {
    throw new ErrorDeConocimiento(
      linea,
      `${que}: usa enlaces «[Título](#id)» separados por comas.`,
    );
  }
  return ids;
}

/** «Título {#id}» → { texto, id }. */
function conId(
  texto: string,
  linea: number,
  que: string,
): { texto: string; id: string } {
  const m = /^(.+?)\s*\{#([a-z0-9-]+)\}$/.exec(texto);
  if (!m)
    throw new ErrorDeConocimiento(
      linea,
      `${que}: al final del título va su id, así: «${texto} {#mi-id}» (minúsculas, números y guiones).`,
    );
  return { texto: m[1].trim(), id: m[2] };
}

const unir = (antes: string, despues: string) =>
  antes ? `${antes} ${despues}` : despues;

// ── 3. El documento ────────────────────────────────────────

type Seccion =
  | 'ficha'
  | 'paraQue'
  | 'pasos'
  | 'pantalla'
  | 'preguntas'
  | 'problemas';

const SECCIONES: Record<string, Seccion> = {
  'Para qué sirve': 'paraQue',
  'Paso a paso': 'pasos',
  'Qué ves en la pantalla': 'pantalla',
  'Preguntas frecuentes': 'preguntas',
  'Si algo no sale bien': 'problemas',
};

const NOMBRES_SECCIONES = Object.keys(SECCIONES)
  .map((s) => `«${s}»`)
  .join(', ');

/**
 * Convierte el archivo de conocimiento en el contenido del centro de ayuda.
 * Lanza `ErrorDeConocimiento` (con la línea) si la parte de la ayuda no sigue
 * el formato. No revisa que los enlaces apunten a temas que existen ni que
 * cada opción del menú tenga su tema: eso lo hace `validarConocimiento`.
 */
export function parsearConocimiento(markdown: string): ContenidoAyuda {
  const lineas = markdown.replace(/\r\n?/g, '\n').split('\n');
  const inicio = lineas.findIndex((l) => l.trim() === MARCA_INICIO);
  const fin = lineas.findIndex((l) => l.trim() === MARCA_FIN);
  if (inicio === -1)
    throw new ErrorDeConocimiento(
      1,
      `falta la marca ${MARCA_INICIO}, que abre la parte que lee la ayuda.`,
    );
  if (fin === -1)
    throw new ErrorDeConocimiento(
      inicio + 1,
      `falta la marca ${MARCA_FIN}, que cierra la parte que lee la ayuda.`,
    );
  if (fin < inicio)
    throw new ErrorDeConocimiento(
      fin + 1,
      `${MARCA_FIN} aparece antes que ${MARCA_INICIO}.`,
    );
  if (
    lineas
      .slice(inicio + 1)
      .some(
        (l, i) =>
          i + inicio + 1 !== fin &&
          (l.trim() === MARCA_INICIO || l.trim() === MARCA_FIN),
      )
  ) {
    throw new ErrorDeConocimiento(
      inicio + 1,
      'las marcas de la ayuda deben aparecer una sola vez.',
    );
  }

  const portada: Partial<PortadaAyuda> = {};
  const categorias: CategoriaAyuda[] = [];
  const temas: TemaAyuda[] = [];
  const glosario: TerminoGlosario[] = [];

  let zona: 'antes' | 'portada' | 'categoria' | 'glosario' = 'antes';
  let categoria: CategoriaAyuda | null = null;
  let tema: TemaAyuda | null = null;
  let seccion: Seccion | null = null;
  let seccionesVistas = new Set<Seccion>();
  let guia: GuiaAyuda | null = null;
  let pregunta: PreguntaAyuda | null = null;
  let problema: ProblemaAyuda | null = null;
  let lineaDelTema = 0;

  const cerrarTema = () => {
    if (!tema) return;
    if (!tema.resumen)
      throw new ErrorDeConocimiento(
        lineaDelTema,
        `«${tema.titulo}» no tiene «**Resumen:**».`,
      );
    if (!tema.paraQueSirve)
      throw new ErrorDeConocimiento(
        lineaDelTema,
        `«${tema.titulo}» no tiene la sección «#### Para qué sirve».`,
      );
    for (const g of tema.guias) {
      if (g.pasos.length === 0)
        throw new ErrorDeConocimiento(
          lineaDelTema,
          `la guía «${g.titulo}» de «${tema.titulo}» no tiene pasos numerados.`,
        );
    }
    for (const p of tema.preguntas) {
      if (!p.respuesta)
        throw new ErrorDeConocimiento(
          lineaDelTema,
          `la pregunta «${p.pregunta}» de «${tema.titulo}» no tiene respuesta.`,
        );
    }
    for (const p of tema.problemas) {
      if (!p.solucion)
        throw new ErrorDeConocimiento(
          lineaDelTema,
          `«${p.sintoma}» de «${tema.titulo}» no dice qué hacer.`,
        );
    }
    tema = null;
    seccion = null;
    guia = pregunta = problema = null;
  };

  for (const b of bloquesDe(lineas.slice(inicio + 1, fin), inicio + 2)) {
    // ── Títulos: cambian de zona, de tema o de sección ──
    if (b.tipo === 'titulo') {
      if (b.nivel === 1 || b.nivel === 6)
        throw new ErrorDeConocimiento(
          b.linea,
          `dentro de la ayuda no van títulos de nivel ${b.nivel}.`,
        );

      if (b.nivel === 2) {
        cerrarTema();
        if (b.texto === 'Portada') {
          zona = 'portada';
          categoria = null;
        } else if (b.texto.startsWith('Categoría:')) {
          const { texto, id } = conId(
            b.texto.slice('Categoría:'.length).trim(),
            b.linea,
            'categoría',
          );
          if (categorias.some((c) => c.id === id))
            throw new ErrorDeConocimiento(
              b.linea,
              `la categoría «${id}» está repetida.`,
            );
          categoria = { id, titulo: texto, descripcion: '' };
          categorias.push(categoria);
          zona = 'categoria';
        } else if (/^Glosario\s*\{#glosario\}$/.test(b.texto)) {
          zona = 'glosario';
          categoria = null;
        } else {
          throw new ErrorDeConocimiento(
            b.linea,
            `título «## ${b.texto}» desconocido: se esperaba «## Portada», «## Categoría: Título {#id}» o «## Glosario {#glosario}».`,
          );
        }
        continue;
      }

      if (b.nivel === 3) {
        if (zona !== 'categoria' || !categoria)
          throw new ErrorDeConocimiento(
            b.linea,
            'un tema («### …») va dentro de una categoría.',
          );
        cerrarTema();
        const { texto, id } = conId(b.texto, b.linea, 'tema');
        const m = /^(\S+)\s+(.+)$/.exec(texto);
        if (!m)
          throw new ErrorDeConocimiento(
            b.linea,
            `el tema empieza con su icono y luego el título: «### 📋 Título {#id}».`,
          );
        if (temas.some((t) => t.id === id) || id === 'glosario')
          throw new ErrorDeConocimiento(
            b.linea,
            `el id «${id}» está repetido o reservado.`,
          );
        tema = {
          id,
          titulo: m[2],
          icono: m[1],
          categoria: categoria.id,
          resumen: '',
          paraQueSirve: '',
          guias: [],
          elementos: [],
          preguntas: [],
          problemas: [],
          relacionados: [],
          palabrasClave: [],
        };
        temas.push(tema);
        lineaDelTema = b.linea;
        seccion = 'ficha';
        seccionesVistas = new Set();
        continue;
      }

      if (b.nivel === 4) {
        if (!tema)
          throw new ErrorDeConocimiento(
            b.linea,
            'una sección («#### …») va dentro de un tema.',
          );
        const s = SECCIONES[b.texto];
        if (!s)
          throw new ErrorDeConocimiento(
            b.linea,
            `sección «${b.texto}» desconocida. Las secciones son: ${NOMBRES_SECCIONES}.`,
          );
        if (seccionesVistas.has(s))
          throw new ErrorDeConocimiento(
            b.linea,
            `la sección «${b.texto}» está repetida en «${(tema as TemaAyuda).titulo}».`,
          );
        seccionesVistas.add(s);
        seccion = s;
        guia = pregunta = problema = null;
        continue;
      }

      // Nivel 5: una guía, una pregunta o un problema, según la sección.
      const actual = tema as TemaAyuda | null;
      if (
        !actual ||
        (seccion !== 'pasos' &&
          seccion !== 'preguntas' &&
          seccion !== 'problemas')
      ) {
        throw new ErrorDeConocimiento(
          b.linea,
          '«##### …» va dentro de «Paso a paso», «Preguntas frecuentes» o «Si algo no sale bien».',
        );
      }
      if (seccion === 'pasos') {
        guia = { titulo: b.texto, pasos: [] };
        actual.guias.push(guia);
      } else if (seccion === 'preguntas') {
        pregunta = { pregunta: b.texto, respuesta: '' };
        actual.preguntas.push(pregunta);
      } else {
        problema = { sintoma: b.texto, solucion: '' };
        actual.problemas.push(problema);
      }
      continue;
    }

    if (b.tipo === 'vineta' && b.sub.length > 0 && zona !== 'glosario') {
      throw new ErrorDeConocimiento(b.sub[0].linea, 'aquí no van subviñetas.');
    }

    // ── Contenido según dónde estamos ──
    if (zona === 'antes') {
      throw new ErrorDeConocimiento(
        b.linea,
        'la ayuda empieza con «## Portada».',
      );
    }

    if (zona === 'portada') {
      if (b.tipo !== 'vineta')
        throw new ErrorDeConocimiento(
          b.linea,
          'la portada solo lleva viñetas «- **Nombre:** texto».',
        );
      const { clave, valor } = campo(b.texto, b.linea, 'portada');
      if (clave === 'Presentación') portada.presentacion = valor;
      else if (clave === 'Búsquedas frecuentes')
        portada.busquedasFrecuentes = lista(valor);
      else if (clave === 'Glosario destacado')
        portada.glosarioDestacado = lista(valor);
      else
        throw new ErrorDeConocimiento(
          b.linea,
          `«${clave}» no es un dato de la portada (Presentación, Búsquedas frecuentes, Glosario destacado).`,
        );
      continue;
    }

    if (zona === 'glosario') {
      if (b.tipo !== 'vineta')
        throw new ErrorDeConocimiento(
          b.linea,
          'el glosario solo lleva viñetas «- **Término:** definición».',
        );
      const { clave, valor } = campo(b.texto, b.linea, 'glosario');
      const termino: TerminoGlosario = { termino: clave, definicion: valor };
      for (const s of b.sub) {
        const m = /^(También se dice|Se ve en):\s*(.+)$/.exec(s.texto);
        if (!m)
          throw new ErrorDeConocimiento(
            s.linea,
            'bajo un término solo van «También se dice: …» y «Se ve en: [Tema](#id)».',
          );
        if (m[1] === 'También se dice') termino.sinonimos = lista(m[2]);
        else {
          const ids = enlaces(m[2], s.linea, 'Se ve en');
          if (ids.length !== 1)
            throw new ErrorDeConocimiento(
              s.linea,
              '«Se ve en» lleva un solo tema.',
            );
          termino.temaId = ids[0];
        }
      }
      glosario.push(termino);
      continue;
    }

    // zona === 'categoria'
    if (!tema) {
      if (b.tipo !== 'parrafo')
        throw new ErrorDeConocimiento(
          b.linea,
          'bajo la categoría va solo su descripción, en un párrafo.',
        );
      categoria!.descripcion = unir(categoria!.descripcion, b.texto);
      continue;
    }

    const t = tema as TemaAyuda;
    switch (seccion) {
      case 'ficha': {
        if (b.tipo !== 'vineta')
          throw new ErrorDeConocimiento(
            b.linea,
            'bajo el título del tema va su ficha: «- **Resumen:** …», «- **Ruta:** …», etc.',
          );
        const { clave, valor } = campo(b.texto, b.linea, 'ficha del tema');
        if (clave === 'Ruta') {
          const ruta = valor.replace(/^`|`$/g, '');
          if (!ruta.startsWith('/'))
            throw new ErrorDeConocimiento(
              b.linea,
              `la ruta debe empezar por «/»: «${ruta}».`,
            );
          t.href = ruta;
        } else if (clave === 'Resumen') t.resumen = valor;
        else if (clave === 'Disponibilidad') t.disponibilidad = valor;
        else if (clave === 'Relacionados')
          t.relacionados = enlaces(valor, b.linea, 'Relacionados');
        else if (clave === 'Palabras clave') t.palabrasClave = lista(valor);
        else
          throw new ErrorDeConocimiento(
            b.linea,
            `«${clave}» no es un dato de la ficha (Ruta, Resumen, Disponibilidad, Relacionados, Palabras clave).`,
          );
        break;
      }
      case 'paraQue':
        if (b.tipo !== 'parrafo')
          throw new ErrorDeConocimiento(
            b.linea,
            '«Para qué sirve» lleva solo texto corrido.',
          );
        t.paraQueSirve = unir(t.paraQueSirve, b.texto);
        break;
      case 'pasos': {
        const g = guia as GuiaAyuda | null;
        if (!g)
          throw new ErrorDeConocimiento(
            b.linea,
            'cada guía empieza con su título: «##### Título de la guía».',
          );
        if (b.tipo === 'numerado') g.pasos.push(b.texto);
        else if (b.tipo === 'cita') {
          if (g.nota)
            throw new ErrorDeConocimiento(
              b.linea,
              `la guía «${g.titulo}» ya tiene una nota.`,
            );
          g.nota = b.texto.replace(/^💡\s*/u, '');
        } else
          throw new ErrorDeConocimiento(
            b.linea,
            'una guía lleva pasos numerados («1. …») y, si acaso, una nota («> 💡 …»).',
          );
        break;
      }
      case 'pantalla': {
        if (b.tipo !== 'vineta')
          throw new ErrorDeConocimiento(
            b.linea,
            '«Qué ves en la pantalla» lleva viñetas «- **Nombre:** explicación».',
          );
        const { clave, valor } = campo(
          b.texto,
          b.linea,
          'elemento de pantalla',
        );
        t.elementos.push({ nombre: clave, explicacion: valor });
        break;
      }
      case 'preguntas': {
        const p = pregunta as PreguntaAyuda | null;
        if (!p || b.tipo !== 'parrafo')
          throw new ErrorDeConocimiento(
            b.linea,
            'cada pregunta va como «##### ¿Pregunta?» y su respuesta en texto corrido debajo.',
          );
        p.respuesta = unir(p.respuesta, b.texto);
        break;
      }
      case 'problemas': {
        const p = problema as ProblemaAyuda | null;
        if (!p || b.tipo !== 'parrafo')
          throw new ErrorDeConocimiento(
            b.linea,
            'cada problema va como «##### Lo que pasa» y qué hacer en texto corrido debajo.',
          );
        p.solucion = unir(p.solucion, b.texto);
        break;
      }
    }
  }
  cerrarTema();

  if (
    !portada.presentacion ||
    !portada.busquedasFrecuentes ||
    !portada.glosarioDestacado
  ) {
    throw new ErrorDeConocimiento(
      inicio + 1,
      'la portada necesita «Presentación», «Búsquedas frecuentes» y «Glosario destacado».',
    );
  }
  if (categorias.length === 0)
    throw new ErrorDeConocimiento(
      inicio + 1,
      'no hay ninguna categoría («## Categoría: Título {#id}»).',
    );
  for (const c of categorias) {
    if (!c.descripcion)
      throw new ErrorDeConocimiento(
        inicio + 1,
        `la categoría «${c.titulo}» no tiene descripción.`,
      );
  }

  return { portada: portada as PortadaAyuda, categorias, temas, glosario };
}

// ── 4. Coherencia ──────────────────────────────────────────

/**
 * Lo que el formato no puede comprobar solo: que cada enlace apunte a algo
 * que existe y que las categorías tengan temas. Devuelve la lista de problemas
 * (vacía si todo está bien). La página no la usa —un enlace roto se omite—;
 * la usan las pruebas y `scripts/check-conocimiento.mjs` para que no llegue a
 * producción.
 */
export function validarConocimiento(contenido: ContenidoAyuda): string[] {
  const problemas: string[] = [];
  const ids = new Set(contenido.temas.map((t) => t.id));
  for (const t of contenido.temas) {
    for (const r of t.relacionados) {
      if (r === t.id)
        problemas.push(`«${t.titulo}» se cita a sí mismo en Relacionados.`);
      else if (r !== 'glosario' && !ids.has(r))
        problemas.push(`«${t.titulo}»: el relacionado #${r} no existe.`);
    }
    if (t.guias.length === 0)
      problemas.push(`«${t.titulo}» no tiene ninguna guía en «Paso a paso».`);
    if (t.preguntas.length === 0)
      problemas.push(`«${t.titulo}» no tiene preguntas frecuentes.`);
  }
  for (const c of contenido.categorias) {
    if (!contenido.temas.some((t) => t.categoria === c.id))
      problemas.push(`la categoría «${c.titulo}» no tiene temas.`);
  }
  for (const g of contenido.glosario) {
    if (g.temaId && !ids.has(g.temaId))
      problemas.push(
        `glosario «${g.termino}»: el tema #${g.temaId} no existe.`,
      );
  }
  const terminos = new Set(
    contenido.glosario.map((g) => g.termino.toLowerCase()),
  );
  for (const d of contenido.portada.glosarioDestacado) {
    if (![...terminos].some((t) => t.startsWith(d.toLowerCase())))
      problemas.push(
        `«Glosario destacado» nombra «${d}», que no está en el glosario.`,
      );
  }
  return problemas;
}

/** El tema de una ruta del menú (para enlazar desde una pantalla a su ayuda). */
export function temaDeRuta(
  temas: TemaAyuda[],
  href: string,
): TemaAyuda | undefined {
  return temas.find((t) => t.href === href);
}
