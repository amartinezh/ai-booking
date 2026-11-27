/**
 * 🚪 ¿Pide salir de la lista de espera? (docs/PLAN_PERMANENCIA_LISTA_ESPERA.md, L1)
 *
 * El 26-nov el médico director del hospital escribió «Quiero salir de la lista de
 * espera» y recibió el menú de servicios; «Salir de lista de espera», «no logré
 * entender». Otro paciente escribió «Ya no lo necesito» y «Salir de la lista, ya no
 * se necesita la cita» y siguió recibiendo ofertas: no había forma de salir, y todo
 * lo que tuviera un «no» era un NO a ese cupo («usted sigue en la lista»).
 *
 * Frases fijas, sin IA: es una decisión sobre su lugar en la cola y no puede quedar
 * a interpretación. Dos grupos:
 *
 *  - `LISTA`: nombra la lista o las ofertas («salir de la lista», «sáquenme de la
 *    lista», «ya no quiero estar en lista de espera», «no quiero recibir más
 *    ofertas»). Vale siempre que el número tenga una entrada activa.
 *  - `NO_LA_NECESITA`: dice que ya no la necesita («ya no lo necesito», «ya me
 *    dieron la cita», «ya asistí», «tuve traslado»). Puede referirse a una cita que
 *    ya tiene: quien llama decide con el contexto (una oferta, o sin cita próxima).
 *
 * «Salir» a secas NO: sigue siendo cerrar la conversación. Puro: sin base de datos.
 */

export type PedidoDeSalida = 'LISTA' | 'NO_LA_NECESITA';

/**
 * Minúsculas, sin tildes y espacios colapsados. La puntuación que separa frases
 * queda como « | »: «No, sáquenme de la lista» es un «no» a la oferta y un pedido
 * de salir, no «no me saquen de la lista».
 */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?¿¡\n]+/g, ' | ')
    .replace(/[^a-z0-9|\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Verbos de salir, sacar o quitar (en sus formas de pedido). */
const SACAR =
  '(salir|salirme|salirse|sali|salgo|sacar|sacarme|saquen|saquenme|saqueme|saca|sacame|quitar|quitarme|quiten|quitenme|quiteme|retirar|retirarme|retiren|retirenme|retireme|borrar|borrarme|borren|borrenme|eliminar|eliminarme|eliminen|eliminenme|desanotar|desanotarme|darme de baja|dar de baja|baja)';

const PIDE_SACARLO_DE_LA_LISTA = new RegExp(
  `\\b${SACAR}\\b(\\s+\\w+){0,4}\\s+lista\\b`,
);
const NO_QUIERE_ESTAR_EN_LA_LISTA =
  /\bno (quiero|deseo|necesito|me interesa) (seguir |estar |permanecer |continuar |quedarme |quedar )?(mas )?(en )?(la |esa |esta )?lista\b/;
const NO_QUIERE_MAS_OFERTAS =
  /\bno (quiero|deseo|necesito|me interesa)( recibir| seguir recibiendo)?( mas)?( los| las| sus| esas| esos)? (ofertas?|cupos?|mensajes?|notificaciones|avisos)\b/;
const QUE_NO_LE_ESCRIBAN =
  /\b(no me|dejen de) (envien|manden|escriban|ofrezcan|enviar|mandar|escribir|ofrecer)( mas)?( los| las)? (ofertas?|cupos?|mensajes?)\b/;
const NO_MAS_OFERTAS = /\bno mas (ofertas|cupos)\b/;

/** «No me saquen de la lista», «no quiero salir de la lista»: lo contrario. */
const NO_QUIERE_SALIR =
  /\bno (me (saquen|saque|quiten|quite|borren|borre|retiren|retire|eliminen|elimine)|(quiero|deseo) (salir|salirme|que me saquen))\b/;

const YA_NO_LA_NECESITA =
  /\bya no (lo |la |los |las )?(necesito|necesitamos|necesita|requiero|requerimos|requiere|se necesita|hace falta|es necesari[ao])\b/;
const NO_LA_NECESITA_YA =
  /\bno (lo |la )?(necesito|necesitamos|requiero) (mas|ya)\b/;
const YA_NO_QUIERE_SEGUIR =
  /\bya no (quiero|deseo) (seguir|continuar|la cita|el cupo|citas?)\b/;
const YA_TIENE_LA_CITA =
  /\bya (me |le |nos )?(dieron|asignaron|agendaron|consegui|conseguimos|consiguio|tengo|tiene|tenemos|saque|sacamos) (la |una |mi |su |otra )?cita\b/;
const YA_SE_LA_DIERON = /\bya me la (dieron|asignaron|agendaron)\b/;
const YA_LO_ATENDIERON =
  /\bya (asisti|asistio|asistimos|me atendieron|lo atendieron|la atendieron|fue atendid[ao]|fui atendid[ao])\b/;
const SE_FUE_DEL_MUNICIPIO =
  /\b(tuve|tuvo|tengo|tiene) (un )?traslado\b|\b(me|se|nos) (fui|fue|fuimos|traslade|traslado|trasladaron|mude|mudo|mudamos) (a|para)\b/;

/**
 * Pide otra cosa a la vez («ya no necesito esa hora, ¿tiene otra?», «ya no la
 * necesito para el lunes»): no es salir de la lista.
 */
const PIDE_OTRA_COSA =
  /\b(otr[ao]s?|tienen?|hay|cambi\w*|para (el|la|los|las|manana|hoy|esta|este))\b/;

export function pideSalirDeLaLista(
  texto: string | null | undefined,
): PedidoDeSalida | null {
  const t = normalizar(texto);
  if (!t) return null;
  if (NO_QUIERE_SALIR.test(t)) return null;
  if (
    PIDE_SACARLO_DE_LA_LISTA.test(t) ||
    NO_QUIERE_ESTAR_EN_LA_LISTA.test(t) ||
    NO_QUIERE_MAS_OFERTAS.test(t) ||
    QUE_NO_LE_ESCRIBAN.test(t) ||
    NO_MAS_OFERTAS.test(t)
  ) {
    return 'LISTA';
  }
  if (
    YA_NO_LA_NECESITA.test(t) ||
    NO_LA_NECESITA_YA.test(t) ||
    YA_NO_QUIERE_SEGUIR.test(t) ||
    YA_TIENE_LA_CITA.test(t) ||
    YA_SE_LA_DIERON.test(t) ||
    YA_LO_ATENDIERON.test(t) ||
    SE_FUE_DEL_MUNICIPIO.test(t)
  ) {
    return PIDE_OTRA_COSA.test(t) && !YA_LO_ATENDIERON.test(t)
      ? null
      : 'NO_LA_NECESITA';
  }
  return null;
}
