/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🗓️ PLAZO MÁXIMO PARA AGENDAR POR EL ASISTENTE (2026-10-23)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La clínica elige en Configuración › Asistente Virtual hasta cuántos días
 * adelante ofrece citas el asistente (WhatsApp y Telegram), para que nadie
 * agende para una fecha muy lejana. Lo pidió el hospital.
 *
 *  - Los días se cuentan INCLUYENDO HOY: con 3, hoy, mañana y pasado mañana.
 *    Si hoy es viernes 23, ofrece hasta el domingo 25; desde el lunes 26, no.
 *  - Cuenta la FECHA DE LA CITA, en la zona horaria de la clínica.
 *  - Sin límite (null) es el valor de siempre: nada cambia hasta configurarlo.
 *  - Solo el asistente: el personal agenda en el panel y en el HIS a cualquier
 *    fecha, y las citas ya agendadas no cambian.
 *
 * Puro: sin base de datos.
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { diaLocal } from './consulta-citas';
import { horaLocalAUtc } from './rango-estadisticas';
import {
  cupoBloqueado,
  partesDeFecha,
  sumarDiasAFecha,
  type ReglaBloqueoAgenda,
} from './bloqueos-agenda';
import { inicioMinimoParaOfrecer } from './cupos-ofrecidos';

export const PLAZO_AGENDAR = {
  MIN: 1,
  /** Un año: más allá, «sin límite» dice lo mismo. */
  MAX: 365,
  /** Lo que ofrece el panel; un valor guardado fuera de la lista se muestra igual. */
  OPCIONES: [1, 2, 3, 4, 5, 6, 7, 10, 14, 15, 21, 30, 45, 60, 90] as const,
} as const;

/**
 * Lo que venga de la BD: entero en [MIN, MAX], o null = sin límite. Lo inválido
 * (0, negativo, NaN, texto) cuenta como sin límite: un dato raro nunca deja al
 * asistente sin citas para ofrecer.
 */
export function normalizarPlazoAgendar(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n < PLAZO_AGENDAR.MIN) return null;
  return Math.min(PLAZO_AGENDAR.MAX, Math.round(n));
}

/**
 * Lo que llega del panel: null (sin límite) o un entero en [MIN, MAX]. Aquí lo
 * inválido es un error, no «sin límite»: quien quiso poner 3 días no debe
 * quedar sin límite por un dato mal enviado.
 */
export function validarPlazoAgendar(
  valor: unknown,
): { ok: true; dias: number | null } | { ok: false; error: string } {
  if (valor === null) return { ok: true, dias: null };
  if (
    typeof valor !== 'number' ||
    !Number.isInteger(valor) ||
    valor < PLAZO_AGENDAR.MIN ||
    valor > PLAZO_AGENDAR.MAX
  ) {
    return {
      ok: false,
      error: `El plazo debe ser un número entero de días entre ${PLAZO_AGENDAR.MIN} y ${PLAZO_AGENDAR.MAX}, o «Sin límite».`,
    };
  }
  return { ok: true, dias: valor };
}

/**
 * El último día ('YYYY-MM-DD', en la zona de la clínica) para el que el
 * asistente ofrece citas; null sin límite. `hoy` es la fecha de la clínica.
 */
export function ultimoDiaParaAgendar(
  hoy: string,
  dias: number | null,
): string | null {
  const plazo = normalizarPlazoAgendar(dias);
  return plazo === null ? null : sumarDiasAFecha(hoy, plazo - 1);
}

/**
 * El primer instante que YA queda fuera del plazo: la medianoche del día
 * siguiente al último, en UTC. null sin límite. Para la consulta de cupos
 * (`startTime < fin`).
 */
export function finDelPlazoParaAgendar(
  ahora: Date,
  dias: number | null,
  timeZone?: string,
): Date | null {
  const tz = timeZone || DEFAULT_TIMEZONE;
  const ultimo = ultimoDiaParaAgendar(diaLocal(ahora, tz), dias);
  if (ultimo === null) return null;
  const [y, m, d] = partesDeFecha(sumarDiasAFecha(ultimo, 1))!;
  return horaLocalAUtc(y, m, d, 0, tz);
}

