/**
 * ══════════════════════════════════════════════════════════════════════════
 * 📅 DÍAS Y HORAS SIN CITAS POR EL ASISTENTE (2026-10-22)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La clínica elige, en Configuración › Días sin citas, días completos o rangos
 * de horas para los que el asistente (WhatsApp y Telegram) NO ofrece citas:
 * «todos los sábados», «el viernes 24 de 8 a 10 a. m.». Lo pidió el hospital el
 * primer día con agendar encendido.
 *
 *  - Cuenta la HORA DE LA CITA, no la del mensaje: un paciente que escribe un
 *    sábado sí puede agendar para el lunes; nunca se le ofrece un sábado.
 *  - Un rango de horas cubre las citas que EMPIEZAN desde la hora inicial y
 *    antes de la final: de 8:00 a 10:00 quita la de las 8:00 y la de las 9:40,
 *    no la de las 10:00.
 *  - «Repetir» vale ese día de la semana, desde el día elegido en adelante.
 *  - Solo el asistente: el personal agenda en el panel y en el HIS como siempre,
 *    y las citas ya agendadas no cambian.
 *
 * Todo en la zona horaria de la clínica. Puro: sin base de datos.
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { diaLocal } from './consulta-citas';
import { horaLocalAUtc } from './rango-estadisticas';

export interface ReglaBloqueoAgenda {
  /** Día de calendario en que empieza, en la zona de la clínica: 'YYYY-MM-DD'. */
  date: string;
  /** Ese día de la semana, desde `date` en adelante. */
  repeatWeekly: boolean;
  /** Minuto del día (0-1439) en que empieza; null = todo el día. */
  startMinute: number | null;
  /** Minuto del día (1-1439) en que termina, sin incluirlo; null = todo el día. */
  endMinute: number | null;
}

export const BLOQUEO_AGENDA = {
  /** Largo máximo del motivo. */
  NOTA_MAX: 120,
  /** Hasta cuántos días adelante se puede elegir un día. */
  DIAS_ADELANTE_MAX: 730,
  /** Último minuto que se puede elegir en un rango (23:59). */
  MINUTO_MAX: 1439,
} as const;

const DIA_MIN = 24 * 60;

// ─────────────────────────────────────────────────────────────
// Fechas de calendario 'YYYY-MM-DD' (sin zona: ya son de la clínica)
// ─────────────────────────────────────────────────────────────

/** [año, mes, día] de una fecha 'YYYY-MM-DD' que existe; null si no. */
export function partesDeFecha(
  fecha: unknown,
): [number, number, number] | null {
  if (typeof fecha !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return null;
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mes - 1, d));
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mes - 1 ||
    t.getUTCDate() !== d
  ) {
    return null;
  }
  return [y, mes, d];
}

