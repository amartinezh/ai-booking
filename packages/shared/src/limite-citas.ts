/**
 * ══════════════════════════════════════════════════════════════════════════
 * LÍMITE DE CITAS POR PACIENTE (por el bot)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La clínica fija cuántas citas puede tener un paciente el MISMO DÍA y en el
 * MISMO MES calendario (/dashboard/limites-citas; lo editan el administrador y
 * el agendador). El bot no agenda, no asigna un cupo de la lista de espera ni
 * cambia una cita de fecha si con eso el paciente pasaría del límite: se
 * disculpa, lo remite al teléfono del hospital y le deja un enlace para pedir
 * una revisión (`AppointmentLimitRequest`). Una revisión APROBADA le concede
 * citas adicionales para ese día o ese mes.
 *
 * Se cuenta por la FECHA DE LA CITA, no por el día en que se pidió: «una cita
 * al día» es una cita para el mismo día. Cuentan todas las citas vigentes del
 * paciente (agendadas o atendidas, de cualquier origen: bot, panel o
 * hospital); las canceladas no.
 *
 * El día y el mes son los de la clínica (America/Bogota por defecto), nunca los
 * del contenedor (UTC): una cita a las 8 p. m. de Bogotá es la 1 a. m. del día
 * siguiente en UTC y caería en otro día (ver CLAUDE.md, fechas).
 *
 * El personal no tiene límite: agenda desde el panel cuantas citas haga falta.
 */
import { DEFAULT_TIMEZONE, formatDateOnly } from './date-format';
import { horaLocalAUtc } from './rango-estadisticas';
import { diaLocal } from './consulta-citas';

/** Los dos límites. Mismos valores que el enum `AppointmentLimitKind` de Prisma. */
export type TipoLimiteCitas = 'DAILY' | 'MONTHLY';

export const LIMITE_CITAS = {
  /** Lo que aplica una clínica que nunca tocó el ajuste (lo pidió el hospital). */
  DEFAULT_DIA: 1,
  DEFAULT_MES: 3,
  MIN: 1,
  MAX_DIA: 10,
  MAX_MES: 31,
} as const;

/** Entero dentro de [MIN, max]; cualquier cosa inválida cae al default. */
function normalizar(valor: unknown, porDefecto: number, max: number): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) return porDefecto;
  return Math.min(max, Math.max(LIMITE_CITAS.MIN, Math.round(n)));
}

export function normalizarLimiteDia(valor: unknown): number {
  return normalizar(valor, LIMITE_CITAS.DEFAULT_DIA, LIMITE_CITAS.MAX_DIA);
}

export function normalizarLimiteMes(valor: unknown): number {
  return normalizar(valor, LIMITE_CITAS.DEFAULT_MES, LIMITE_CITAS.MAX_MES);
}

/** Lo que la clínica configuró. Sin fila de settings = los defaults, encendidos. */
export interface LimitesCitas {
  diaActivo: boolean;
  maxDia: number;
  mesActivo: boolean;
  maxMes: number;
}

/** Normaliza la fila de `OrganizationSettings` (o su ausencia). */
export function limitesDeLaClinica(
  s:
    | {
        dailyAppointmentLimitEnabled?: boolean | null;
        maxAppointmentsPerDay?: number | null;
        monthlyAppointmentLimitEnabled?: boolean | null;
        maxAppointmentsPerMonth?: number | null;
      }
    | null
    | undefined,
): LimitesCitas {
  return {
    diaActivo: s?.dailyAppointmentLimitEnabled ?? true,
    maxDia: normalizarLimiteDia(s?.maxAppointmentsPerDay),
    mesActivo: s?.monthlyAppointmentLimitEnabled ?? true,
    maxMes: normalizarLimiteMes(s?.maxAppointmentsPerMonth),
  };
}

/** El día o el mes (de la clínica) al que pertenece una cita. */
export interface PeriodoLimite {
  tipo: TipoLimiteCitas;
  /** `YYYY-MM-DD` (día) o `YYYY-MM` (mes), en la hora de la clínica. */
  clave: string;
  /** Inicio del periodo, incluido (instante UTC). */
  desde: Date;
  /** Fin del periodo, EXCLUIDO (instante UTC). */
  hasta: Date;
}

export function periodoDelLimite(
  tipo: TipoLimiteCitas,
  instante: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): PeriodoLimite {
  const [y, m, d] = diaLocal(instante, timeZone).split('-').map(Number);
  if (tipo === 'DAILY') {
    const siguiente = new Date(Date.UTC(y, m - 1, d + 1));
    return {
      tipo,
      clave: diaLocal(instante, timeZone),
      desde: horaLocalAUtc(y, m, d, 0, timeZone),
      hasta: horaLocalAUtc(
        siguiente.getUTCFullYear(),
        siguiente.getUTCMonth() + 1,
        siguiente.getUTCDate(),
        0,
        timeZone,
      ),
    };
  }
  const siguienteMes = new Date(Date.UTC(y, m, 1));
  return {
    tipo,
    clave: `${y}-${String(m).padStart(2, '0')}`,
    desde: horaLocalAUtc(y, m, 1, 0, timeZone),
    hasta: horaLocalAUtc(
      siguienteMes.getUTCFullYear(),
      siguienteMes.getUTCMonth() + 1,
      1,
      0,
      timeZone,
    ),
  };
}

