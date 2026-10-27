/**
 * 🗓️ «¿Para mañana no hay?», «el miércoles 28», «en la tarde», «otro horario»:
 * lo que escribe el paciente cuando ninguno de los cupos que le ofreció el
 * asistente le sirve.
 *
 * POR QUÉ EXISTE (2026-10-27)
 * El asistente ofrece los primeros cupos libres, y una mañana con agenda llena
 * los ofrece todos para ese mismo día. En el menú solo entendía la letra o la
 * hora de un cupo ofrecido: a «Podría ser para el miércoles 28» o «para mañana
 * no hay» contestaba «Esa letra no aparece entre las opciones», y el paciente se
 * iba. Entre el lunes 26 y el martes 27, de 34 personas que vieron cupos, 17
 * agendaron; al menos 5 pidieron otro día con el miércoles lleno de cupos libres.
 *
 * Aquí se decide QUÉ pidió; el chatbot busca los cupos con las reglas de siempre
 * (anticipación mínima, plazo para agendar, días sin citas, médicos encendidos).
 *
 * Regla de oro, la de `parse-fecha-preferida.ts`: si no se reconoce con
 * confianza, `null`, y el asistente vuelve a pedir la letra. Nunca adivina.
 *
 * Puro: sin base de datos ni Redis.
 */
import { DEFAULT_TIMEZONE } from './date-format';
import {
  parseFechaPreferida,
  type FechaPreferida,
} from './parse-fecha-preferida';
import { parseHoraPreferida } from './parse-hora-preferida';
import { diaLocal } from './consulta-citas';
import {
  fechaEnPalabras,
  partesDeFecha,
  sumarDiasAFecha,
} from './bloqueos-agenda';
import { horaLocalAUtc } from './rango-estadisticas';
import type { FranjaDelDia } from './cupos-ofrecidos';

export interface PedidoOtroHorario {
  /** El día (o la semana) que nombró: «mañana», «el miércoles 28»; null si no nombró ninguno. */
  fecha: FechaPreferida | null;
  /** «en la tarde», «más temprano», «a las 3»; null si no la dijo. */
  franja: FranjaDelDia | null;
  /**
   * Otro día sin decir cuál («otro día», «ninguno», «no me sirve»): los cupos
   * desde el día siguiente al último que se le ofreció.
   *
   * Sin día, sin franja y sin esto («otro horario», «más opciones»): los cupos
   * que siguen, sin repetir los que ya vio.
   */
  otroDia: boolean;
}

export interface OtroHorarioOptions {
  /** IANA timezone. Default = `America/Bogota`. */
  timeZone?: string;
  /** "Ahora" inyectable para tests deterministas. Default = `new Date()`. */
  now?: Date;
}

/** Minúsculas, sin tildes, sin signos, espacios colapsados. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9:.\s]/g, ' ')
    // El punto solo cuenta en una hora («12.10»): «No.» es «no».
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «No puedo», «no me sirve», «ninguno»: rechaza lo que se le ofreció. */
const RECHAZO =
  /^(no|nop|nones)$|\bningun[oa]?\b|\bno\s+(me\s+)?(sirve|sirven|queda|quedan|conviene|convienen|puedo|alcanzo)\b|\bno\s+tengo\s+tiempo\b/;

/** «Otro día», «otra fecha», «un día diferente». */
const OTRO_DIA =
  /\botr[oa]s?\s+(dia|dias|fecha|fechas)\b|\b(dia|fecha)\s+(diferente|distint[oa])\b/;

/** «Otro horario», «otra hora», «más opciones», «cambiar el horario». */
const SIGUIENTES =
  /\botr[oa]s?\s+(horario|horarios|hora|horas|opcion|opciones|cupo|cupos|turno|turnos)\b|\bmas\s+(opciones|horarios|cupos|turnos)\b|\b(horario|hora)\s+(diferente|distint[oa])\b|\bcambiar\s+(el\s+|de\s+)?horario\b/;

const OTRA_FRANJA: Record<FranjaDelDia, FranjaDelDia> = {
  MANANA: 'TARDE',
  TARDE: 'MANANA',
};

/**
 * La franja que pidió, o null. «Muy temprano» se lee como queja de los que vio
 * (2026-10-26: «Muy temprano las citas»): quiere más tarde. Y al revés. Con un
 * rechazo, la franja que nombra es la que NO quiere: «no puedo en la mañana».
 */
function franjaPedida(norm: string, rechaza: boolean): FranjaDelDia | null {
  if (/\b(muy|demasiado|tan)\s+temprano\b/.test(norm)) return 'TARDE';
  if (/\b(muy|demasiado|tan)\s+tarde\b/.test(norm)) return 'MANANA';
  const nombrada = franjaNombrada(norm);
  return nombrada && rechaza ? OTRA_FRANJA[nombrada] : nombrada;
}

function franjaNombrada(norm: string): FranjaDelDia | null {
  if (/\b(en|por|de|para)\s+la\s+(tarde|tardecita)\b/.test(norm)) return 'TARDE';
  if (/\b(en|por|de|para)\s+la\s+(manana|mananita)\b/.test(norm)) return 'MANANA';
  if (/\b(mas|bien)\s+tarde\b|\btardecita\b/.test(norm)) return 'TARDE';
  if (/\btemprano\b|\bmadrugada\b/.test(norm)) return 'MANANA';
  // Una hora («a las 3», «10:30 am»): el asistente busca en su franja. Sin
  // «de la tarde», «a las 3» en un hospital es de la tarde; «a las 9», de la mañana.
  const hora = parseHoraPreferida(norm);
  if (hora) {
    const h = hora.hour24;
    if (hora.meridiemKnown) return h >= 12 ? 'TARDE' : 'MANANA';
    return h === 12 || (h >= 1 && h <= 6) ? 'TARDE' : 'MANANA';
  }
  return null;
}

