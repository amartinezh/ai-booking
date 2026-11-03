/**
 * 🕖 Cuándo salen los avisos de la Bandeja a los agendadores (2026-11-02,
 * docs/PLAN_AVISOS_AGENDADORES.md §8).
 *
 * La clínica elige en «Configurar avisos»:
 *   · «A cualquier hora» (como siempre): el aviso sale apenas aparece el caso, también
 *     de noche, los domingos y los festivos;
 *   · «Solo en horario laboral»: de lunes a sábado, entre `desdeMin` (incluido) y
 *     `hastaMin` (excluido), hora de la clínica, y NUNCA los domingos ni los festivos
 *     de Colombia. Por defecto, de 7:00 a 17:00.
 *
 * Fuera del horario no se pierde nada: el vigilante no reclama ni envía, y el aviso
 * (o el recordatorio) sale en la primera vuelta del horario siguiente si el caso
 * sigue abierto y su cita no ha pasado. El costo, dicho en la pantalla: un caso que
 * aparece de noche para una cita de las 6:30 a. m. queda solo en la bandeja.
 *
 * Lógica pura: la usan la API (antes de enviar) y el panel (la pantalla y el guardado).
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { esFestivoColombia } from './festivos-colombia';
import { horaLocalAUtc } from './rango-estadisticas';

const MS_MIN = 60_000;

export interface HorarioAvisos {
  /** `true` = a cualquier hora (lo de siempre). */
  aCualquierHora: boolean;
  /** Minutos desde la medianoche, hora de la clínica: desde (incluido). */
  desdeMin: number;
  /** Hasta (excluido). */
  hastaMin: number;
}

/** 7:00 a 17:00: el horario laboral que propone la pantalla. */
export const HORARIO_LABORAL_POR_DEFECTO = { desdeMin: 7 * 60, hastaMin: 17 * 60 } as const;

/** Como nace una clínica: a cualquier hora, para no cambiar nada al desplegar. */
export const HORARIO_AVISOS_POR_DEFECTO: HorarioAvisos = {
  aCualquierHora: true,
  ...HORARIO_LABORAL_POR_DEFECTO,
};

/** El horario más corto que se acepta: con menos, casi nada saldría. */
export const HORARIO_AVISOS_MIN_MINUTOS = 60;

/** ¿Es un horario que tiene sentido? */
function rangoValido(desdeMin: unknown, hastaMin: unknown): boolean {
  return (
    Number.isInteger(desdeMin) &&
    Number.isInteger(hastaMin) &&
    (desdeMin as number) >= 0 &&
    (hastaMin as number) <= 24 * 60 &&
    (hastaMin as number) - (desdeMin as number) >= HORARIO_AVISOS_MIN_MINUTOS
  );
}

/**
 * El horario guardado en `HospitalMirrorConfig`. Un rango roto cae al de por defecto
 * (nunca a «no avisar jamás»), y lo ausente es «a cualquier hora».
 */
export function horarioAvisosDe(
  config?: {
    alertsOutsideHours?: boolean | null;
    alertsHoursFromMin?: number | null;
    alertsHoursToMin?: number | null;
  } | null,
): HorarioAvisos {
  const valido = rangoValido(config?.alertsHoursFromMin, config?.alertsHoursToMin);
  return {
    aCualquierHora: config?.alertsOutsideHours !== false,
    desdeMin: valido ? (config!.alertsHoursFromMin as number) : HORARIO_LABORAL_POR_DEFECTO.desdeMin,
    hastaMin: valido ? (config!.alertsHoursToMin as number) : HORARIO_LABORAL_POR_DEFECTO.hastaMin,
  };
}