const MESES = [
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
];

/**
 * El periodo en palabras: «martes, 20 de octubre de 2026» o «octubre de 2026».
 * Recibe la `clave` guardada (no un instante), para que el panel la muestre
 * igual que el día en que el bot la calculó.
 */
export function etiquetaPeriodo(
  tipo: TipoLimiteCitas,
  clave: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (tipo === 'MONTHLY') {
    const r = /^(\d{4})-(\d{2})$/.exec(clave);
    if (!r) return clave;
    return `${MESES[Number(r[2]) - 1] ?? r[2]} de ${r[1]}`;
  }
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clave);
  if (!r) return clave;
  // Mediodía local: lejos de la medianoche, el día no cambia en ninguna zona.
  const mediodia = horaLocalAUtc(
    Number(r[1]),
    Number(r[2]),
    Number(r[3]),
    12,
    timeZone,
  );
  return `${formatDateOnly(mediodia, { timeZone })} de ${r[1]}`;
}

/** Por qué el bot no puede asignar la cita. */
export interface LimiteSuperado {
  tipo: TipoLimiteCitas;
  /** El tope que aplica: el de la clínica más las citas adicionales aprobadas. */
  limite: number;
  /** El de la clínica, sin adicionales. */
  limiteBase: number;
  /** Citas vigentes que el paciente ya tiene en ese periodo. */
  citas: number;
  periodo: PeriodoLimite;
}

/**
 * La decisión, sin base de datos: con las citas que el paciente ya tiene en el
 * día y en el mes de la cita nueva, y las adicionales aprobadas para cada uno,
 * ¿pasa del límite? Se revisa primero el día (es el más concreto). `null` = se
 * puede asignar.
 */
export function evaluarLimiteCitas(p: {
  limites: LimitesCitas;
  dia: { periodo: PeriodoLimite; citas: number; adicionales: number };
  mes: { periodo: PeriodoLimite; citas: number; adicionales: number };
}): LimiteSuperado | null {
  const { limites, dia, mes } = p;
  if (limites.diaActivo) {
    const limite = limites.maxDia + Math.max(0, dia.adicionales);
    if (dia.citas >= limite) {
      return {
        tipo: 'DAILY',
        limite,
        limiteBase: limites.maxDia,
        citas: dia.citas,
        periodo: dia.periodo,
      };
    }
  }
  if (limites.mesActivo) {
    const limite = limites.maxMes + Math.max(0, mes.adicionales);
    if (mes.citas >= limite) {
      return {
        tipo: 'MONTHLY',
        limite,
        limiteBase: limites.maxMes,
        citas: mes.citas,
        periodo: mes.periodo,
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// SOLICITUD DE REVISIÓN (más citas de las permitidas)
// ─────────────────────────────────────────────────────────────

export const SOLICITUD_CITAS = {
  /** Días que el enlace que manda el bot sirve para radicar la solicitud. */
  VIGENCIA_ENLACE_DIAS: 7,
  /**
   * Solicitudes radicadas por paciente y periodo. Pasado el tope, el bot ya no
   * manda enlace: solo el teléfono del hospital (contra el abuso del enlace).
   */
  MAX_POR_PERIODO: 3,
  MIN_ARGUMENTO: 15,
  MAX_ARGUMENTO: 2000,
  /** Citas adicionales que se pueden pedir o conceder en una solicitud. */
  MAX_ADICIONALES: 5,
  MAX_NOTA_REVISION: 1000,
} as const;

/** Motivos que el paciente elige en el formulario (el argumento va aparte). */
export const MOTIVOS_SOLICITUD_CITAS = [
  { id: 'TRATAMIENTO', etiqueta: 'Estoy en un tratamiento o control que lo requiere' },
  { id: 'ORDEN_MEDICA', etiqueta: 'Tengo una orden médica para otra cita' },
  { id: 'VARIOS_SERVICIOS', etiqueta: 'Necesito servicios distintos (p. ej. medicina y laboratorio)' },
  { id: 'CONDICION_CRONICA', etiqueta: 'Tengo una enfermedad crónica o soy paciente prioritario' },
  { id: 'OTRO', etiqueta: 'Otro motivo' },
] as const;

export type MotivoSolicitudCitas = (typeof MOTIVOS_SOLICITUD_CITAS)[number]['id'];

export function esMotivoSolicitudCitas(v: unknown): v is MotivoSolicitudCitas {
  return MOTIVOS_SOLICITUD_CITAS.some((m) => m.id === v);
}

export function etiquetaMotivoSolicitudCitas(id: string | null | undefined): string {
  return MOTIVOS_SOLICITUD_CITAS.find((m) => m.id === id)?.etiqueta ?? '—';
}

/** «1 cita», «3 citas». */
export function citasEnTexto(n: number): string {
  return n === 1 ? '1 cita' : `${n} citas`;
}

/** Cómo se nombra cada límite en el panel. */
export const TEXTO_TIPO_LIMITE: Record<
  TipoLimiteCitas,
  { nombre: string; porPeriodo: string }
> = {
  DAILY: { nombre: 'Límite diario', porPeriodo: 'por día' },
  MONTHLY: { nombre: 'Límite mensual', porPeriodo: 'por mes' },
};
