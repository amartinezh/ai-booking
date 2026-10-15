/**
 * 🚪 Qué cambios de AgenIA pueden llegar al HIS, operación por operación
 * (2026-10-15, pedido del usuario).
 *
 * Antes había UNA compuerta: `HospitalMirrorConfig.pushEnabled` dejaba pasar todo o
 * nada. Ahora cada operación sobre una cita tiene la suya, la MISMA que decide si el
 * bot la hace:
 *
 *   · AGENDAR   (alta de una cita)        → `pushEnabled`, «envío de citas nuevas al
 *                                           hospital» en /dashboard/espejo. El bot,
 *                                           además, necesita `bookingEnabled`.
 *   · CANCELAR  (la cita pasa a CANCELLED) → `OrganizationSettings.cancelEnabled`.
 *   · MODIFICAR (la cita cambia de cupo)   → `OrganizationSettings.rescheduleEnabled`.
 *   · OTRO      (cupos, médicos, asistencia, EPS o motivo de una cita) → `pushEnabled`,
 *                                           como antes. Hoy el agente no escribe nada
 *                                           de esto en el HIS (lo declina), pero si un
 *                                           driver lo hiciera algún día, no se abre solo.
 *
 * Aplica a TODO lo que nace en AgenIA, venga del bot o del panel: una cancelación
 * hecha por el personal también espera a que «Cancelar» esté encendido.
 *
 * Falla cerrado: sin fila de configuración, o con un valor que no sea exactamente
 * `true`, esa compuerta no deja pasar nada hacia el hospital.
 *
 * Lógica PURA: la usan la API (qué le entrega al agente), el vigilante y el monitor
 * (qué cola está detenida a propósito) y el bot (qué puede hacer).
 */

export type OperacionHis = 'AGENDAR' | 'CANCELAR' | 'MODIFICAR' | 'OTRO';

export interface CompuertasHis {
  agendar: boolean;
  cancelar: boolean;
  modificar: boolean;
  otros: boolean;
}

/** Lo que hace falta de una fila de `SyncOutbox` para clasificarla. */
export interface EventoHaciaElHis {
  entityType: string;
  op: string;
  payload: unknown;
}

const comoObjeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/**
 * Qué le hará el agente al HIS con este evento. El mismo criterio que el motor del
 * agente (`engine.ts`): primero la cancelación (estado CANCELLED), luego el cambio de
 * cupo; cualquier otro UPDATE de una cita (asistencia, EPS, motivo) no se escribe.
 */
export function operacionHisDelEvento(e: EventoHaciaElHis): OperacionHis {
  if (e.entityType !== 'APPOINTMENT') return 'OTRO';
  if (e.op === 'INSERT') return 'AGENDAR';
  if (e.op === 'DELETE') return 'CANCELAR';
  if (e.op !== 'UPDATE') return 'OTRO';
  const fila = comoObjeto(e.payload);
  if (fila.status === 'CANCELLED') return 'CANCELAR';
  const anterior = comoObjeto(fila.__old).scheduleSlotId;
  if (
    typeof anterior === 'string' &&
    typeof fila.scheduleSlotId === 'string' &&
    anterior !== fila.scheduleSlotId
  ) {
    return 'MODIFICAR';
  }
  return 'OTRO';
}

export function compuertasHis(
  espejo: { pushEnabled?: boolean | null } | null | undefined,
  ajustes:
    | { cancelEnabled?: boolean | null; rescheduleEnabled?: boolean | null }
    | null
    | undefined,
): CompuertasHis {
  const envio = espejo?.pushEnabled === true;
  return {
    agendar: envio,
    cancelar: ajustes?.cancelEnabled === true,
    modificar: ajustes?.rescheduleEnabled === true,
    otros: envio,
  };
}

export function compuertaAbierta(op: OperacionHis, c: CompuertasHis): boolean {
  switch (op) {
    case 'AGENDAR':
      return c.agendar;
    case 'CANCELAR':
      return c.cancelar;
    case 'MODIFICAR':
      return c.modificar;
    default:
      return c.otros;
  }
}

export const algunaCompuertaAbierta = (c: CompuertasHis): boolean =>
  c.agendar || c.cancelar || c.modificar || c.otros;

/** ¿Este evento puede salir hacia el HIS ahora? */
export const eventoPuedeSalir = (
  e: EventoHaciaElHis,
  c: CompuertasHis,
): boolean => compuertaAbierta(operacionHisDelEvento(e), c);
