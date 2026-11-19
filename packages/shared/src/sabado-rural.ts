/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🌾 SÁBADOS SOLO PARA LA ZONA RURAL (2026-11-19)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El hospital dedica los sábados a las personas del campo. Con la regla
 * encendida (Configuración › Asistente Virtual, «Sábados por el asistente»):
 *
 *  - El asistente (WhatsApp y Telegram) agenda citas de sábado SOLO a pacientes
 *    cuya ficha en el hospital dice zona de residencia rural. Lo dice la lista
 *    de documentos rurales que manda el agente (en el HIS de cnt-sanvicente-
 *    anserma, `PACIENTES.CD_CODI_ZORE_PAC = 'R'`). Zona urbana, vacía o un
 *    paciente que el hospital no tiene: no.
 *  - Como mucho el porcentaje elegido de la agenda de cada médico ese día (el
 *    mismo tope de la reserva para la atención presencial, `reserva-presencial
 *    .ts`, pero solo el sábado). 100 % = solo zona rural, sin tope.
 *  - El menú normal no muestra sábados: quien vive en el campo los pide con la
 *    opción «Vivo en zona rural: ver citas del sábado» o escribiendo «sábado».
 *  - Los demás días no cambian, y el personal y el hospital agendan sábados como
 *    siempre.
 *
 *  Sin valor (null) es lo de siempre: el sábado es un día más. Es la FECHA DE LA
 *  CITA la que cuenta, en la zona horaria de la clínica.
 *
 * Puro: sin base de datos.
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { diaLocal } from './consulta-citas';
import { horaLocalAUtc } from './rango-estadisticas';
import { diaDeLaSemana, partesDeFecha, sumarDiasAFecha } from './bloqueos-agenda';
import { normalizarParteDelChat } from './reserva-presencial';

export const SABADO_RURAL = {
  MIN: 10,
  /** 100 % = solo zona rural, sin tope. */
  MAX: 100,
  /** El que se propone al encenderla. */
  POR_DEFECTO: 50,
  /** Lo que ofrece el panel; un valor guardado fuera de la lista se muestra igual. */
  OPCIONES: [30, 40, 50, 60, 70, 80, 100] as const,
} as const;

/** Sábado en `Date.getUTCDay()` / `diaDeLaSemana`. */
const SABADO = 6;

/**
 * Lo que venga de la BD: entero en [MIN, MAX], o null = sin regla especial. Lo
 * inválido (0, negativo, NaN, texto) cuenta como sin regla: un dato raro deja el
 * sábado como un día más, igual que antes de esta regla.
 */
export function normalizarSabadoRural(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return null;
  const entero = Math.round(n);
  if (entero < SABADO_RURAL.MIN || entero > SABADO_RURAL.MAX) return null;
  return entero;
}

/**
 * Lo que llega del panel: null (sin regla especial) o un entero en [MIN, MAX].
 * Aquí lo inválido es un error: quien quiso encenderla no debe quedar sin ella
 * por un dato mal enviado.
 */
export function validarSabadoRural(
  valor: unknown,
): { ok: true; porcentaje: number | null } | { ok: false; error: string } {
  if (valor === null) return { ok: true, porcentaje: null };
  if (
    typeof valor !== 'number' ||
    !Number.isInteger(valor) ||
    valor < SABADO_RURAL.MIN ||
    valor > SABADO_RURAL.MAX
  ) {
    return {
      ok: false,
      error: `La parte del sábado para la zona rural debe ser un porcentaje entero entre ${SABADO_RURAL.MIN} y ${SABADO_RURAL.MAX}, o «Sin regla especial».`,
    };
  }
  return { ok: true, porcentaje: valor };
}

/** ¿El día ('YYYY-MM-DD') es sábado? */
export function esDiaSabado(dia: string): boolean {
  return partesDeFecha(dia) !== null && diaDeLaSemana(dia) === SABADO;
}

/** ¿La cita que empieza en `inicio` es de un sábado, en la zona de la clínica? */
export function esSabado(inicio: Date, timeZone?: string): boolean {
  return esDiaSabado(diaLocal(inicio, timeZone || DEFAULT_TIMEZONE));
}

/**
 * Los sábados completos (de medianoche a medianoche en la zona de la clínica,
 * en UTC) que tocan [desde, hasta). Para quitarlos de la consulta de cupos o
 * para quedarse solo con ellos.
 */
export function tramosDeSabado(
  desde: Date,
  hasta: Date,
  timeZone?: string,
): { gte: Date; lt: Date }[] {
  const tz = timeZone || DEFAULT_TIMEZONE;
  if (!(hasta > desde)) return [];
  const ultimo = diaLocal(hasta, tz);
  const tramos: { gte: Date; lt: Date }[] = [];
  for (let dia = diaLocal(desde, tz); dia <= ultimo; dia = sumarDiasAFecha(dia, 1)) {
    if (!esDiaSabado(dia)) continue;
    const [y, m, d] = partesDeFecha(dia)!;
    const [y2, m2, d2] = partesDeFecha(sumarDiasAFecha(dia, 1))!;
    tramos.push({
      gte: horaLocalAUtc(y, m, d, 0, tz),
      lt: horaLocalAUtc(y2, m2, d2, 0, tz),
    });
  }
  return tramos;
}

/**
 * El tope del asistente para un día: con la regla encendida, el sábado lleva el
 * suyo (100 % = sin tope); los demás días, el de la reserva para la atención
 * presencial. null = sin tope.
 */
export function porcentajeDelDia(
  dia: string,
  p: { porcentaje: number | null; sabadoRural: number | null },
): number | null {
  const sabado = normalizarSabadoRural(p.sabadoRural);
  if (sabado !== null && esDiaSabado(dia)) return normalizarParteDelChat(sabado);
  return normalizarParteDelChat(p.porcentaje);
}

/** «Sin regla especial», «Solo zona rural, hasta el 50 % de cada médico» o «Solo zona rural, sin tope». */
export function textoSabadoRural(valor: number | null): string {
  const pct = normalizarSabadoRural(valor);
  if (pct === null) return 'Sin regla especial';
  if (pct === SABADO_RURAL.MAX) return 'Solo zona rural, sin tope';
  return `Solo zona rural, hasta el ${pct} % de cada médico`;
}
