/**
 * Horario del equipo técnico humano (docs/PLAN_BOT_SOPORTE.md, S14): de lunes a
 * viernes de 8:00 a 17:00, hora de Colombia, salvo que el super admin lo cambie.
 *
 * Lo usa el asistente de soporte para dos cosas:
 *   · decirle al empleado cuándo van a ver su caso («El equipo lo revisa desde
 *     mañana a las 8:00»);
 *   · contar las 2 horas DEL HORARIO después de las cuales un caso que nadie tomó
 *     se le recuerda al grupo (una noche o un fin de semana no cuentan).
 *
 * Lógica pura. Los festivos no se descuentan en esta versión.
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { horaLocalAUtc } from './rango-estadisticas';

const MS_MIN = 60_000;

export interface HorarioEquipo {
  /** Días ISO en que trabaja el equipo: 1 = lunes … 7 = domingo. */
  dias: number[];
  /** Hora de reloj en que empieza (incluida), 0–23. */
  desdeHora: number;
  /** Hora de reloj en que termina (excluida), 1–24. */
  hastaHora: number;
  zona: string;
}

export const HORARIO_EQUIPO_POR_DEFECTO: HorarioEquipo = {
  dias: [1, 2, 3, 4, 5],
  desdeHora: 8,
  hastaHora: 17,
  zona: DEFAULT_TIMEZONE,
};

/**
 * El horario guardado en `SupportBotConfig`, o el de por defecto si viene vacío o
 * no tiene sentido (sin días, horas fuera de rango, una zona que no existe). Un
 * horario roto no puede dejar al bot diciendo «lo ven nunca».
 */
export function horarioEquipoDe(
  config?: {
    teamDays?: number[] | null;
    teamFromHour?: number | null;
    teamToHour?: number | null;
    teamTimeZone?: string | null;
  } | null,
): HorarioEquipo {
  const dias = [...new Set(config?.teamDays ?? [])]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  const desde = config?.teamFromHour;
  const hasta = config?.teamToHour;
  const horasValidas =
    Number.isInteger(desde) &&
    Number.isInteger(hasta) &&
    (desde as number) >= 0 &&
    (hasta as number) <= 24 &&
    (desde as number) < (hasta as number);
  const zona = config?.teamTimeZone?.trim() || DEFAULT_TIMEZONE;
  return {
    dias: dias.length > 0 ? dias : [...HORARIO_EQUIPO_POR_DEFECTO.dias],
    desdeHora: horasValidas
      ? (desde as number)
      : HORARIO_EQUIPO_POR_DEFECTO.desdeHora,
    hastaHora: horasValidas
      ? (hasta as number)
      : HORARIO_EQUIPO_POR_DEFECTO.hastaHora,
    zona: zonaValida(zona) ? zona : DEFAULT_TIMEZONE,
  };
}

function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

interface FechaLocal {
  y: number;
  m: number;
  d: number;
}

/** Fecha de calendario en la zona del equipo. */
function fechaLocal(instante: Date, zona: string): FechaLocal {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { y: v('year'), m: v('month'), d: v('day') };
}

