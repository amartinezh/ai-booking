/**
 * Las cifras y la vigilancia del asistente de soporte (docs/PLAN_BOT_SOPORTE.md
 * §3.7, Fase 5). Lógica PURA y sin IA (regla de «Canales en vivo»): la API junta
 * los datos de la base y de Redis, y esto decide qué se cuenta y cómo.
 *
 *  · Los códigos se borran un día después de vencer (retención), así que lo que
 *    pasa antes de la conversación —códigos pedidos, equivocados, cuentas
 *    bloqueadas, mensajes sin código— se cuenta en Redis por día.
 *  · La pregunta «que el manual no cubrió» es lo que la persona escribió antes de
 *    esa respuesta, con cédulas, teléfonos y correos ocultos: la lista sirve para
 *    mejorar el manual, no para ver datos. La conversación completa está aparte.
 */
import { diaLocal, inicioDelDiaLocal } from './consulta-citas';
import { DEFAULT_TIMEZONE } from './date-format';
import { enmascararParaIA, type MotivoCierre } from './soporte-bot';

export const VIGILANCIA_SOPORTE = {
  /** Los periodos que ofrece el panel, en días (el de hoy incluido). */
  periodos: [7, 30] as const,
  /** Los contadores de Redis viven un poco más que el periodo más largo. */
  contadoresDias: 40,
  /** Fallos de la IA de una clínica en la ventana que abren la alerta. */
  fallosIaParaAlerta: 3,
  ventanaFallosIaMin: 15,
  /** Códigos equivocados (de cualquier cuenta) en la ventana que abren la alerta. */
  codigosFallidosParaAlerta: 20,
  ventanaCodigosMin: 10,
  maxPreguntasSinCubrir: 100,
  conversacionesPorPagina: 50,
} as const;

export type PeriodoCifras = (typeof VIGILANCIA_SOPORTE.periodos)[number];

/** Lo que llega de la URL: 30 si lo pide, si no 7. */
export function periodoDeCifras(valor: unknown): PeriodoCifras {
  return Number(valor) === 30 ? 30 : 7;
}

// ─────────────────────────────────────────────────────────────
// Lo que se cuenta en Redis, por día de Colombia
// ─────────────────────────────────────────────────────────────

export const CONTADORES_SOPORTE = [
  /** Códigos generados en el panel (6 dígitos + QR cuentan como uno). */
  'codigos',
  /** Códigos equivocados o vencidos que alguien escribió. */
  'fallidos',
  /** Cuentas de Telegram bloqueadas una hora por 5 equivocados. */
  'bloqueos',
  /** Mensajes de cuentas sin conversación: se les pidió el código. */
  'sinCodigo',
] as const;
export type ContadorSoporte = (typeof CONTADORES_SOPORTE)[number];

/** Un hash por día: `HINCRBY soporte:cifras:2026-10-20 fallidos 1`. */
export function claveCifrasDelDia(dia: string): string {
  return `soporte:cifras:${dia}`;
}

/** Los días (`YYYY-MM-DD`, en la zona dada) del periodo, del más viejo a hoy. */
export function diasDelPeriodo(
  ahora: Date,
  dias: number,
  timeZone: string = DEFAULT_TIMEZONE,
): string[] {
  const [y, m, d] = diaLocal(ahora, timeZone).split('-').map(Number);
  return Array.from({ length: dias }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1, d - (dias - 1 - i)));
    return t.toISOString().slice(0, 10);
  });
}

/** Medianoche (en la zona dada) del primer día del periodo. */
export function inicioDelPeriodo(
  ahora: Date,
  dias: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [primero] = diasDelPeriodo(ahora, dias, timeZone);
  // Mediodía UTC de ese día cae dentro de él en cualquier zona de América.
  return inicioDelDiaLocal(new Date(`${primero}T12:00:00Z`), timeZone);
}

/** Suma los hashes de cada día (`HGETALL`; un día sin nada viene vacío o `null`). */
export function sumarContadores(
  porDia: Array<Record<string, string> | null | undefined>,
): Record<ContadorSoporte, number> {
  const total = Object.fromEntries(
    CONTADORES_SOPORTE.map((c) => [c, 0]),
  ) as Record<ContadorSoporte, number>;
  for (const dia of porDia) {
    for (const c of CONTADORES_SOPORTE) {
      const n = Number(dia?.[c] ?? 0);
      if (Number.isFinite(n) && n > 0) total[c] += n;
    }
  }
  return total;
}

/** La ventana de N minutos de un instante (para las claves de las alertas). */
export function ventanaDe(ahora: Date, minutos: number): number {
  return Math.floor(ahora.getTime() / (minutos * 60_000));
}

// ─────────────────────────────────────────────────────────────
// Cuentas
// ─────────────────────────────────────────────────────────────

