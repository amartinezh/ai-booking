/**
 * ❓ Una pregunta no es un «sí» (2026-10-23).
 *
 * En el resumen de la cita, una paciente que venía por unas ecografías preguntó
 * «¿Esto si es para las ecografías?» y el bot lo tomó como SÍ: le agendó una
 * cita de medicina general que no pidió y la escribió en el hospital. El SÍ/NO
 * del bot (`interpretYesNo`) quita los signos y encuentra la palabra «si».
 *
 * Aquí se decide si el mensaje PREGUNTA en vez de responder. Entonces el SÍ no
 * cuenta: el bot aclara y vuelve a pedir SÍ o NO. Un «no» sigue siendo «no».
 *
 *  - Con «?» o «¿» es pregunta, salvo que empiece respondiendo: «Sí, ¿a qué hora
 *    llego?» o «Claro. ¿Qué llevo?» confirman. Tampoco lo es pedir justo lo que
 *    se le pregunta: «¿Me la puede agendar?», «¿me la cancela por favor?».
 *  - Sin signos (notas de voz, o quien no los escribe), solo lo que no tiene otra
 *    lectura: «me indica si…», «quisiera saber…», «esto es para…». «Cómo no»
 *    o «que sí» no son preguntas.
 *
 * Puro: sin base de datos.
 */

const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Responde primero y pregunta después: «Sí, ¿a qué hora llego?». */
const EMPIEZA_RESPONDIENDO =
  /^[¡!]?(si+|sip|claro( que si)?|dale|ok|okey|okay|listo|correcto|de acuerdo|perfecto|confirmo|bueno|vale)(\s*[,.!;:]|\s+¿)/;

/** Pide justo lo que se le pregunta: «¿me la puede agendar?», «¿me la cancela?». */
const PIDE_LA_ACCION =
  /\b(me|nos) (la|lo) (puede|puedes|podria|podrias|pueden|podrian) (agendar|reservar|apartar|dejar|confirmar|cancelar|anular|pasar|cambiar|mover)\b|\b(me|nos) (la|lo) (agenda|agendas|reserva|reservas|aparta|apartas|deja|dejas|confirma|confirmas|cancela|cancelas|anula|anulas|pasa|pasas|cambia|cambias|mueve|mueves)\b|\b(puede|puedes|podria|podrias) (agendar|reservar|apartar|cancelar|anular)(la|mela|nosla)?\b/;

/** Pide información aunque no lleve signos. */
const EMPIEZA_PREGUNTANDO =
  /^(y )?(me (indica|indicas|indique|confirma|confirmas|dice|dices|diga|explica|explicas|aclara|aclaras)|(una )?pregunta|(quisiera|queria|quiero|necesito) saber|(esto|eso) (si |no )?es para|cual|donde)\b/;

/** ¿El mensaje pregunta en vez de responder SÍ o NO? */
export function esPreguntaEnVezDeRespuesta(
  texto: string | null | undefined,
): boolean {
  if (!texto) return false;
  const t = normalizar(texto);
  if (!t) return false;
  if (EMPIEZA_RESPONDIENDO.test(t) || PIDE_LA_ACCION.test(t)) return false;
  if (/[?¿]/.test(t)) return true;
  return EMPIEZA_PREGUNTANDO.test(t);
}
