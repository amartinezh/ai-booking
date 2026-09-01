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

/**
 * Contexto que el SERVIDOR resuelve antes de entregar un evento de cita.
 *
 * POR QUE HACE FALTA
 * El trigger serializa la fila de `Appointment` tal cual, y esa fila no tiene
 * ni la hora, ni el médico, ni el servicio: eso vive en `ScheduleSlot`. El
 * evento llegaba al driver con cuatro UUIDs de AgenIA y nada más — imposible
 * construir con eso el INSERT que el HIS exige.
 *
 * Se resuelve al ENTREGAR y no en el trigger a propósito: el trigger corre
 * dentro de la transacción de escritura del paciente y tiene que seguir siendo
 * tonto y rápido. Aquí, en cambio, hay tiempo para hacer los joins y consultar
 * la homologación.
 *
 * ⚠️ Consecuencia de resolverlo tarde: refleja el estado ACTUAL, no el del
 * momento de la captura. Para un alta es lo correcto. Para una cancelación,
 * si el cupo cambiara de hora entre la captura y la entrega, el driver vería
 * la hora nueva — hoy AgenIA no mueve la hora de un cupo existente, pero el
 * día que lo haga, esto hay que capturarlo en el trigger.
 */
export interface OutboxEventContext {
  /** Inicio y fin del cupo, UTC ISO-8601. El driver convierte a la zona del hospital. */
  startTimeIso?: string;
  endTimeIso?: string;

  /** Documento del paciente. No necesita homologación: es la clave que el HIS usa. */
  patientDocument?: string;
  patientFullName?: string;
  /** ISO-8601. El HIS los exige NOT NULL al dar de alta un paciente nuevo. */
  patientBirthDateIso?: string;
  patientGender?: string;
  /** 'SUBSIDIADO' | 'CONTRIBUTIVO'. Junto al NIT decide el convenio. */
  patientRegime?: string;

  /** NIT de la EPS. Tampoco se homologa: el driver deriva el convenio de aquí. */
  epsNit?: string;
  epsName?: string;

  /** Claves del HIS resueltas vía MirrorEntityMap. */
  doctorExternalKey?: string;
  serviceExternalKey?: string;

  /**
   * Homologaciones que faltaron. **Si trae algo, el evento NO es aplicable**:
   * el motor lo rechaza sin llamar al driver. Escribir una cita a medias en el
   * HIS es el riesgo #1 de la tabla de riesgos del plan — mejor un fallo
   * explícito que una cita sin médico en la agenda del hospital.
   */
  missingMappings?: string[];
}

export interface OutboxEventDto {
  /** BigInt serializado como string — JSON no representa int64 con precisión. */
  seq: string;
  eventId: string;
  entityType: CanonicalEntityType;
  entityId: string;
  op: CanonicalOp;
  /** La fila cruda tal como la serializó el trigger (NEW en alta, OLD en baja). */
  payload: unknown;
  /**
   * Datos que la fila cruda no tiene y el driver necesita. Presente solo en
   * eventos de APPOINTMENT; el resto de entidades aún no se espeja (Fase 2+).
   */
  context?: OutboxEventContext;
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
    // Alta mínima de paciente: varios HIS exigen que el paciente exista antes
    // de aceptar la cita, y con campos NOT NULL (el de Anserma pide nacimiento
    // y sexo). Si el driver tiene que crearlo, los necesita aquí.
    patientFullName?: string;
    patientBirthDateIso?: string;
    patientGender?: string;
    /** Régimen: la misma EPS tiene convenios distintos según cuál sea. */
    patientRegime?: string;
    /** NIT de la EPS: de aquí sale el convenio de facturación. */
    epsNit?: string;
    epsName?: string;
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
