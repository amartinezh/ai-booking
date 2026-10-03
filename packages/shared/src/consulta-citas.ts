/**
 * ══════════════════════════════════════════════════════════════════════════
 * CONSULTA DE CITAS DEL PACIENTE ("¿qué citas tengo?")
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Lógica PURA que usa el bot (y, para el estado de la conexión, la pantalla del
 * rastreo). Tres preguntas, cada una con una sola respuesta para todo el repo:
 *
 *   1. ¿En qué estado está la conexión con el hospital de esta clínica?
 *      Genérico a propósito: no sabe qué HIS ni qué driver hay detrás, solo lee
 *      las señales que cualquier agente reporta. Una clínica sin hospital es un
 *      caso normal (`SIN_HOSPITAL`), no un error.
 *   2. ¿Quien escribe es el paciente consultado? Decide si el bot muestra el
 *      detalle de las citas o solo una respuesta mínima.
 *   3. ¿Qué día es "hoy" en la zona de la clínica? Los contenedores corren en
 *      UTC (ver CLAUDE.md): sin zona explícita, "hoy" cambia a las 7 p. m.
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { LIMITES_CONSULTA_HIS } from './his-lookup';
import { variantesDeTelefono } from './patient-search';
import { horaLocalAUtc } from './rango-estadisticas';

// ─────────────────────────────────────────────────────────────
// 1. Estado de la conexión con el hospital
// ─────────────────────────────────────────────────────────────

/**
 * · SIN_HOSPITAL — la clínica no tiene espejo con ningún HIS: su agenda es
 *   solo la de AgenIA y no hay nada más que consultar.
 * · APAGADA      — hay hospital, pero alguien apagó el espejo o la consulta.
 * · CAIDA        — está encendida, pero el agente no responde, no alcanza su
 *   HIS o no sabe hacer la consulta en vivo.
 * · VIVA         — se le puede preguntar al HIS ahora mismo.
 */
export type EstadoConexionHis = 'SIN_HOSPITAL' | 'APAGADA' | 'CAIDA' | 'VIVA';

/** Por qué no está VIVA. El orden es el de `estadoConexionHis`. */
export type MotivoConexionHis =
  | 'SIN_ESPEJO'
  | 'ESPEJO_DESHABILITADO'
  | 'CONSULTA_DESHABILITADA'
  | 'SIN_LATIDO'
  | 'LATIDO_VIEJO'
  | 'HIS_INALCANZABLE'
  | 'AGENTE_SIN_CONSULTA';

/** Las columnas de `HospitalMirrorConfig` que deciden el estado. */
export interface ConfigConexionHis {
  enabled: boolean;
  lookupEnabled: boolean;
  lastLookupCapable: boolean | null;
  lastHeartbeatAt: Date | null;
  lastHisReachable: boolean | null;
}

export interface ConexionHis {
  estado: EstadoConexionHis;
  /** `null` solo cuando está VIVA. */
  motivo: MotivoConexionHis | null;
  /** Minutos desde el último latido; `null` si nunca latió o no hay espejo. */
  minutosSinLatido: number | null;
}

/**
 * El orden va de lo que se arregla en la clínica (encender el espejo) a lo que
 * se arregla en el hospital (el agente, su HIS, su versión).
 */
export function estadoConexionHis(
  config: ConfigConexionHis | null | undefined,
  ahora: Date,
): ConexionHis {
  if (!config) {
    return { estado: 'SIN_HOSPITAL', motivo: 'SIN_ESPEJO', minutosSinLatido: null };
  }
  const minutosSinLatido = config.lastHeartbeatAt
    ? Math.floor((ahora.getTime() - config.lastHeartbeatAt.getTime()) / 60_000)
    : null;
  const con = (
    estado: EstadoConexionHis,
    motivo: MotivoConexionHis | null,
  ): ConexionHis => ({ estado, motivo, minutosSinLatido });

  if (!config.enabled) return con('APAGADA', 'ESPEJO_DESHABILITADO');
  if (!config.lookupEnabled) return con('APAGADA', 'CONSULTA_DESHABILITADA');
  if (minutosSinLatido === null) return con('CAIDA', 'SIN_LATIDO');
  // El mismo umbral con que el rastreo decide si encola una consulta en vivo.
  if (minutosSinLatido > LIMITES_CONSULTA_HIS.latidoMaxMin) {
    return con('CAIDA', 'LATIDO_VIEJO');
  }
  if (config.lastHisReachable === false) return con('CAIDA', 'HIS_INALCANZABLE');
  // `null` (un agente anterior a la consulta en vivo, que no lo dice) cuenta como "no".
  if (config.lastLookupCapable !== true) {
    return con('CAIDA', 'AGENTE_SIN_CONSULTA');
  }
  return con('VIVA', null);
}

// ─────────────────────────────────────────────────────────────
// 2. ¿Quien escribe es el paciente?
// ─────────────────────────────────────────────────────────────

/** Los canales guardados en la ficha del paciente (`PatientProfile`). */
export interface CanalesDelPaciente {
  whatsappId: string | null;
  bsuid: string | null;
  telegramChatId: string | null;
}

/** Lo que se sabe de quien escribe en este turno. */
export interface RemitenteDelTurno {
  phone: string | null;
  bsuid: string | null;
  /** Solo existe en Telegram. */
  telegramChatId?: string | null;
}

/**
 * ¿El mensaje viene de un canal que ya está en la ficha del paciente?
 *
 * Falla CERRADO: si no hay con qué comparar, la respuesta es no. Mostrar el
 * detalle de las citas de otra persona (especialidad, médico, hora) es un dato
 * de salud; negárselo a su dueño solo le cuesta una llamada a la clínica.
 *
 * · Telegram: el chat tiene que ser el mismo. Nunca se compara un chat de
 *   Telegram con un teléfono: `tg:3001234567` no es el celular 3001234567.
 * · WhatsApp: el mismo BSUID, o el mismo teléfono en cualquiera de sus formas
 *   (con o sin el 57; la ficha puede venir del HIS con otro formato).
 */
export function remitenteEsDelPaciente(
  paciente: CanalesDelPaciente,
  remitente: RemitenteDelTurno,
): boolean {
  const chat = remitente.telegramChatId?.trim();
  if (chat) return paciente.telegramChatId?.trim() === chat;

  const bsuid = remitente.bsuid?.trim();
  if (bsuid && paciente.bsuid?.trim() === bsuid) return true;

  const delRemitente = variantesDeTelefono(soloDigitos(remitente.phone));
  if (delRemitente.length === 0) return false;
  const delPaciente = variantesDeTelefono(soloDigitos(paciente.whatsappId));
  return delPaciente.some((v) => delRemitente.includes(v));
}

const soloDigitos = (valor: string | null | undefined): string =>
  (valor ?? '').replace(/\D/g, '');

// ─────────────────────────────────────────────────────────────
// 3. "Hoy" en la zona de la clínica
// ─────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` del instante en la zona dada. */
export function diaLocal(
  instante: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Medianoche (en la zona dada) del día al que pertenece `instante`, en UTC. */
export function inicioDelDiaLocal(
  instante: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [y, m, d] = diaLocal(instante, timeZone).split('-').map(Number);
  return horaLocalAUtc(y, m, d, 0, timeZone);
}