/** «07:30» → 450. `null` si no es una hora del día. «24:00» vale como fin del día. */
export function leerHoraDelDia(texto: unknown): number | null {
  const r = /^(\d{1,2}):(\d{2})$/.exec(typeof texto === 'string' ? texto.trim() : '');
  if (!r) return null;
  const h = Number(r[1]);
  const m = Number(r[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

/** 450 → «07:30» (lo que muestra un `<input type="time">`). */
export function horaDelDiaATexto(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 450 → «7:30 a. m.»; 1020 → «5:00 p. m.»; 720 → «12:00 m.» (como se lee en Colombia). */
export function horaDelDiaLegible(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = String(min % 60).padStart(2, '0');
  if (min === 24 * 60) return '12:00 de la noche';
  if (h === 12 && min % 60 === 0) return '12:00 m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Por qué no se acepta un horario, o `null` si está bien. */
export function problemaDeHorarioAvisos(desdeMin: number | null, hastaMin: number | null): string | null {
  if (desdeMin === null || hastaMin === null) return 'Escribe la hora de inicio y la de fin del horario laboral.';
  if (hastaMin <= desdeMin) return 'La hora de fin del horario laboral debe ser después de la de inicio.';
  if (hastaMin - desdeMin < HORARIO_AVISOS_MIN_MINUTOS) return 'El horario laboral debe durar al menos una hora.';
  return null;
}

/** El horario en una frase: «a cualquier hora» o «de lunes a sábado, de 7:00 a. m. a 5:00 p. m., sin domingos ni festivos». */
export function textoHorarioAvisos(h: HorarioAvisos): string {
  return h.aCualquierHora
    ? 'a cualquier hora'
    : `de lunes a sábado, de ${horaDelDiaLegible(h.desdeMin)} a ${horaDelDiaLegible(h.hastaMin)}, sin domingos ni festivos`;
}

interface FechaLocal {
  y: number;
  m: number;
  d: number;
}

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

function sumarDias(f: FechaLocal, n: number): FechaLocal {
  const t = new Date(Date.UTC(f.y, f.m - 1, f.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const iso = (f: FechaLocal) => `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;

/** Un minuto del día de una fecha local, en UTC. */
function minutoLocalAUtc(f: FechaLocal, min: number, zona: string): Date {
  return new Date(horaLocalAUtc(f.y, f.m, f.d, Math.floor(min / 60), zona).getTime() + (min % 60) * MS_MIN);
}

/** La jornada de avisos de una fecha, o `null` si ese día no se avisa (domingo o festivo). */
function jornada(f: FechaLocal, h: HorarioAvisos, zona: string): { abre: Date; cierra: Date } | null {
  const domingo = new Date(Date.UTC(f.y, f.m - 1, f.d)).getUTCDay() === 0;
  if (domingo || esFestivoColombia(iso(f))) return null;
  return { abre: minutoLocalAUtc(f, h.desdeMin, zona), cierra: minutoLocalAUtc(f, h.hastaMin, zona) };
}

/** ¿Puede salir un aviso a los agendadores en este instante? */
export function puedeAvisarAhora(ahora: Date, h: HorarioAvisos, timeZone: string = DEFAULT_TIMEZONE): boolean {
  if (h.aCualquierHora) return true;
  const j = jornada(fechaLocal(ahora, timeZone), h, timeZone);
  return !!j && ahora >= j.abre && ahora < j.cierra;
}

/**
 * Cuándo vuelve a poder salir un aviso: `ahora` si ya puede; si no, el inicio de la
 * próxima jornada (de lunes a sábado, sin festivos). Para la pantalla.
 */
export function proximaVentanaDeAvisos(ahora: Date, h: HorarioAvisos, timeZone: string = DEFAULT_TIMEZONE): Date {
  if (h.aCualquierHora) return ahora;
  const hoy = fechaLocal(ahora, timeZone);
  // Un puente largo (Semana Santa) son pocos días: en 15 siempre aparece uno hábil.
  for (let i = 0; i <= 15; i++) {
    const j = jornada(sumarDias(hoy, i), h, timeZone);
    if (!j || ahora >= j.cierra) continue;
    return ahora >= j.abre ? ahora : j.abre;
  }
  return ahora;
}