/** ¿El asistente puede dar una cita que empieza en `inicio`? */
export function dentroDelPlazoParaAgendar(
  inicio: Date,
  ahora: Date,
  dias: number | null,
  timeZone?: string,
): boolean {
  const fin = finDelPlazoParaAgendar(ahora, dias, timeZone);
  return fin === null || inicio < fin;
}

/** «Sin límite» · «1 día (solo hoy)» · «2 días (hoy y mañana)» · «3 días». */
export function textoPlazoAgendar(dias: number | null): string {
  const plazo = normalizarPlazoAgendar(dias);
  if (plazo === null) return 'Sin límite';
  if (plazo === 1) return '1 día (solo hoy)';
  if (plazo === 2) return '2 días (hoy y mañana)';
  if (plazo === 3) return '3 días (hoy, mañana y pasado mañana)';
  return `${plazo} días`;
}

/** Días de calendario de `desde` a `hasta` ('YYYY-MM-DD'): del viernes al lunes, 3. */
function diasEntre(desde: string, hasta: string): number {
  const [a, b] = [partesDeFecha(desde)!, partesDeFecha(hasta)!];
  return Math.round(
    (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) /
      86_400_000,
  );
}

/**
 * Desde qué día ve el paciente un cupo del `diaDelCupo` con un plazo de `dias`
 * (contando ese día): con 2 días, el cupo del lunes lo ve desde el domingo.
 */
export function primerDiaParaVerElCupo(diaDelCupo: string, dias: number): string {
  return sumarDiasAFecha(diaDelCupo, -(Math.max(1, dias) - 1));
}

/**
 * 🗓️ Lo que el plazo le deja ofrecer HOY al asistente (2026-10-23: con 2 días un
 * viernes, el asistente no tenía ningún cupo hasta el domingo y nadie lo sabía).
 */
export interface ResumenCuposDelPlazo {
  /** Cupos libres que el asistente puede ofrecer hoy, dentro del plazo. */
  enElPlazo: number;
  /** Los mismos sin contar el plazo. */
  total: number;
  /** Día ('YYYY-MM-DD') del primer cupo libre, con o sin plazo; null si no hay. */
  primerDia: string | null;
  /** Último día del plazo; null sin límite. */
  ultimoDia: string | null;
  /** Si hoy no hay ninguno en el plazo: desde qué día se ve el primero. */
  desde: string | null;
  /** Días de plazo que hacen falta para ofrecer hoy el primer cupo. */
  plazoMinimo: number | null;
}

/**
 * Cuenta, con las mismas reglas del asistente, los cupos que puede ofrecer hoy:
 * la anticipación mínima, los días sin citas y el plazo. `inicios` son los
 * cupos libres de los médicos y servicios que el asistente ofrece.
 */
export function resumenCuposDelPlazo(p: {
  inicios: readonly Date[];
  ahora: Date;
  dias: number | null;
  reglas: readonly ReglaBloqueoAgenda[];
  timeZone?: string;
}): ResumenCuposDelPlazo {
  const tz = p.timeZone || DEFAULT_TIMEZONE;
  const minimo = inicioMinimoParaOfrecer(p.ahora);
  const ofrecibles = p.inicios
    .filter((i) => i >= minimo && !cupoBloqueado(i, p.reglas, tz))
    .sort((a, b) => a.getTime() - b.getTime());
  const fin = finDelPlazoParaAgendar(p.ahora, p.dias, tz);
  const enElPlazo = fin
    ? ofrecibles.filter((i) => i < fin).length
    : ofrecibles.length;
  const hoy = diaLocal(p.ahora, tz);
  const plazo = normalizarPlazoAgendar(p.dias);
  const primerDia = ofrecibles.length > 0 ? diaLocal(ofrecibles[0], tz) : null;
  return {
    enElPlazo,
    total: ofrecibles.length,
    primerDia,
    ultimoDia: ultimoDiaParaAgendar(hoy, plazo),
    desde:
      enElPlazo === 0 && primerDia && plazo !== null
        ? primerDiaParaVerElCupo(primerDia, plazo)
        : null,
    plazoMinimo: primerDia ? diasEntre(hoy, primerDia) + 1 : null,
  };
}
