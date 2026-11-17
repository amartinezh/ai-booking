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

/**
 * ¿Nombra el cambio de una cita? «Cambiar», «mover», «reprogramar», «aplazar»,
 * «trasladar», «modificar», «otra fecha / hora / día» (2026-11-12). Sin los «no
 * puedo», «no me queda», «no me sirve» de `CAMBIO`: con ellos también se rechaza
 * un horario que se está eligiendo («la otra a las 6 nos queda muy difícil»).
 */
const NOMBRA_CAMBIO =
  /\b(cambi\w*|mover\w*|muev\w*|movamos|reprogram\w*|reagend\w*|aplaz\w*|pospon\w*|traslad\w*|modific\w*)\b|\botra\s+(fecha|hora|dia)\b/;

export function nombraCambioDeCita(texto: string | null | undefined): boolean {
  return NOMBRA_CAMBIO.test(normalizar(texto));
}

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

/**
 * ❌ ¿Pide anular una cita con palabras que el atajo de `[cancel]` no reconoce?
 * El atajo solo toma frases que EMPIEZAN con «cancelar cita», «quiero
 * cancelar»…; en el menú de servicios (donde el texto no pasa por la IA)
 * «Cancelar una cita», «Cancelación de cita» o «Es para cancelar una cita» se
 * leían como «quiero agendar» y el asistente contestaba «Perfecto, con gusto le
 * agendo su cita» (12 veces, 10 personas, del 28-oct al 14-nov de 2026).
 *
 * Sí: nombra la cita o la consulta junto a «cancelar» / «anular», o lo pide
 * («para cancelar», «necesito cancelar», «me ayuda a cancelar»).
 * No: «Cancelar» a secas (es abandonar, ver `esCancelarASecas`), una negación
 * («no quiero cancelar»), los recordatorios («cancelar los recordatorios») ni
 * lo que ya pasó («me cancelaron la cita», «mi cita fue cancelada»).
 */
const PALABRA_CANCELAR = /\b(cancel\w*|cansel\w*|anul\w*)\b/;
const NIEGA_CANCELAR =
  /\bno\s+(quiero\s+|deseo\s+|voy\s+a\s+|necesito\s+|es\s+para\s+|era\s+para\s+)?(la\s+|lo\s+|me\s+la\s+|mi\s+cita\s+)?(cancel\w*|cansel\w*|anul\w*)/;
const YA_CANCELADA =
  /\b(cancelaron|canselaron|anularon)\b|\b(fue|esta|estaba|quedo|salio|aparece)\s+(cancelad\w*|canselad\w*|anulad\w*)/;
const DE_RECORDATORIOS = /\b(recordatorios?|mensajes?|notificaciones?)\b/;
const NOMBRA_LA_CITA = /\b(cita|citas|consulta|consultas|control|turno)\b/;
const LO_PIDE =
  /\b(para|pa|quiero|quisiera|necesito|deseo|ayud\w*|favor|podria\w*|puede\w*|como)\b/;

export function pideCancelarUnaCita(texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  if (!PALABRA_CANCELAR.test(t) || esCancelarASecas(texto)) return false;
  if (NIEGA_CANCELAR.test(t) || YA_CANCELADA.test(t)) return false;
  if (DE_RECORDATORIOS.test(t)) return false;
  return NOMBRA_LA_CITA.test(t) || LO_PIDE.test(t) || /^cancelacion\b/.test(t);
}
