/**
 * Vocabulario de `SyncAudit.direction` — la fuente única.
 *
 * El comentario del schema decía `'OUTBOUND' | 'INBOUND'`, pero nadie escribe
 * `OUTBOUND`: el código escribía cadenas sueltas repartidas entre el módulo
 * mirror (API) y las acciones del panel (web), y la pantalla de auditoría del
 * espejo las traduce con su propio mapa. Centralizarlas evita que una errata
 * cree una dirección nueva que ningún filtro conoce.
 *
 * La columna sigue siendo texto libre a propósito, y las filas históricas NO se
 * migran: solo se deja de inventar valores. Ver docs/PLAN_RASTREO_PACIENTE.md §8 #6.
 */
export const SYNC_AUDIT_DIRECTION = {
  /** AgenIA → HIS: entrega del outbox y reproceso desde el panel. */
  AGENIA_TO_HIS: 'AGENIA_TO_HIS',
  /** HIS → AgenIA: eventos de citas aplicados por `POST /mirror/changes`. */
  INBOUND: 'INBOUND',
  /** HIS → AgenIA: importación de la agenda (disponibilidad de cupos). */
  HIS_TO_AGENIA: 'HIS_TO_AGENIA',
  /** Reconciliación diaria de las dos agendas. */
  RECONCILE: 'RECONCILE',
  /** Cambios de configuración del espejo hechos desde el panel. */
  CONFIG: 'CONFIG',
} as const;

export type SyncAuditDirection =
  (typeof SYNC_AUDIT_DIRECTION)[keyof typeof SYNC_AUDIT_DIRECTION];
