/**
 * 🔎 ¿El paciente duda de la cita que el asistente le acaba de agendar?
 * (2026-10-23)
 *
 * Una paciente que venía por unas ecografías quedó con una cita de medicina
 * general y escribió enseguida «Me indicas por favor si sí es para las
 * ecografías». Nadie del hospital se enteró: la conversación siguió y la cita se
 * quedó. Ahora ese mensaje deja un caso en la Bandeja («Revisar una cita agendada
 * por el asistente») para que una persona confirme con el paciente.
 *
 * Solo dos señales, y las dos sin ambigüedad:
 *  - nombra un servicio que no es el de su cita y que no se agenda por el
 *    asistente («ecografías», «odontología»…), refiriéndose a la cita («¿esto es
 *    para…?», «la cita…»): no basta con preguntar a qué hora abre el laboratorio;
 *  - dice que no era la cita que necesitaba («no era para eso», «yo no pedí esa
 *    cita», «me equivoqué»).
 *
 * Solo decide: no toca la cita ni responde nada. Puro: sin base de datos.
 */
import { servicioQueNoSeAgenda } from './servicio-no-agendable';

export type DudaSobreLaCita =
  | { motivo: 'OTRO_SERVICIO'; servicio: string }
  | { motivo: 'NO_LA_PIDIO' };

const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Habla de la cita que tiene: «esto», «la cita», «es para…». */
const SE_REFIERE_A_LA_CITA =
  /\b(cita|esto|eso|es para|era para|sirve para|la que|lo que)\b/;

/** Dice que no era la cita que necesitaba. */
const NO_LA_PIDIO =
  /\b(no (era|es) (para|lo que|la que|(la |esa |esta )?cita)|yo no (pedi|solicite|agende|queria)|me equivoque|nos equivocamos|se equivoc\w*|no (la|lo) (pedi|necesito|queria)|no necesito (esa|esta) cita|cita equivocada|no es la cita)\b/;

/**
 * La duda del paciente sobre la cita de `servicioDeLaCita`, o null. Sin el
 * servicio (aún no se buscó la cita) responde si PODRÍA serlo: así la base solo
 * se consulta para los mensajes que lo parecen.
 */
export function dudaSobreLaCita(
  texto: string | null | undefined,
  servicioDeLaCita: string | null,
): DudaSobreLaCita | null {
  if (!texto) return null;
  const t = normalizar(texto);
  if (!t) return null;
  if (NO_LA_PIDIO.test(t)) return { motivo: 'NO_LA_PIDIO' };
  if (!SE_REFIERE_A_LA_CITA.test(t)) return null;
  const servicio = servicioQueNoSeAgenda(
    texto,
    servicioDeLaCita ? [servicioDeLaCita] : [],
  );
  return servicio ? { motivo: 'OTRO_SERVICIO', servicio } : null;
}