/** Día ISO de una fecha de calendario (1 = lunes … 7 = domingo). */
function diaIso(f: FechaLocal): number {
  const dow = new Date(Date.UTC(f.y, f.m - 1, f.d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function sumarDias(f: FechaLocal, n: number): FechaLocal {
  const t = new Date(Date.UTC(f.y, f.m - 1, f.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** La jornada de una fecha, en instantes UTC; null si ese día no se trabaja. */
function jornada(
  f: FechaLocal,
  h: HorarioEquipo,
): { abre: Date; cierra: Date } | null {
  if (!h.dias.includes(diaIso(f))) return null;
  return {
    abre: horaLocalAUtc(f.y, f.m, f.d, h.desdeHora, h.zona),
    // La hora 24 es la medianoche del día siguiente.
    cierra:
      h.hastaHora === 24
        ? (() => {
            const s = sumarDias(f, 1);
            return horaLocalAUtc(s.y, s.m, s.d, 0, h.zona);
          })()
        : horaLocalAUtc(f.y, f.m, f.d, h.hastaHora, h.zona),
  };
}

/** ¿El equipo está trabajando en este instante? */
export function enHorarioDelEquipo(
  ahora: Date,
  horario: HorarioEquipo = HORARIO_EQUIPO_POR_DEFECTO,
): boolean {
  const j = jornada(fechaLocal(ahora, horario.zona), horario);
  return !!j && ahora >= j.abre && ahora < j.cierra;
}

/**
 * Cuándo vuelve a trabajar el equipo: `ahora` si ya está trabajando; si no, el
 * inicio de la próxima jornada.
 */
export function proximaAperturaDelEquipo(
  ahora: Date,
  horario: HorarioEquipo = HORARIO_EQUIPO_POR_DEFECTO,
): Date {
  const hoy = fechaLocal(ahora, horario.zona);
  // `horario.dias` nunca está vacío (horarioEquipoDe), así que en 8 días aparece.
  for (let i = 0; i <= 7; i++) {
    const j = jornada(sumarDias(hoy, i), horario);
    if (!j || ahora >= j.cierra) continue;
    return ahora >= j.abre ? ahora : j.abre;
  }
  return ahora;
}

/**
 * Minutos del horario del equipo entre dos instantes: solo cuentan los que caen
 * dentro de una jornada. Así «un caso lleva 2 h sin tomar» no se cumple de noche
 * ni en fin de semana.
 */
export function minutosHabilesEntre(
  desde: Date,
  hasta: Date,
  horario: HorarioEquipo = HORARIO_EQUIPO_POR_DEFECTO,
): number {
  if (hasta <= desde) return 0;
  let total = 0;
  const primero = fechaLocal(desde, horario.zona);
  const ultimo = fechaLocal(hasta, horario.zona);
  const tope = Date.UTC(ultimo.y, ultimo.m - 1, ultimo.d);
  // Tope de un año de recorrido: un caso no espera más que eso.
  for (let i = 0; i < 370; i++) {
    const f = sumarDias(primero, i);
    if (Date.UTC(f.y, f.m - 1, f.d) > tope) break;
    const j = jornada(f, horario);
    if (!j) continue;
    const ini = Math.max(j.abre.getTime(), desde.getTime());
    const fin = Math.min(j.cierra.getTime(), hasta.getTime());
    if (fin > ini) total += fin - ini;
  }
  return Math.floor(total / MS_MIN);
}

const NOMBRE_DIA = [
  '',
  'el lunes',
  'el martes',
  'el miércoles',
  'el jueves',
  'el viernes',
  'el sábado',
  'el domingo',
];

/**
 * La frase que el asistente le dice al empleado al abrir su caso, según la hora:
 * «El equipo técnico está trabajando ahora: lo verá pronto.» o «El equipo técnico
 * lo revisa desde mañana a las 8:00.»
 */
export function textoCuandoLoVeElEquipo(
  ahora: Date,
  horario: HorarioEquipo = HORARIO_EQUIPO_POR_DEFECTO,
): string {
  if (enHorarioDelEquipo(ahora, horario)) {
    return 'El equipo técnico está trabajando ahora: lo verá pronto.';
  }
  const abre = proximaAperturaDelEquipo(ahora, horario);
  const hoy = fechaLocal(ahora, horario.zona);
  const dia = fechaLocal(abre, horario.zona);
  const dias = Math.round(
    (Date.UTC(dia.y, dia.m - 1, dia.d) - Date.UTC(hoy.y, hoy.m - 1, hoy.d)) /
      86_400_000,
  );
  const cuando =
    dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : NOMBRE_DIA[diaIso(dia)];
  return `El equipo técnico lo revisa desde ${cuando} a las ${horario.desdeHora}:00.`;
}
