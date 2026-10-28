/**
 * 🆕 ¿Pide una cita NUEVA o cambiar / anular la que tiene? Dos frases que el
 * asistente leía al revés (diagnóstico del 2026-10-28):
 *
 *  · «Nesesito otra cita para lectura de examenes», escrita justo después de
 *    agendarle a una persona: el extractor la tomó como cambiar la fecha y el
 *    asistente movió en el hospital la cita recién agendada (de 7:30 a 7:50).
 *  · «Cancelar» a secas justo después del aviso de «máximo una cita el mismo
 *    día»: la madre quería dejar esa solicitud y el asistente le ofreció anular
 *    la cita que ya tenía; dijo «Sí» cuatro veces y dos niños se quedaron sin
 *    cita.
 *
 * Puro: sin base de datos ni Redis. Frases fijas, sin LLM: decide si se toca
 * una cita que ya está en el hospital.
 */

/** Minúsculas, sin tildes, sin signos, espacios colapsados. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «Otra cita», «una cita nueva», «una consulta adicional». */
const CITA_NUEVA =
  /\b(otra|nueva|una\s+mas|segunda|adicional)\s+(cita|consulta)\b|\b(cita|consulta)\s+(nueva|adicional|aparte|extra)\b/;

/**
 * Lo que convierte «otra cita» en un cambio: «cambiar», «mover», «no puedo
 * ir», «en vez de», «otra fecha».
 */
const CAMBIO =
  /\b(cambi\w*|mover\w*|muev\w*|movamos|reprogram\w*|reagend\w*|aplaz\w*|adelant\w*|pospon\w*|traslad\w*|modific\w*|correr\w*|corra|corrala)\b|\bno\s+(puedo|podre|podria|alcanzo|me\s+queda|me\s+sirve|voy|asisto)\b|\b(en\s+vez|en\s+lugar)\s+de\b|\botra\s+(fecha|hora|dia)\b/;

/** ¿Pide una cita más (para sí o para otra persona) y no cambiar la que tiene? */
export function pideCitaNueva(texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  return CITA_NUEVA.test(t) && !CAMBIO.test(t);
}

/**
 * ¿Es «Cancelar» a secas (o «cancelo», «cancelar todo»)? «Cancelar mi cita» o
 * «cancelar la cita del jueves» nombran la cita: esas sí son anular.
 */
export function esCancelarASecas(texto: string | null | undefined): boolean {
  return /^(cancelar|cancela|cancelo|cancele|cancelar todo|cancelar eso|cancelar solicitud)$/.test(
    normalizar(texto),
  );
}