/** Percentil por el método del rango más cercano; `null` sin datos. */
export function percentil(valores: number[], p: number): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const rango = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length, Math.max(1, rango)) - 1];
}

export function promedio(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/** Entero de 0 a 100; `null` si no hay base. */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 100) : null;
}

// ─────────────────────────────────────────────────────────────
// Lo que el manual no cubrió
// ─────────────────────────────────────────────────────────────

export interface MensajeDeLaConversacion {
  id: string;
  direction: 'ENTRADA' | 'SALIDA' | string;
  text: string;
  uncovered: boolean;
}

/**
 * Para cada respuesta marcada «no cubierta», lo que la persona escribió antes de
 * ella (desde la respuesta anterior, sin los comandos), con los datos ocultos.
 * `mensajes`: los de UNA conversación, en orden.
 */
export function preguntasSinCubrir(
  mensajes: MensajeDeLaConversacion[],
): Array<{ respuestaId: string; pregunta: string }> {
  const salida: Array<{ respuestaId: string; pregunta: string }> = [];
  let pendientes: string[] = [];
  for (const m of mensajes) {
    if (m.direction === 'ENTRADA') {
      const t = m.text.trim();
      if (t && !t.startsWith('/')) pendientes.push(t);
      continue;
    }
    if (m.uncovered && pendientes.length > 0) {
      salida.push({
        respuestaId: m.id,
        pregunta: enmascararParaIA(pendientes.join(' · '), 500),
      });
    }
    pendientes = [];
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────
// Lo que el panel recibe (la API lo arma, la web lo muestra)
// ─────────────────────────────────────────────────────────────

export interface CifrasAsistente {
  periodo: { dias: PeriodoCifras; desde: string; hasta: string };
  conversaciones: { total: number; personas: number; clinicas: number };
  respuestas: {
    total: number;
    conIA: number;
    sinIA: number;
    sinCubrir: number;
    /** De las respuestas con IA. */
    tiempoMedioMs: number | null;
    tiempoP90Ms: number | null;
  };
  resultado: {
    /** Conversaciones con al menos una respuesta del manual. */
    conRespuesta: number;
    /** De esas, cuántas terminaron sin abrir un caso. */
    sinCaso: number;
    porcentajeSinCaso: number | null;
    casosAbiertos: number;
    utiles: number;
    noUtiles: number;
  };
  codigo: {
    pedidos: number;
    /** Conversaciones que se abrieron (cada una gastó un código). */
    usados: number;
    sinUsar: number;
    fallidos: number;
    bloqueos: number;
    mensajesSinCodigo: number;
  };
  porClinica: Array<{
    organizationId: string;
    nombre: string;
    conversaciones: number;
    personas: number;
    respuestasIA: number;
    respuestasSinIA: number;
    tokensEntrada: number;
    tokensSalida: number;
    casos: number;
  }>;
}

export interface PreguntaSinCubrir {
  fecha: string;
  conversationId: string;
  clinica: string;
  rol: string;
  pregunta: string;
}

export type FiltroConversaciones =
  | 'TODAS'
  | 'CON_CASO'
  | 'SIN_CUBRIR'
  | 'NO_UTIL';

export function filtroDeConversaciones(valor: unknown): FiltroConversaciones {
  return valor === 'CON_CASO' || valor === 'SIN_CUBRIR' || valor === 'NO_UTIL'
    ? valor
    : 'TODAS';
}

export interface FilaConversacion {
  id: string;
  inicio: string;
  ultimoMensaje: string;
  cierre: string | null;
  motivoCierre: string | null;
  clinica: string;
  correo: string;
  rol: string;
  prueba: boolean;
  mensajes: number;
  feedback: string | null;
  sinCubrir: boolean;
  casos: number[];
}

export interface DetalleConversacion extends FilaConversacion {
  telegramName: string | null;
  casosDetalle: Array<{ numero: number; titulo: string; estado: string }>;
  mensajesDetalle: Array<{
    id: string;
    fecha: string;
    direccion: 'ENTRADA' | 'SALIDA';
    texto: string;
    fuente: string | null;
    tipo: string | null;
    temas: string[];
    sinCubrir: boolean;
    proveedor: string | null;
    tokensEntrada: number | null;
    tokensSalida: number | null;
    latenciaMs: number | null;
  }>;
}

/** Cómo se lee el motivo de cierre de una conversación. */
export const TEXTO_MOTIVO_CIERRE: Record<MotivoCierre, string> = {
  INACTIVIDAD: 'Se cerró sola (sin mensajes)',
  SALIR: 'La cerró con /salir',
  PANEL: 'La cerró desde el panel',
  OTRA_CONVERSACION: 'Se abrió otra conversación',
  ACCESO_REVOCADO: 'Perdió el acceso',
};
