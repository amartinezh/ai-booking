/**
 * ⭐ ESTADÍSTICAS DE LA ENCUESTA DE SATISFACCIÓN — cálculo puro.
 *
 * Recibe las encuestas que cumplen los filtros (solo las columnas que hacen
 * falta) y arma los indicadores: tasa de respuesta, estrellas del asistente,
 * «¿Recomendaría la IPS?», «¿Cómo le fue?», por gestión y en el tiempo.
 *
 * Los tramos de tiempo van en la hora de la clínica (CLAUDE.md, fechas):
 * reutiliza `resolverRangoEstadisticas`, el mismo de las demás estadísticas.
 */
import { ResolutionStatus, SurveyExperience } from '@agenia/database';
import {
  DEFAULT_TIMEZONE,
  resolverRangoEstadisticas,
  type Granularidad,
} from '@agenia/shared';
import {
  computeAnswerStatus,
  SurveyIndicators,
  SurveyStats,
} from './dto/survey-report.types';

export interface SurveyStatsRow {
  createdAt: Date;
  isUsed: boolean;
  expiresAt: Date;
  rating: number | null;
  wouldRecommend: boolean | null;
  experience: SurveyExperience | null;
  resolutionStatus: ResolutionStatus;
}

/** Acumulador de un grupo. */
class Grupo {
  sent = 0;
  answered = 0;
  ratingSum = 0;
  ratingCount = 0;
  yes = 0;
  no = 0;
  good = 0;
  fair = 0;
  bad = 0;
  noAnswer = 0;

  add(r: SurveyStatsRow): void {
    this.sent++;
    // Respondida = al menos las estrellas (la estrella se guarda sola).
    if (r.isUsed || r.rating != null) this.answered++;
    if (r.rating != null) {
      this.ratingSum += r.rating;
      this.ratingCount++;
    }
    if (r.wouldRecommend === true) this.yes++;
    else if (r.wouldRecommend === false) this.no++;
    switch (r.experience) {
      case SurveyExperience.GOOD:
        this.good++;
        break;
      case SurveyExperience.FAIR:
        this.fair++;
        break;
      case SurveyExperience.BAD:
        this.bad++;
        break;
      case SurveyExperience.NO_ANSWER:
        this.noAnswer++;
        break;
    }
  }

  indicators(): SurveyIndicators {
    const conOpinion = this.good + this.fair + this.bad;
    return {
      sent: this.sent,
      answered: this.answered,
      averageRating: this.ratingCount
        ? redondear(this.ratingSum / this.ratingCount, 2)
        : null,
      recommendRate: proporcion(this.yes, this.yes + this.no),
      goodRate: proporcion(this.good, conOpinion),
    };
  }
}

