/**
 * Parser determinista de la "fecha preferida" que el paciente expresa en
 * lenguaje natural ("mañana", "el lunes", "esta semana", "25 de junio") hacia
 * una ventana de instantes UTC `{ desde, hasta }` lista para filtrar
 * `ScheduleSlot.startTime` en Prisma.
 *
 * Por qué vive en `@agenia/shared` y no en el chatbot:
 * - La conversión "fecha de pared en una zona horaria → instante UTC" es la
 *   misma disciplina que `date-format.ts`: el contenedor corre en UTC y la
 *   clínica piensa en `America/Bogota`. Calcular "mañana" con aritmética naïve
 *   sobre `Date` daría el día equivocado cerca de medianoche.
 * - El LLM extrae `fechaSolicitada` como texto libre pero NO conoce la fecha de
 *   hoy (el prompt no la inyecta), así que la resolución a una fecha concreta
 *   tiene que ocurrir en el servidor, que sí conoce el "ahora" real.
 *
 * Regla de oro: si la frase no se reconoce con confianza, devolvemos `null`.
 * El consumidor interpreta `null` como "sin preferencia" y cae al
 * comportamiento actual (próximos cupos disponibles). Nunca adivinamos.
 */

import { DEFAULT_TIMEZONE } from './date-format';

export interface FechaPreferida {
  /** Instante UTC: inicio del rango (inclusive). */
  desde: Date;
  /** Instante UTC: fin del rango (inclusive). */
  hasta: Date;
  /** Etiqueta legible tal como se mostrará al paciente ("mañana", "el lunes"). */
  label: string;
  /** Si la preferencia apunta a un día puntual o a un rango (semana). */
  precision: 'dia' | 'rango';
}

export interface ParseOptions {
  /** IANA timezone. Default = `America/Bogota`. */
  timeZone?: string;
  /** "Ahora" inyectable para tests deterministas. Default = `new Date()`. */
  now?: Date;
  /**
   * El día de la semana que es hoy cuenta como hoy: «miércoles 3:30 pm» un
   * miércoles, en el menú de cupos, es esta tarde (2026-10-28). Sin esto, la
   * semana entrante, que con un plazo de pocos días nunca tiene cupos.
   * «El próximo miércoles» sigue siendo la semana entrante.
   */
  incluirHoy?: boolean;
}

/** Componentes de una fecha de pared (sin zona). */
interface WallDate {
  y: number;
  /** Mes 1-12. */
  mo: number;
  d: number;
}

const WEEKDAYS: Record<string, number> = {
  // 0 = domingo … 6 = sábado (paridad con Date.getUTCDay()).
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/**
 * Minúsculas, sin acentos, espacios colapsados. Separa número y letras
 * pegados: «El28 de octubre» es «el 28 de octubre», y «3:00pm», «3:00 pm».
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * «Jueves 7 50», «miércoles 3:30 pm», «el viernes 4 de la tarde»: el número
 * después del día de la semana es una HORA, no el día del mes. Cuenta como hora
 * si lleva minutos («:30», «.30», «;30», « 50»), «am»/«pm», «de la tarde» u
 * «horas». (2026-10-28: «Jueves 7 50» se leía sábado 7 de noviembre.)
 */
const DIA_DE_SEMANA_CON_NUMERO =
  /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+(?:el\s+)?(\d{1,2})\b(?!\s*[:.;,]\s*\d)(?!\s*[ap]\s?\.?\s?m\b)(?!\s+[0-5]\d\b)(?!\s+(?:de|por|en)\s+la\s+(?:manana|tarde|noche)\b)(?!\s*(?:h|hr|hrs|hora|horas)\b)/;

/** Hasta cuántos días atrás una fecha sin año es un error y no el año entrante. */
const DIAS_ATRAS_SIN_ANIO_SIGUIENTE = 92;

/** El día de la semana (0=domingo…6=sábado) que nombra la frase, o null. */
function diaDeLaSemanaNombrado(texto: string): number | null {
  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(texto)) return target;
  }
  return null;
}