const dos = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' de año, mes (1-12) y día. */
export function fechaDe(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${dos(t.getUTCMonth() + 1)}-${dos(t.getUTCDate())}`;
}

/** La fecha `n` días después (o antes, si es negativo). */
export function sumarDiasAFecha(fecha: string, n: number): string {
  const p = partesDeFecha(fecha);
  if (!p) throw new Error(`Fecha inválida: ${fecha}`);
  return fechaDe(p[0], p[1], p[2] + n);
}

/** 0 = domingo … 6 = sábado. */
export function diaDeLaSemana(fecha: string): number {
  const p = partesDeFecha(fecha);
  if (!p) throw new Error(`Fecha inválida: ${fecha}`);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

// ─────────────────────────────────────────────────────────────
// La regla
// ─────────────────────────────────────────────────────────────

export const esTodoElDia = (r: ReglaBloqueoAgenda): boolean =>
  r.startMinute == null || r.endMinute == null;

/** [desde, hasta) en minutos del día; todo el día es [0, 1440). */
export function minutosDelBloqueo(r: ReglaBloqueoAgenda): [number, number] {
  return esTodoElDia(r) ? [0, DIA_MIN] : [r.startMinute!, r.endMinute!];
}

/** ¿La regla toca este día de calendario? */
export function bloqueoAplicaElDia(
  r: ReglaBloqueoAgenda,
  fecha: string,
): boolean {
  if (!partesDeFecha(fecha) || !partesDeFecha(r.date)) return false;
  if (!r.repeatWeekly) return fecha === r.date;
  return fecha >= r.date && diaDeLaSemana(fecha) === diaDeLaSemana(r.date);
}

/** Las reglas que tocan este día. */
export function bloqueosDelDia<T extends ReglaBloqueoAgenda>(
  reglas: readonly T[],
  fecha: string,
): T[] {
  return reglas.filter((r) => bloqueoAplicaElDia(r, fecha));
}

/** Minuto del día del instante, en la zona dada. */
export function minutoLocal(
  instante: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return (v('hour') % 24) * 60 + v('minute');
}

/**
 * ¿El asistente NO debe ofrecer una cita que empieza en este instante?
 * Cuenta el comienzo de la cita, en la zona de la clínica.
 */
export function cupoBloqueado(
  inicio: Date,
  reglas: readonly ReglaBloqueoAgenda[],
  timeZone?: string,
): boolean {
  if (reglas.length === 0) return false;
  const tz = timeZone || DEFAULT_TIMEZONE;
  const fecha = diaLocal(inicio, tz);
  const minuto = minutoLocal(inicio, tz);
  return bloqueosDelDia(reglas, fecha).some((r) => {
    const [desde, hasta] = minutosDelBloqueo(r);
    return minuto >= desde && minuto < hasta;
  });
}

/** Instante UTC de un minuto del día de una fecha, en la zona dada. */
function instanteLocal(fecha: string, minuto: number, tz: string): Date {
  if (minuto >= DIA_MIN) {
    const [y, m, d] = partesDeFecha(sumarDiasAFecha(fecha, 1))!;
    return horaLocalAUtc(y, m, d, 0, tz);
  }
  const [y, m, d] = partesDeFecha(fecha)!;
  const base = horaLocalAUtc(y, m, d, Math.floor(minuto / 60), tz);
  return new Date(base.getTime() + (minuto % 60) * 60_000);
}

/**
 * Los tramos bloqueados entre dos instantes, ya en UTC: para filtrar los cupos
 * en la consulta misma (`NOT startTime in [gte, lt)`). Con un tope de días para
 * que una ventana enorme no se vuelva una lista enorme.
 */
export function intervalosBloqueados(
  reglas: readonly ReglaBloqueoAgenda[],
  desde: Date,
  hasta: Date,
  timeZone?: string,
  opts: { maxDias?: number } = {},
): { gte: Date; lt: Date }[] {
  if (reglas.length === 0 || hasta < desde) return [];
  const tz = timeZone || DEFAULT_TIMEZONE;
  const maxDias = opts.maxDias ?? 400;
  const primero = diaLocal(desde, tz);
  const ultimo = diaLocal(hasta, tz);
  const tramos: { gte: Date; lt: Date }[] = [];
  let fecha = primero;
  for (let i = 0; fecha <= ultimo && i < maxDias; i++) {
    for (const r of bloqueosDelDia(reglas, fecha)) {
      const [ini, fin] = minutosDelBloqueo(r);
      tramos.push({
        gte: instanteLocal(fecha, ini, tz),
        lt: instanteLocal(fecha, fin, tz),
      });
    }
    fecha = sumarDiasAFecha(fecha, 1);
  }
  return tramos;
}

/** Las próximas `n` fechas (desde `hoy`) en que aplica la regla. */
export function proximasFechasDelBloqueo(
  r: ReglaBloqueoAgenda,
  hoy: string,
  n = 3,
): string[] {
  if (!r.repeatWeekly) return r.date >= hoy ? [r.date] : [];
  let fecha = r.date >= hoy ? r.date : hoy;
  while (diaDeLaSemana(fecha) !== diaDeLaSemana(r.date)) {
    fecha = sumarDiasAFecha(fecha, 1);
  }
  const fechas: string[] = [];
  for (let i = 0; i < n; i++) fechas.push(sumarDiasAFecha(fecha, 7 * i));
  return fechas;
}

/** ¿Sigue vigente? (una de un solo día que ya pasó, no). */
export const bloqueoVigente = (r: ReglaBloqueoAgenda, hoy: string): boolean =>
  r.repeatWeekly || r.date >= hoy;

// ─────────────────────────────────────────────────────────────
// Validación de lo que llega del panel
// ─────────────────────────────────────────────────────────────

export type ValidacionBloqueo =
  | { ok: true; regla: ReglaBloqueoAgenda & { note: string | null } }
  | { ok: false; error: string };

const esMinuto = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isInteger(v) &&
  v >= 0 &&
  v <= BLOQUEO_AGENDA.MINUTO_MAX;

/**
 * Lo que manda el panel, revisado en el servidor (la acción se puede llamar con
 * cualquier cosa). `hoy` es la fecha de hoy en la zona de la clínica.
 */
export function validarBloqueoAgenda(
  entrada: {
    date?: unknown;
    repeatWeekly?: unknown;
    startMinute?: unknown;
    endMinute?: unknown;
    note?: unknown;
  },
  hoy: string,
): ValidacionBloqueo {
  if (!partesDeFecha(entrada?.date)) {
    return { ok: false, error: 'Elija un día en el calendario.' };
  }
  const date = String(entrada.date).trim();
  if (date < hoy) {
    return { ok: false, error: 'Ese día ya pasó. Elija hoy o un día futuro.' };
  }
  if (date > sumarDiasAFecha(hoy, BLOQUEO_AGENDA.DIAS_ADELANTE_MAX)) {
    return {
      ok: false,
      error: 'Elija un día dentro de los próximos dos años.',
    };
  }

  const sinInicio = entrada.startMinute == null;
  const sinFin = entrada.endMinute == null;
  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (!sinInicio || !sinFin) {
    if (!esMinuto(entrada.startMinute) || !esMinuto(entrada.endMinute)) {
      return { ok: false, error: 'Indique la hora inicial y la hora final.' };
    }
    if (entrada.endMinute <= entrada.startMinute) {
      return {
        ok: false,
        error: 'La hora final debe ser después de la hora inicial.',
      };
    }
    startMinute = entrada.startMinute;
    endMinute = entrada.endMinute;
  }

  const nota =
    typeof entrada.note === 'string' ? entrada.note.trim() : '';
  if (nota.length > BLOQUEO_AGENDA.NOTA_MAX) {
    return {
      ok: false,
      error: `El motivo puede tener hasta ${BLOQUEO_AGENDA.NOTA_MAX} caracteres.`,
    };
  }

  return {
    ok: true,
    regla: {
      date,
      repeatWeekly: entrada.repeatWeekly === true,
      startMinute,
      endMinute,
      note: nota || null,
    },
  };
}

/** ¿Dos reglas bloquean exactamente lo mismo? */
export const mismaRegla = (
  a: ReglaBloqueoAgenda,
  b: ReglaBloqueoAgenda,
): boolean =>
  a.date === b.date &&
  a.repeatWeekly === b.repeatWeekly &&
  (a.startMinute ?? null) === (b.startMinute ?? null) &&
  (a.endMinute ?? null) === (b.endMinute ?? null);

// ─────────────────────────────────────────────────────────────
// En palabras (panel, ayuda)
// ─────────────────────────────────────────────────────────────

export const DIAS_SEMANA = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;
const DIAS_SEMANA_PLURAL = [
  'domingos',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábados',
] as const;
export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** «sábado 24 de octubre de 2026» (sin año: «sábado 24 de octubre»). */
export function fechaEnPalabras(
  fecha: string,
  opts: { conAnio?: boolean } = {},
): string {
  const p = partesDeFecha(fecha);
  if (!p) return fecha;
  const base = `${DIAS_SEMANA[diaDeLaSemana(fecha)]} ${p[2]} de ${MESES[p[1] - 1]}`;
  return opts.conAnio === false ? base : `${base} de ${p[0]}`;
}

/** 480 → «8:00 a. m.»; 720 → «12:00 p. m.»; 0 → «12:00 a. m.». */
export function horaEnPalabras(minuto: number): string {
  const h = Math.floor(minuto / 60) % 24;
  const m = minuto % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${dos(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/**
 * La regla en palabras: «Todos los sábados» · «Todo el día» · «Desde el sábado
 * 24 de octubre de 2026», o «Viernes 23 de octubre de 2026» · «De 8:00 a. m. a
 * 10:00 a. m.».
 */
export function describirBloqueoAgenda(r: ReglaBloqueoAgenda): {
  cuando: string;
  horario: string;
  desde: string | null;
} {
  const horario = esTodoElDia(r)
    ? 'Todo el día'
    : `De ${horaEnPalabras(r.startMinute!)} a ${horaEnPalabras(r.endMinute!)}`;
  if (!partesDeFecha(r.date)) return { cuando: r.date, horario, desde: null };
  if (r.repeatWeekly) {
    return {
      cuando: `Todos los ${DIAS_SEMANA_PLURAL[diaDeLaSemana(r.date)]}`,
      horario,
      desde: `Desde el ${fechaEnPalabras(r.date)}`,
    };
  }
  return { cuando: mayuscula(fechaEnPalabras(r.date)), horario, desde: null };
}
