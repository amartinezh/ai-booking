/**
 * Contrato canónico del protocolo /mirror/* — el motor genérico de espejo de
 * citas con HIS externos (ver docs/PLAN_ESPEJO_HOSPITAL.md). Vive en
 * @agenia/shared porque tanto `apps/api` (módulo mirror) como
 * `apps/mirror-agent` (el agente on-premise, cualquier driver) hablan
 * exactamente este mismo JSON — un solo lugar evita que el contrato derive
 * entre los dos lados con el tiempo.
 *
 * Nada aquí debe referenciar un HIS específico (nombre de tabla, formato de
 * fecha de un proveedor) — eso vive exclusivamente en cada driver.
 */

export type CanonicalEntityType =
  | 'SLOT'
  | 'DOCTOR'
  | 'APPOINTMENT'
  | 'PATIENT'
  | 'SERVICE'
  | 'EPS';

export type CanonicalOp = 'INSERT' | 'UPDATE' | 'DELETE';

// ── POST /mirror/handshake ──────────────────────────────────────────────────

export interface HandshakeInput {
  driverVersion: string;
  /** Reloj del agente al momento del handshake, ISO-8601 UTC. */
  agentClockIso: string;
}

export interface HandshakeResult {
  ok: boolean;
  serverTimeIso: string;
  clockSkewMs: number;
  driverKey: string;
  driverConfig: unknown;
  mappingVersion: number;
  mappingJson: unknown;
  pushEnabled: boolean;
  pullEnabled: boolean;
}

// ── GET /mirror/events ──────────────────────────────────────────────────────

export interface OutboxEventDto {
  /** BigInt serializado como string — JSON no representa int64 con precisión. */
  seq: string;
  eventId: string;
  entityType: CanonicalEntityType;
  entityId: string;
  op: CanonicalOp;
  payload: unknown;
  createdAt: string;
}

// ── POST /mirror/ack ─────────────────────────────────────────────────────────

export interface AckInput {
  /** Los `seq` (como string) que el agente aplicó con éxito hacia el HIS. */
  seqs: string[];
  /**
   * `seq` que el agente intentó aplicar y el HIS rechazó (constraint, dato
   * faltante...). El servidor lleva la cuenta de intentos y pasa a
   * dead-letter tras el máximo — ver plan §6 capa 4. NO se descartan: quedan
   * pendientes (sin ack) hasta agotar los reintentos.
   */
  failedSeqs?: string[];
}

export interface AckResult {
  acknowledged: number;
}

// ── POST /mirror/changes ────────────────────────────────────────────────────

/**
 * Evento ya canonicalizado por el driver — el agente hizo toda la traducción
 * antes de subirlo. Los campos de `payload` son opcionales porque no todos
 * los eventos son cancelaciones ni todos los HIS capturan lo mismo.
 */
export interface CanonicalChangeEvent {
  eventId: string; // idempotencia — generado por el AGENTE, no por el HIS
  entityType: CanonicalEntityType;
  op: CanonicalOp | 'CANCEL' | 'ATTENDANCE';
  occurredAtIso: string; // UTC — el driver ya hizo la conversión de zona horaria
  payload: {
    // Identidad homologada (resuelta por el driver vía su MirrorMap)
    agenIAAppointmentId?: string;
    agenIAPatientId?: string;
    agenIADoctorId?: string;
    agenIAScheduleSlotId?: string;
    // Datos mínimos para crear/actuar cuando el evento viene sin homologar aún
    startTimeIso?: string;
    endTimeIso?: string;
    patientDocument?: string;
    doctorExternalKey?: string;
    serviceExternalKey?: string;
    attendanceStatus?: string;
    cancelReason?: string;
    cancelObservations?: string;
  };
}

export interface ChangesInput {
  events: CanonicalChangeEvent[];
}

export interface ChangesResult {
  applied: number;
  skipped: number; // ya aplicados antes (idempotencia) — no es un error
  conflicts: number;
}

// ── POST /mirror/heartbeat ──────────────────────────────────────────────────

export interface HeartbeatInput {
  lagMs?: number;
  localQueueDepth?: number;
  recentErrors?: number;
  detail?: string;
}