/**
 * Lo que pidió el paciente en el menú de cupos, o null si no es un pedido de
 * otro día u otra hora (y el asistente vuelve a pedirle la letra).
 */
export function interpretarOtroHorario(
  texto: string | null | undefined,
  opts: OtroHorarioOptions = {},
): PedidoOtroHorario | null {
  if (!texto) return null;
  const norm = normalizar(texto);
  if (!norm) return null;

  // «Para la mañana» es la franja, no el día siguiente; «la otra semana», la próxima.
  const paraElDia = norm
    .replace(/\bpara\s+la\s+(manana|tarde)\b/g, 'en la $1')
    .replace(/\bla\s+otra\s+semana\b/g, 'la proxima semana');

  const rechaza = RECHAZO.test(norm);
  // El día que nombra junto con un rechazo («no puedo mañana») es el que NO quiere.
  const fecha = rechaza ? null : parseFechaPreferida(paraElDia, opts);
  const franja = franjaPedida(norm, rechaza);
  // «No puedo en la mañana» pide la tarde de los mismos días, no otro día.
  const otroDia = !fecha && ((rechaza && !franja) || OTRO_DIA.test(norm));

  if (fecha || franja || otroDia) return { fecha, franja, otroDia };
  if (SIGUIENTES.test(norm)) return { fecha: null, franja: null, otroDia: false };
  return null;
}

/** Medianoche (hora de la clínica) del día 'YYYY-MM-DD', en UTC. */
function inicioDelDia(dia: string, timeZone: string): Date {
  const [y, m, d] = partesDeFecha(dia)!;
  return horaLocalAUtc(y, m, d, 0, timeZone);
}

/**
 * Desde cuándo (y hasta cuándo, si aplica) buscar los cupos del pedido.
 *  · Con día: ese día (o esa semana).
 *  · Otro día: desde la medianoche siguiente al último cupo ofrecido.
 *  · Lo demás (franja, «otro horario»): desde ahora; quien llama quita los ya vistos.
 * `hasta` null = sin tope propio (el plazo para agendar lo pone la búsqueda).
 */
export function ventanaOtroHorario(
  pedido: PedidoOtroHorario,
  ofrecidos: readonly Date[],
  opts: OtroHorarioOptions = {},
): { desde: Date; hasta: Date | null } {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const ahora = opts.now ?? new Date();
  if (pedido.fecha) return { desde: pedido.fecha.desde, hasta: pedido.fecha.hasta };
  if (pedido.otroDia) {
    const ultimo = ofrecidos.reduce<Date | null>(
      (max, f) => (!max || f > max ? f : max),
      null,
    );
    const dia = sumarDiasAFecha(diaLocal(ultimo ?? ahora, tz), 1);
    return { desde: inicioDelDia(dia, tz), hasta: null };
  }
  return { desde: ahora, hasta: null };
}

/** El día siguiente (medianoche, hora de la clínica) al último cupo ofrecido. */
export function inicioDelDiaSiguiente(
  ofrecidos: readonly Date[],
  opts: OtroHorarioOptions = {},
): Date {
  return ventanaOtroHorario(
    { fecha: null, franja: null, otroDia: true },
    ofrecidos,
    opts,
  ).desde;
}

const FRANJA_EN_PALABRAS: Record<FranjaDelDia, string> = {
  MANANA: 'la mañana',
  TARDE: 'la tarde',
};

/**
 * Cómo se le nombra al paciente lo que pidió: «miércoles 28 de octubre en la
 * tarde», «la tarde», «del lunes 2 al domingo 8 de noviembre». Con la fecha
 * escrita por el asistente, no con la frase del paciente: su frase puede ser
 * «Podría ser para el miércoles 28 de octubre por favor». null si no nombró
 * día ni franja («otro horario», «otro día»).
 */
export function etiquetaOtroHorario(
  pedido: PedidoOtroHorario,
  opts: OtroHorarioOptions = {},
): string | null {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const franja = pedido.franja ? FRANJA_EN_PALABRAS[pedido.franja] : null;
  if (!pedido.fecha) return franja;
  const desde = diaLocal(pedido.fecha.desde, tz);
  const hasta = diaLocal(pedido.fecha.hasta, tz);
  const dia =
    desde === hasta
      ? fechaEnPalabras(desde, { conAnio: false })
      : `del ${fechaEnPalabras(desde, { conAnio: false })} al ${fechaEnPalabras(hasta, { conAnio: false })}`;
  return franja ? `${dia} en ${franja}` : dia;
}

/** El día 'YYYY-MM-DD' en palabras si todos los cupos caen en él; si no, null. */
export function diaComunDeLosCupos(
  fechas: readonly Date[],
  opts: OtroHorarioOptions = {},
): string | null {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const dias = new Set(fechas.map((f) => diaLocal(f, tz)));
  if (dias.size !== 1) return null;
  return fechaEnPalabras([...dias][0], { conAnio: false });
}
