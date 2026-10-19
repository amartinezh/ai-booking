// ─────────────────────────────────────────────────────────────
// CENTRO DE AYUDA — la forma del contenido.
//
// El texto NO vive en el código: sale de docs/conocimiento/AGENIA.md (la parte
// entre `<!-- AYUDA:INICIO -->` y `<!-- AYUDA:FIN -->`), que `conocimiento.ts`
// convierte en estas estructuras. Para cambiar lo que dice la ayuda, se edita
// ese archivo; el formato está en docs/conocimiento/README.md.
// ─────────────────────────────────────────────────────────────

export interface CategoriaAyuda {
    id: string;
    titulo: string;
    descripcion: string;
}

export interface GuiaAyuda {
    titulo: string;
    pasos: string[];
    /** Aclaración que acompaña los pasos (un límite, una consecuencia, un atajo). */
    nota?: string;
}

export interface ElementoPantalla {
    nombre: string;
    explicacion: string;
}

export interface PreguntaAyuda {
    pregunta: string;
    respuesta: string;
}

export interface ProblemaAyuda {
    sintoma: string;
    solucion: string;
}

export interface TemaAyuda {
    id: string;
    /** Ruta de la opción del menú que explica; sin ruta es un tema general. */
    href?: string;
    /** Igual a la etiqueta del menú (lo comprueba `contenido.spec.ts`). */
    titulo: string;
    icono: string;
    /** Id de su categoría. */
    categoria: string;
    /** Una frase: qué es y para qué. */
    resumen: string;
    paraQueSirve: string;
    /** Cuándo aparece la opción en el menú, si no aparece siempre. */
    disponibilidad?: string;
    guias: GuiaAyuda[];
    elementos: ElementoPantalla[];
    preguntas: PreguntaAyuda[];
    problemas: ProblemaAyuda[];
    /** Ids de otros temas (o 'glosario'). */
    relacionados: string[];
    /** Palabras con las que alguien buscaría esto y que no están en el texto. */
    palabrasClave: string[];
}

export interface TerminoGlosario {
    termino: string;
    definicion: string;
    /** Otras formas de decirlo (también se buscan). */
    sinonimos?: string[];
    /** Tema donde se ve o se configura. */
    temaId?: string;
}

/** Lo que muestra el inicio de la ayuda antes de elegir un tema. */
export interface PortadaAyuda {
    /** Texto bajo el título «Centro de ayuda». */
    presentacion: string;
    /** Botones de búsqueda rápida bajo el buscador. */
    busquedasFrecuentes: string[];
    /** Términos que nombra la tarjeta del glosario en el inicio. */
    glosarioDestacado: string[];
}

export interface ContenidoAyuda {
    portada: PortadaAyuda;
    categorias: CategoriaAyuda[];
    temas: TemaAyuda[];
    glosario: TerminoGlosario[];
}