function redondear(n: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

/** Proporción 0..1 con 4 decimales; null si no hay base. */
function proporcion(parte: number, total: number): number | null {
  return total > 0 ? redondear(parte / total, 4) : null;
}

const dos = (n: string | number) => String(n).padStart(2, '0');

/** Días por encima de los cuales la satisfacción también se agrupa por semana. */
const DIAS_PARA_SEMANAS = 14;

/** El lunes (`YYYY-MM-DD`) de la semana de un día `YYYY-MM-DD`. */
export function lunesDe(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return `${t.getUTCFullYear()}-${dos(t.getUTCMonth() + 1)}-${dos(t.getUTCDate())}`;
}

/** Clave local del tramo, en el mismo formato que `buckets`. */
function claveDeTramo(timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  return (instante: Date, granularidad: Granularidad): string => {
    const partes: Record<string, string> = {};
    for (const p of fmt.formatToParts(instante)) partes[p.type] = p.value;
    const dia = `${partes.year}-${dos(partes.month)}-${dos(partes.day)}`;
    if (granularidad === 'month') return dia.slice(0, 7);
    if (granularidad === 'hour')
      return `${dia}T${dos(Number(partes.hour) % 24)}`;
    return dia;
  };
}

/**
 * Rango de la gráfica en el tiempo: el de los filtros; sin fechas, desde la
 * encuesta más antigua hasta hoy.
 */
function rangoDeLaGrafica(
  rows: SurveyStatsRow[],
  filtros: { startDate?: string; endDate?: string },
  now: Date,
  timeZone: string,
) {
  const clave = claveDeTramo(timeZone);
  const hoy = clave(now, 'day');
  let desde = filtros.startDate;
  let hasta = filtros.endDate;
  if (!desde) {
    let min: Date | null = null;
    for (const r of rows) if (!min || r.createdAt < min) min = r.createdAt;
    desde = min ? clave(min, 'day') : hoy;
  }
  if (!hasta) hasta = desde > hoy ? desde : hoy;
  return resolverRangoEstadisticas({
    range: 'CUSTOM',
    startDate: desde,
    endDate: hasta,
    now,
    timeZone,
  });
}

export function buildSurveyStats(
  rows: SurveyStatsRow[],
  opts: {
    comments: number;
    startDate?: string;
    endDate?: string;
    now?: Date;
    timeZone?: string;
    truncated?: boolean;
  },
): SurveyStats {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;

  const total = new Grupo();
  const porGestion = new Map<ResolutionStatus, Grupo>();
  const ratingDistribution = [0, 0, 0, 0, 0];
  let complete = 0;
  let starsOnly = 0;
  let pending = 0;
  let expired = 0;
  // Promedio de estrellas según si respondieron también lo de la IPS.
  const conIps = { suma: 0, n: 0 };
  const soloEstrellas = { suma: 0, n: 0 };

  const rango = rangoDeLaGrafica(rows, opts, now, timeZone);
  const clave = claveDeTramo(timeZone);
  const porTramo = new Map<string, Grupo>(
    rango.buckets.map((b) => [b, new Grupo()]),
  );

  for (const r of rows) {
    total.add(r);

    const estado = computeAnswerStatus(r.isUsed, r.expiresAt, now, r.rating);
    if (estado === 'ANSWERED') complete++;
    else if (estado === 'PARTIAL') starsOnly++;
    else if (estado === 'PENDING') pending++;
    else expired++;

    if (r.rating != null) {
      if (estado === 'PARTIAL') {
        soloEstrellas.suma += r.rating;
        soloEstrellas.n++;
      } else if (r.experience != null) {
        conIps.suma += r.rating;
        conIps.n++;
      }
    }

    if (r.rating != null && r.rating >= 1 && r.rating <= 5) {
      ratingDistribution[r.rating - 1]++;
    }

    let g = porGestion.get(r.resolutionStatus);
    if (!g) {
      g = new Grupo();
      porGestion.set(r.resolutionStatus, g);
    }
    g.add(r);

    // Una encuesta fuera del rango de la gráfica (p. ej. más de dos años
    // atrás) cuenta en los totales pero no tiene tramo.
    porTramo.get(clave(r.createdAt, rango.granularidad))?.add(r);
  }

  let semanas: Map<string, Grupo> | null = null;
  if (
    rango.granularidad === 'day' &&
    rango.buckets.length > DIAS_PARA_SEMANAS
  ) {
    semanas = new Map();
    for (const b of rango.buckets) {
      const lunes = lunesDe(b);
      if (!semanas.has(lunes)) semanas.set(lunes, new Grupo());
    }
    for (const r of rows) {
      const dia = clave(r.createdAt, 'day');
      if (porTramo.has(dia)) semanas.get(lunesDe(dia))?.add(r);
    }
  }

  const indicadores = total.indicators();
  return {
    ...indicadores,
    complete,
    starsOnly,
    pending,
    expired,
    responseRate: proporcion(total.answered, total.sent),
    averageRatingWithIps: conIps.n
      ? redondear(conIps.suma / conIps.n, 2)
      : null,
    averageRatingStarsOnly: soloEstrellas.n
      ? redondear(soloEstrellas.suma / soloEstrellas.n, 2)
      : null,
    comments: opts.comments,
    ratingDistribution,
    recommend: { yes: total.yes, no: total.no },
    experience: {
      [SurveyExperience.GOOD]: total.good,
      [SurveyExperience.FAIR]: total.fair,
      [SurveyExperience.BAD]: total.bad,
      [SurveyExperience.NO_ANSWER]: total.noAnswer,
    },
    byResolution: [...porGestion.entries()]
      .map(([status, g]) => ({ status, ...g.indicators() }))
      .sort((a, b) => b.sent - a.sent),
    trend: {
      granularity: rango.granularidad,
      points: rango.buckets.map((bucket) => ({
        bucket,
        ...porTramo.get(bucket)!.indicators(),
      })),
      ...(semanas
        ? {
            weekly: [...semanas.entries()].map(([bucket, g]) => ({
              bucket,
              ...g.indicators(),
            })),
          }
        : {}),
    },
    truncated: opts.truncated ?? false,
  };
}
