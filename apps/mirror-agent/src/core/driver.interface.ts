import type { CanonicalChangeEvent } from '@agenia/shared';

/**
 * Contrato que todo driver implementa — ver docs/PLAN_ESPEJO_HOSPITAL.md §1.4.
 * El motor genérico (engine.ts) SOLO conoce esta interfaz: nunca importa
 * nada de un driver concreto, ni sabe qué esquema de tablas hay detrás.
 */

/** Payload de configuración propio del driver — viene de HospitalMirrorConfig.driverConfig, sin interpretar por el motor. */
export type DriverConnectionConfig = Record<string, unknown>;

/** Cursor opaco de detección de cambios — cada driver decide su forma (timestamp, versión de Change Tracking, hash de snapshot...). El motor solo lo persiste y se lo devuelve tal cual. */
export type DriverCursor = unknown;

export interface CanonicalSlot {
  doctorExternalKey: string;
  startTimeIso: string;
  endTimeIso: string;
  serviceExternalKey?: string;
}

export type CatalogKind = 'CONVENIO' | 'EPS' | 'TIPO_DOCUMENTO' | 'SERVICIO';

export interface DriverResult {
  success: boolean;
  message?: string;
}

export interface DetectChangesResult {
  events: CanonicalChangeEvent[];
  nextCursor: DriverCursor;
}

export interface HisDriver {
  readonly key: string;

  // Conectividad y salud
  //
  // `mapping` es HospitalMirrorConfig.mappingJson tal como llega en el
  // handshake: la tabla de valores propia de ese hospital (convenios, sedes,
  // equivalencias de catálogo). El motor NO la interpreta — solo la pasa. Vive
  // en configuración y no en código a propósito: cuando el hospital valide su
  // tabla de convenios, debe ser un cambio de fila, no un despliegue.
  connect(config: DriverConnectionConfig, mapping?: unknown): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;

  // HIS → AgenIA (lectura de disponibilidad y cambios)
  fetchAvailability(window: { from: Date; to: Date }): Promise<CanonicalSlot[]>;
  detectChanges(since: DriverCursor): Promise<DetectChangesResult>;

  // AgenIA → HIS (escritura)
  createAppointment(evt: CanonicalChangeEvent): Promise<DriverResult>;
  cancelAppointment(evt: CanonicalChangeEvent): Promise<DriverResult>;
  /**
   * Mover una cita a otro cupo.
   *
   * Es su propio método y no "cancelar + crear" desde el motor porque CÓMO se
   * reagenda depende del HIS: el de Anserma no tiene movimiento nativo y hay
   * que borrar y volver a insertar (decisión del hospital), pero otro podría
   * tener un UPDATE en sitio. El motor solo sabe que el cupo cambió.
   *
   * El evento trae el cupo nuevo en `startTimeIso`/`doctorExternalKey` y el
   * anterior en `previousStartTimeIso`/`previousDoctorExternalKey`.
   */
  rescheduleAppointment(evt: CanonicalChangeEvent): Promise<DriverResult>;
  updateAttendance(evt: CanonicalChangeEvent): Promise<DriverResult>;

  // Homologación de catálogos propios del HIS
  resolveCatalogMapping(
    kind: CatalogKind,
    agenIAId: string,
  ): Promise<string | null>;
}
