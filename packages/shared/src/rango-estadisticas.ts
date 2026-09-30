/**
 * ══════════════════════════════════════════════════════════════════════════
 * RANGOS DE ESTADÍSTICAS EN LA HORA DE LA CLÍNICA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * «Hoy», «esta semana», «este mes» y «este año» se cuentan en la hora LOCAL
 * de la clínica, nunca en UTC. Los contenedores corren en UTC: con
 * `setUTCHours(0)` el «hoy» de Bogotá empezaba a las 7 p. m. del día anterior y
 * las gráficas diarias partían el día a las 7 p. m. (ver CLAUDE.md, fechas).
 *
 * Devuelve instantes UTC listos para la base (`gte` incluido, `lt` excluido) y
 * la granularidad de la gráfica: por hora para «hoy», por día para semana/mes y
 * por mes para el año. `buckets` son las etiquetas de TODOS los tramos del
 * rango, para que la gráfica pinte ceros en lugar de saltarse los tramos
 * vacíos. Las etiquetas usan la hora local: `YYYY-MM-DDTHH`, `YYYY-MM-DD` o
 * `YYYY-MM`, el mismo formato que produce `to_char` en el SQL.
 */
import { DEFAULT_TIMEZONE } from './date-format';

export type RangoEstadisticas = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';
export type Granularidad = 'hour' | 'day' | 'month';

export interface RangoResuelto {
  /** Inicio del rango, incluido (instante UTC). */
  gte: Date;
  /** Fin del rango, EXCLUIDO (instante UTC). */
  lt: Date;
  granularidad: Granularidad;
  /** Etiquetas locales de cada tramo, en orden. */
  buckets: string[];
  timeZone: string;
}

interface PartesLocales {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  /** 0 = domingo … 6 = sábado */
  dow: number;
}

const DIAS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function partesLocales(instante: Date, timeZone: string): PartesLocales {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(instante);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return {
    y: Number(v('year')),
    m: Number(v('month')),
    d: Number(v('day')),
    h: Number(v('hour')) % 24,
    dow: DIAS[v('weekday')] ?? 0,
  };
}

/** Desfase (ms) de la zona respecto a UTC en ese instante. Bogotá: −5 h. */
function desfase(instante: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instante));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const comoUtc = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    v('hour') % 24,
    v('minute'),
    v('second'),
  );
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/**
 * Instante UTC de una hora de reloj local. Dos pasadas para acertar también en
 * zonas con horario de verano (Bogotá no tiene; el multi-tenant sí podría).
 */
export function horaLocalAUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const ingenuo = Date.UTC(y, m - 1, d, h);
  let t = ingenuo - desfase(ingenuo, timeZone);
  t = ingenuo - desfase(t, timeZone);
  return new Date(t);
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Suma días a una fecha de calendario (sin horas), vía UTC para no depender de zonas. */
function sumarDias(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function parseFecha(iso: string | undefined): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso?.trim() ?? '');
  if (!r) return null;
  const [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Días de calendario entre dos fechas (b − a). */
function diasEntre(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
) {
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000,
  );
}

/** Un rango personalizado de más de 92 días se grafica por mes. */
const MAX_DIAS_GRAFICA_DIARIA = 92;
/** Tope de un rango personalizado: dos años. */
const MAX_DIAS_PERSONALIZADO = 731;

export function resolverRangoEstadisticas(opts: {
  range?: RangoEstadisticas | string | null;
  startDate?: string;
  endDate?: string;
  now?: Date;
  timeZone?: string;
}): RangoResuelto {
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;
  const hoy = partesLocales(opts.now ?? new Date(), timeZone);
  const range = String(opts.range ?? 'MONTH').toUpperCase();

  let desde: { y: number; m: number; d: number };
  let hastaExcl: { y: number; m: number; d: number };
  let granularidad: Granularidad;

  const ini = parseFecha(opts.startDate);
  const fin = parseFecha(opts.endDate);

  if (range === 'CUSTOM' && ini && fin && diasEntre(ini, fin) >= 0) {
    desde = ini;
    const dias = Math.min(diasEntre(ini, fin), MAX_DIAS_PERSONALIZADO - 1);
    hastaExcl = sumarDias(ini.y, ini.m, ini.d, dias + 1);
    granularidad =
      dias === 0 ? 'hour' : dias + 1 > MAX_DIAS_GRAFICA_DIARIA ? 'month' : 'day';
  } else if (range === 'TODAY') {
    desde = { y: hoy.y, m: hoy.m, d: hoy.d };
    hastaExcl = sumarDias(hoy.y, hoy.m, hoy.d, 1);
    granularidad = 'hour';
  } else if (range === 'WEEK') {
    // Lunes a domingo de la semana en curso, en hora local.
    const atras = hoy.dow === 0 ? 6 : hoy.dow - 1;
    desde = sumarDias(hoy.y, hoy.m, hoy.d, -atras);
    hastaExcl = sumarDias(desde.y, desde.m, desde.d, 7);
    granularidad = 'day';
  } else if (range === 'YEAR') {
    desde = { y: hoy.y, m: 1, d: 1 };
    hastaExcl = { y: hoy.y + 1, m: 1, d: 1 };
    granularidad = 'month';
  } else {
    desde = { y: hoy.y, m: hoy.m, d: 1 };
    hastaExcl =
      hoy.m === 12 ? { y: hoy.y + 1, m: 1, d: 1 } : { y: hoy.y, m: hoy.m + 1, d: 1 };
    granularidad = 'day';
  }

  const buckets: string[] = [];
  if (granularidad === 'hour') {
    for (let h = 0; h < 24; h++) {
      buckets.push(`${desde.y}-${dos(desde.m)}-${dos(desde.d)}T${dos(h)}`);
    }
  } else if (granularidad === 'day') {
    for (let i = 0; i < diasEntre(desde, hastaExcl); i++) {
      const f = sumarDias(desde.y, desde.m, desde.d, i);
      buckets.push(`${f.y}-${dos(f.m)}-${dos(f.d)}`);
    }
  } else {
    let { y, m } = desde;
    while (y < hastaExcl.y || (y === hastaExcl.y && m < hastaExcl.m)) {
      buckets.push(`${y}-${dos(m)}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    // Un rango personalizado que termina a mitad de mes también incluye ese mes.
    const ultimo = `${hastaExcl.y}-${dos(hastaExcl.m)}`;
    if (hastaExcl.d > 1 && buckets[buckets.length - 1] !== ultimo) {
      buckets.push(ultimo);
    }
  }

  return {
    gte: horaLocalAUtc(desde.y, desde.m, desde.d, 0, timeZone),
    lt: horaLocalAUtc(hastaExcl.y, hastaExcl.m, hastaExcl.d, 0, timeZone),
    granularidad,
    buckets,
    timeZone,
  };
}

/** Formato `to_char` de Postgres que produce las mismas etiquetas que `buckets`. */
export const FORMATO_SQL_BUCKET: Record<Granularidad, string> = {
  hour: 'YYYY-MM-DD"T"HH24',
  day: 'YYYY-MM-DD',
  month: 'YYYY-MM',
};
