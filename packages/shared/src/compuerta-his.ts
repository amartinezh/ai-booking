/**
 * 🚪 Qué cambios de AgenIA llegan al HIS, operación por operación
 * (2026-10-15, pedido del usuario: «si está apagado, está apagado y punto»).
 *
 * Con la clínica conectada al hospital (espejo activo), cada operación sobre una
 * cita tiene UN interruptor (Configuración), que manda en todo:
 *
 *   · AGENDAR   (alta de una cita)         → `OrganizationSettings.bookingEnabled`
 *   · CANCELAR  (la cita pasa a CANCELLED) → `OrganizationSettings.cancelEnabled`
 *   · MODIFICAR (la cita cambia de cupo)   → `OrganizationSettings.rescheduleEnabled`
 *
 * Encendido: se hace por el asistente y desde el panel, y llega al hospital.
 * Apagado: NO se puede hacer en AgenIA, ni por el asistente ni desde el panel (lo
 * frena la base: `fn_interruptores_del_hospital`, en non-prisma-ddl.sql), así que
 * nunca queda nada en cola; se hace directamente en el sistema del hospital.
 *
 * El viejo «envío al hospital» (`HospitalMirrorConfig.pushEnabled`) ya no decide
 * nada: agendar quedó con su propio interruptor, como cancelar y cambiar fecha.
 *
 *   · OTRO (cupos, médicos, asistencia, EPS o motivo de una cita, y el BORRADO de
 *     una cita) → NUNCA va al hospital. La API lo cierra sin entregárselo al
 *     agente. AgenIA no borra citas (cancelar es cambiar el estado): un borrado
 *     solo sale de purgar una clínica, y eso jamás debe cancelar nada allá.
 *
 * Falla cerrado: sin fila de configuración, o con un valor que no sea
 * exactamente `true`, esa operación no llega al hospital.
 *
 * Lógica PURA: la usan la API (qué le entrega al agente), el vigilante y el monitor
 * (qué cola está detenida a propósito), el bot (qué puede hacer) y el panel.
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
  // El borrado de una cita NO es una cancelación para el hospital: ver arriba.
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
  ajustes:
    | {
        bookingEnabled?: boolean | null;
        cancelEnabled?: boolean | null;
        rescheduleEnabled?: boolean | null;
      }
    | null
    | undefined,
): CompuertasHis {
  return {
    agendar: ajustes?.bookingEnabled === true,
    cancelar: ajustes?.cancelEnabled === true,
    modificar: ajustes?.rescheduleEnabled === true,
    // Nunca: lo que no es agendar, cancelar ni cambiar de fecha no se escribe en
    // el hospital (la API lo cierra sin entregarlo).
    otros: false,
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

/** Las operaciones que la base frena con su interruptor apagado (o siempre, REACTIVAR). */
export type OperacionFrenada = 'AGENDAR' | 'CANCELAR' | 'MODIFICAR' | 'REACTIVAR';

/**
 * Si el error es el freno de la base (`fn_interruptores_del_hospital`: «el
 * interruptor de esta operación está apagado»), cuál operación frenó; si no, null.
 * Prisma trae el texto del RAISE dentro de su mensaje.
 */
export function operacionFrenadaDelError(
  error: unknown,
): OperacionFrenada | null {
  const texto =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const m = /AGENIA_OPERACION_APAGADA:(AGENDAR|CANCELAR|MODIFICAR|REACTIVAR)/.exec(
    texto,
  );
  return m ? (m[1] as OperacionFrenada) : null;
}

/** Lo que se le dice a quien intentó una operación apagada (panel o API). */
export const MENSAJE_OPERACION_APAGADA: Record<OperacionFrenada, string> = {
  AGENDAR:
    '«Agendar citas» está apagado en Configuración. Con la clínica conectada al sistema del hospital, las citas nuevas se agendan directamente en el sistema del hospital.',
  CANCELAR:
    '«Cancelar citas» está apagado en Configuración. Con la clínica conectada al sistema del hospital, las citas se cancelan directamente en el sistema del hospital.',
  MODIFICAR:
    '«Cambiar la fecha de una cita» está apagado en Configuración. Con la clínica conectada al sistema del hospital, las citas se mueven directamente en el sistema del hospital.',
  REACTIVAR:
    'Una cita cancelada no se puede reactivar: con la clínica conectada al sistema del hospital, agéndela de nuevo.',
};