/**
 * Offset (ms) de `timeZone` en el instante `date`: tiempo de pared − UTC.
 * Para `America/Bogota` (sin DST) es siempre −5h; el cálculo queda genérico
 * para soportar otras clínicas en el futuro.
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  // `asUTC` no lleva milisegundos (formatToParts no los expone); comparamos
  // contra el instante truncado a segundos para no arrastrar ese desfase.
  return asUTC - (date.getTime() - date.getUTCMilliseconds());
}

/**
 * Instante UTC cuya hora de pared en `timeZone` es la indicada.
 * Algoritmo estándar: tratar la pared como si fuera UTC, medir el offset en
 * ese instante aproximado y corregir. Exacto para zonas sin DST.
 */
function wallToUtc(
  w: WallDate,
  h: number,
  mi: number,
  s: number,
  ms: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, h, mi, s, ms);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

/** Fecha de pared "hoy" en `timeZone`. */
function todayWall(now: Date, timeZone: string): WallDate {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(now)) map[p.type] = p.value;
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day) };
}

/** Suma `n` días calendario a una fecha de pared (sin tocar zonas). */
function addDays(w: WallDate, n: number): WallDate {
  const anchor = new Date(Date.UTC(w.y, w.mo - 1, w.d, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + n);
  return {
    y: anchor.getUTCFullYear(),
    mo: anchor.getUTCMonth() + 1,
    d: anchor.getUTCDate(),
  };
}

/** Día de la semana (0=domingo…6=sábado) de una fecha de pared. */
function weekdayOf(w: WallDate): number {
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
}

/** Construye una ventana de un solo día. */
function dayWindow(
  w: WallDate,
  label: string,
  timeZone: string,
): FechaPreferida {
  return {
    desde: wallToUtc(w, 0, 0, 0, 0, timeZone),
    hasta: wallToUtc(w, 23, 59, 59, 999, timeZone),
    label,
    precision: 'dia',
  };
}

/** Construye una ventana de rango [from..to] (inclusive). */
function rangeWindow(
  from: WallDate,
  to: WallDate,
  label: string,
  timeZone: string,
): FechaPreferida {
  return {
    desde: wallToUtc(from, 0, 0, 0, 0, timeZone),
    hasta: wallToUtc(to, 23, 59, 59, 999, timeZone),
    label,
    precision: 'rango',
  };
}

/**
 * Convierte la frase del paciente en una ventana de fechas, o `null` si no se
 * reconoce. La frase original (no normalizada) se usa como `label` para que el
 * mensaje al paciente refleje sus palabras.
 */
export function parseFechaPreferida(
  natural: string | null | undefined,
  opts: ParseOptions = {},
): FechaPreferida | null {
  if (!natural) return null;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const now = opts.now ?? new Date();
  const label = natural.trim();
  if (!label) return null;

  const norm = normalize(natural);

  // Quita las menciones de franja horaria ("por la mañana/tarde/noche") que NO
  // denotan un día calendario, para que "en la mañana" no se confunda con
  // "mañana" (tomorrow). "mañana por la mañana" conserva el primer "mañana".
  const stripped = norm
    .replace(/\b(de|por|en)\s+la\s+(manana|tarde|noche)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const today = todayWall(now, tz);

  // ── Relativos: hoy / pasado mañana / mañana ──────────────────
  if (/\bhoy\b/.test(stripped)) {
    return dayWindow(today, label, tz);
  }
  if (/\bpasado\s+manana\b/.test(norm)) {
    return dayWindow(addDays(today, 2), label, tz);
  }
  if (/\bmanana\b/.test(stripped)) {
    return dayWindow(addDays(today, 1), label, tz);
  }

  // ── Rangos de semana ─────────────────────────────────────────
  if (/\b(proxima|siguiente|entrante)\s+semana\b/.test(stripped) ||
      /\bsemana\s+(que\s+viene|entrante|siguiente)\b/.test(stripped)) {
    // Lunes a domingo de la semana siguiente.
    const dow = weekdayOf(today); // 0..6
    const daysUntilNextMonday = ((8 - dow) % 7) || 7;
    const from = addDays(today, daysUntilNextMonday);
    const to = addDays(from, 6);
    return rangeWindow(from, to, label, tz);
  }
  if (/\besta\s+semana\b/.test(stripped)) {
    // Hoy hasta el domingo de esta semana.
    const dow = weekdayOf(today); // 0=dom
    const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
    const to = addDays(today, daysUntilSunday);
    return rangeWindow(today, to, label, tz);
  }

  // El día de la semana que nombra, si nombra uno: cuando no coincide con el
  // número, manda el día de la semana (2026-10-28: «el jueves 12 de octubre» se
  // leía martes 12 de octubre de 2027). Es el que el paciente tiene en la cabeza;
  // el número suele ser un error de dedo.
  const diaNombrado = diaDeLaSemanaNombrado(stripped);

  // ── Día de mes con nombre de mes ("25 de junio", "miércoles 28 de octubre") ─
  // Antes que el día de la semana: la fecha dicha manda sobre el nombre del día.
  const conMes = stripped.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/);
  // Con el mes dicho y descartado, el número tampoco vale para otro mes:
  // «jueves 12 de octubre» no es el jueves 12 de noviembre.
  let fechaConMesDescartada = false;
  if (conMes) {
    const day = Number(conMes[1]);
    const mo = MONTHS[conMes[2]];
    if (mo && day >= 1 && day <= 31) {
      const candidate: WallDate = { y: today.y, mo, d: day };
      // Si la fecha ya pasó este año, el año entrante («3 de enero» en
      // diciembre)… salvo que haya pasado hace poco: «12 de octubre» un 28 de
      // octubre es un error, no octubre del año que viene.
      const fecha: WallDate | null = !isBefore(candidate, today)
        ? candidate
        : diasEntre(candidate, today) <= DIAS_ATRAS_SIN_ANIO_SIGUIENTE
          ? null
          : { y: today.y + 1, mo, d: day };
      if (fecha && (diaNombrado === null || weekdayOf(fecha) === diaNombrado)) {
        return dayWindow(fecha, label, tz);
      }
      if (diaNombrado === null) return null;
      fechaConMesDescartada = true;
    }
  }

  // ── Día de la semana con número ("el miércoles 28") ────────────
  // El número manda: un miércoles, «el miércoles 28» es hoy si hoy es 28, no
  // el miércoles de la semana entrante (2026-10-27, menú de cupos). Si el
  // número es una hora («jueves 7 50») o no cae en ese día de la semana, se
  // queda solo el día de la semana.
  const semanaConNumero = fechaConMesDescartada
    ? null
    : norm.match(DIA_DE_SEMANA_CON_NUMERO);
  if (semanaConNumero) {
    const day = Number(semanaConNumero[2]);
    if (day >= 1 && day <= 31) {
      const fecha = diaDelMes(day, today);
      if (weekdayOf(fecha) === WEEKDAYS[semanaConNumero[1]]) {
        return dayWindow(fecha, label, tz);
      }
    }
  }

  // ── Día de la semana ("el lunes", "el próximo viernes") ──────
  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(stripped)) {
      const dow = weekdayOf(today);
      // Próxima ocurrencia FUTURA; si hoy es ese día, la semana entrante,
      // salvo en el menú de cupos (`incluirHoy`) y sin «próximo».
      let delta = (target - dow + 7) % 7;
      const proximo = new RegExp(
        `\\b(proximo|siguiente)\\s+${name}\\b|\\b${name}\\s+(de\\s+la\\s+)?(proxima|siguiente)\\b`,
      ).test(stripped);
      if (delta === 0 && (!opts.incluirHoy || proximo)) delta = 7;
      return dayWindow(addDays(today, delta), label, tz);
    }
  }

  // ── Día de mes suelto ("el 25", "el día 3") ──────────────────
  const soloDia = stripped.match(/\bel\s+(?:dia\s+)?(\d{1,2})\b/);
  if (soloDia) {
    const day = Number(soloDia[1]);
    if (day >= 1 && day <= 31) {
      return dayWindow(diaDelMes(day, today), label, tz);
    }
  }

  return null;
}

/** El día `day` de este mes o, si ya pasó, del siguiente. */
function diaDelMes(day: number, today: WallDate): WallDate {
  let { y, mo } = today;
  if (day < today.d) {
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return { y, mo, d: day };
}

/** Días calendario de `a` a `b` (positivo si `a` es anterior). */
function diasEntre(a: WallDate, b: WallDate): number {
  const ms =
    Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** ¿La fecha de pared `a` es estrictamente anterior a `b`? */
function isBefore(a: WallDate, b: WallDate): boolean {
  if (a.y !== b.y) return a.y < b.y;
  if (a.mo !== b.mo) return a.mo < b.mo;
  return a.d < b.d;
}
