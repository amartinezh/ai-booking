import { textoParaCoincidencia } from './texto-para-coincidencia.util';

/**
 * Qué está diciendo un paciente que le contesta al bot, en las dos respuestas
 * que el bot atiende sin la IA (2026-10-13, primer lote de recordatorios):
 *
 *   CONFIRMA      → «Sí voy», «Si Dios quiere mañana voy», «Ok muchas gracias»,
 *                   «Bueno». Solo cuenta si acaba de recibir un recordatorio:
 *                   eso lo decide quien llama.
 *   QUIEN_ESCRIBE → «¿De dónde me hablan?», «¿Quién es?», «¿Quién me escribe?».
 *
 * Esa noche, a todas ellas el bot les respondió «la plataforma no está activa
 * para agendar, cancelar ni cambiar citas», incluso a quien confirmaba que iba.
 *
 * Determinista y conservador: ante la duda no clasifica (null) y el mensaje
 * sigue el camino de siempre. Nunca toma por confirmación algo que diga que NO
 * irá o que quiere cambiar la cita: eso es otra conversación.
 */
export type RespuestaAlBot = 'CONFIRMA' | 'QUIEN_ESCRIBE';

const sinTildes = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Con faltas de ortografía reales: «de donde me ablan».
const QUIEN_ESCRIBE =
  /\b(de donde|quien|quienes)\s+(me |nos |le )?(h?abl\w*|escrib\w*|llam\w*|es|son|eres)\b|\bque (entidad|empresa|hospital|numero) es\b/;

// Cualquier señal de que no irá o de que quiere cambiar algo.
const NO_CONFIRMA =
  /\b(no|nunca|tampoco|cancel\w*|cansel\w*|anul\w*|cambi\w*|reprogram\w*|reagend\w*|mover|mueva|aplaz\w*|posterg\w*|otro dia|otra (fecha|hora|cita))\b/;

const CONFIRMA =
  /\b(si+|claro|listo|ok|okey|okay|oki|vale|bueno|perfecto|de acuerdo|esta bien|confirm\w*|gracias|agradezco|voy|vamos|asistire|ire|alla estare|ahi estare|alli estare|cuenten conmigo|dios quiere|amen|entendido|recibido|enterad\w*)\b/;

/** Una confirmación es corta; un párrafo trae algo más que merece la IA. */
const MAX_PALABRAS_CONFIRMACION = 14;

export function clasificarRespuestaAlBot(
  texto: string | null | undefined,
): RespuestaAlBot | null {
  if (!texto) return null;
  const t = sinTildes(textoParaCoincidencia(texto));
  if (!t) return null;
  if (QUIEN_ESCRIBE.test(t)) return 'QUIEN_ESCRIBE';
  // Una pregunta merece respuesta, no un «gracias por confirmar».
  if (texto.includes('?')) return null;
  if (t.split(' ').length > MAX_PALABRAS_CONFIRMACION) return null;
  if (NO_CONFIRMA.test(t)) return null;
  return CONFIRMA.test(t) ? 'CONFIRMA' : null;
}
