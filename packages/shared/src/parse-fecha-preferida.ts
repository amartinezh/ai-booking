/**
 * Parser determinista de la "fecha preferida" que el paciente expresa en
 * lenguaje natural ("mañana", "el lunes", "esta semana", "25 de junio") hacia
 * una ventana de instantes UTC `{ desde, hasta }` lista para filtrar
 * `ScheduleSlot.startTime` en Prisma.
 *
 * Por qué vive en `@antigravity/shared` y no en el chatbot:
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

/** Minúsculas, sin acentos, espacios colapsados. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  // ── Día de la semana ("el lunes", "el próximo viernes") ──────
  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(stripped)) {
      const dow = weekdayOf(today);
      // Próxima ocurrencia FUTURA; si hoy es ese día, la semana entrante.
      let delta = (target - dow + 7) % 7;
      if (delta === 0) delta = 7;
      return dayWindow(addDays(today, delta), label, tz);
    }
  }

  // ── Día de mes con nombre de mes ("25 de junio", "3 de mayo") ─
  const conMes = stripped.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/);
  if (conMes) {
    const day = Number(conMes[1]);
    const mo = MONTHS[conMes[2]];
    if (mo && day >= 1 && day <= 31) {
      let year = today.y;
      // Si la fecha ya pasó este año, asumimos el año entrante.
      const candidate: WallDate = { y: year, mo, d: day };
      if (isBefore(candidate, today)) year += 1;
      return dayWindow({ y: year, mo, d: day }, label, tz);
    }
  }

  // ── Día de mes suelto ("el 25", "el día 3") ──────────────────
  const soloDia = stripped.match(/\bel\s+(?:dia\s+)?(\d{1,2})\b/);
  if (soloDia) {
    const day = Number(soloDia[1]);
    if (day >= 1 && day <= 31) {
      let { y, mo } = today;
      // Si el día ya pasó este mes, saltamos al mes siguiente.
      if (day < today.d) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
      return dayWindow({ y, mo, d: day }, label, tz);
    }
  }

  return null;
}

/** ¿La fecha de pared `a` es estrictamente anterior a `b`? */
function isBefore(a: WallDate, b: WallDate): boolean {
  if (a.y !== b.y) return a.y < b.y;
  if (a.mo !== b.mo) return a.mo < b.mo;
  return a.d < b.d;
}
