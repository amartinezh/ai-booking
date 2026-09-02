import type {
  CanonicalChangeEvent,
  HisAppointmentSnapshot,
  HisCatalogEntry,
} from '@agenia/shared';

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
  /**
   * `true` si el HIS ya tiene una cita en ese hueco.
   *
   * Viaja en el mismo viaje que el cupo, y no en una segunda consulta, porque
   * entre "traer la rejilla" y "marcar lo ocupado" cabe una ventana en la que
   * AgenIA ofrecería una hora que el hospital acaba de vender.
   */
  occupied?: boolean;
}

export type CatalogKind = 'CONVENIO' | 'EPS' | 'TIPO_DOCUMENTO' | 'SERVICIO';

export interface DriverResult {
  success: boolean;
  message?: string;
  /**
   * `true` cuando el evento no se aplicó porque este driver NO lo soporta, y
   * no porque algo fallara. La diferencia importa: un fallo se reintenta y
   * acaba en dead-letter con alerta; esto no se reintenta nunca, porque la
   * respuesta va a ser la misma hasta que se despliegue otro driver.
   */
  unsupported?: boolean;
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

  /**
   * Instantánea de las citas VIGENTES del HIS en una ventana, ya canonicalizada
   * (código del médico del HIS + hora en UTC).
   *
   * Es su propio método y no una lectura del cursor de `detectChanges` porque
   * pasar de la hora local del HIS a UTC es conocimiento del driver, y `core/`
   * no puede tenerlo. Sirve a la reconciliación: la capa 5 del plan §6, la
   * única que detecta que los dos sistemas divergieron sin que nada fallara.
   */
  snapshotAppointments(window: {
    from: Date;
    to: Date;
  }): Promise<HisAppointmentSnapshot[]>;

  /**
   * El catálogo del HIS: qué médicos y qué servicios tiene el hospital.
   *
   * Existe porque `MirrorEntityMap` —la tabla que dice qué médico de AgenIA es
   * cuál del hospital— no tenía quien la escribiera, y sin ella no se genera un
   * solo cupo ni sale ni entra una sola cita. El servidor no puede leerlo: la
   * API no alcanza el HIS por diseño (plan §4.1), solo el agente lo ve.
   *
   * Cada driver decide QUÉ entra en su catálogo. No es "todo lo que hay": el de
   * Anserma tiene 588 médicos de los que solo ~30 agendan, y 1.280 servicios de
   * los que ~53 se usan. Subir el resto sería basura que alguien tendría que
   * descartar a mano.
   *
   * `extra` es del driver y el motor no lo interpreta: lo guarda y se lo enseña
   * a quien decide el emparejamiento.
   */
  fetchCatalog(kind: 'DOCTOR' | 'SERVICE'): Promise<HisCatalogEntry[]>;

  // Homologación de catálogos propios del HIS
  resolveCatalogMapping(
    kind: CatalogKind,
    agenIAId: string,
  ): Promise<string | null>;
}
