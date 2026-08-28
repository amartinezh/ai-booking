import type { DriverCursor } from './driver.interface';

/**
 * Estado local persistente del agente: cursor de detección de cambios del
 * driver, último `seq` del outbox ya procesado, y el registro de event_id
 * ya aplicados hacia el HIS (idempotencia del lado del agente — el análogo
 * de AppliedEvents en AGENIA_SYNC, ver PLAN_ESPEJO_HOSPITAL.md §5.1e).
 *
 * ⚠️ Fase 1 solo trae la implementación en memoria (`InMemoryAgentStateStore`)
 * — suficiente para probar la lógica del motor. Antes de desplegar el agente
 * de verdad contra un hospital hace falta una implementación persistente
 * (SQLite local o la BD `AGENIA_SYNC` del driver SQL Server) que sobreviva a
 * reinicios del proceso; si no, un reinicio del agente perdería el cursor y
 * reprocesaría todo desde cero. Implementar esa persistencia es trabajo de
 * Fase 2, cuando haya un driver real corriendo contra un hospital.
 */
export interface AgentStateStore {
  getOutboxCursor(): Promise<string>;
  setOutboxCursor(seq: string): Promise<void>;

  getDriverCursor(): Promise<DriverCursor | null>;
  setDriverCursor(cursor: DriverCursor): Promise<void>;

  hasAppliedLocally(eventId: string): Promise<boolean>;
  markAppliedLocally(eventId: string): Promise<void>;
}

export class InMemoryAgentStateStore implements AgentStateStore {
  private outboxCursor = '0';
  private driverCursor: DriverCursor | null = null;
  private readonly appliedEventIds = new Set<string>();

  async getOutboxCursor(): Promise<string> {
    return this.outboxCursor;
  }

  async setOutboxCursor(seq: string): Promise<void> {
    this.outboxCursor = seq;
  }

  async getDriverCursor(): Promise<DriverCursor | null> {
    return this.driverCursor;
  }

  async setDriverCursor(cursor: DriverCursor): Promise<void> {
    this.driverCursor = cursor;
  }

  async hasAppliedLocally(eventId: string): Promise<boolean> {
    return this.appliedEventIds.has(eventId);
  }

  async markAppliedLocally(eventId: string): Promise<void> {
    this.appliedEventIds.add(eventId);
  }
}
