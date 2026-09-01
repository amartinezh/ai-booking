import type { DriverCursor } from './driver.interface';

/**
 * Estado local del agente: cursor de detección de cambios del driver, último
 * `seq` del outbox ya procesado, y el registro de `event_id` ya aplicados
 * hacia el HIS (idempotencia del lado del agente — el análogo de
 * `AppliedEvents` en AGENIA_SYNC, ver PLAN_ESPEJO_HOSPITAL.md §5.1e).
 *
 * ⚠️ La única implementación es `FileAgentStateStore`, y es a propósito.
 *
 * Hubo una en memoria, y resultó ser un fallo grave disfrazado de simplicidad:
 * el cursor del driver no es una marca de tiempo, es una FOTO del HIS. Al
 * arrancar sin ella se toma una nueva, que YA incluye todo lo ocurrido
 * mientras el agente estuvo caído — así que esos cambios no se reportan nunca.
 * Un reinicio para aplicar parches bastaba para que una cita agendada en
 * ventanilla desapareciera del lado de AgenIA y ese cupo se siguiera vendiendo
 * por WhatsApp. Se reprodujo en la VM simulada (apps/mirror-agent/local-vm/).
 *
 * Si algún día hace falta otra implementación (SQLite, la base AGENIA_SYNC del
 * propio HIS), que persista: una que no lo haga vuelve a introducir eso.
 */
export interface AgentStateStore {
  getOutboxCursor(): Promise<string>;
  setOutboxCursor(seq: string): Promise<void>;

  getDriverCursor(): Promise<DriverCursor | null>;
  setDriverCursor(cursor: DriverCursor): Promise<void>;

  hasAppliedLocally(eventId: string): Promise<boolean>;
  markAppliedLocally(eventId: string): Promise<void>;
}
