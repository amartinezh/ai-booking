import * as sql from 'mssql';
import type { CanonicalChangeEvent } from '@agenia/shared';
import type {
  CanonicalSlot,
  CatalogKind,
  DetectChangesResult,
  DriverConnectionConfig,
  DriverCursor,
  DriverResult,
  HisDriver,
} from '../../core/driver.interface';

/**
 * Driver del Hospital San Vicente de Paul de Anserma (HIS aparentemente de
 * CNT Sistemas de Información, sobre SQL Server 2017 estándar/Linux).
 *
 * TODA la documentación de este esquema vive en
 * docs/drivers/cnt-sanvicente-anserma/ — MAPEO_HIS.md (mapeo técnico) y
 * ESTADO.md (preguntas/respuestas y pendientes). Este archivo NUNCA debe
 * exponer nada de lo que sabe hacia `core/` — el motor genérico solo ve el
 * contrato `HisDriver`.
 *
 * Estado de implementación (Fase 1, 2026-08): la conexión y el health-check
 * ya son reales — se pueden probar contra la BD `PRUEBAS` en cuanto exista
 * la VM/credencial `agenia_sync` (ESTADO.md, pendiente #5). Los métodos de
 * lectura/escritura de citas quedan como stubs con TODOs explícitos: cada
 * uno depende de una pregunta de Fase 0 que aún no se cierra (ver el
 * comentario en cada método) — implementarlos ahora sería adivinar contra
 * un hospital real, exactamente lo que la Fase 0 existe para evitar.
 */
export class CntSanVicenteAnsermaDriver implements HisDriver {
  readonly key = 'cnt-sanvicente-anserma';

  private pool: sql.ConnectionPool | null = null;
  /** Nombre del catálogo VIVO — confirmado en Fase 0: "ESEHSVP" (los sufijos de año son archivos, no rotan). Viene de driverConfig, nunca hardcoded aquí. */
  private catalog = 'ESEHSVP';

  async connect(config: DriverConnectionConfig): Promise<void> {
    const {
      server,
      catalog,
      user,
      password,
      port = 1433,
    } = config as {
      server: string;
      catalog?: string;
      user: string;
      password: string;
      port?: number;
    };

    if (catalog) this.catalog = catalog;

    this.pool = await new sql.ConnectionPool({
      server,
      port,
      user,
      password,
      database: this.catalog,
      options: {
        // El servidor del hospital corre SQL Server 2017 sobre Linux dentro
        // de su LAN, sin certificado público — trustServerCertificate es
        // correcto aquí (no es tráfico saliente a internet, ver plan §4.1).
        trustServerCertificate: true,
        encrypt: false,
      },
    }).connect();
  }

  async disconnect(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.pool) return { ok: false, detail: 'No conectado.' };
    try {
      await this.pool.request().query('SELECT 1 AS ok');
      return { ok: true };
    } catch (error: any) {
      return { ok: false, detail: error?.message };
    }
  }

  async fetchAvailability(_window: {
    from: Date;
    to: Date;
  }): Promise<CanonicalSlot[]> {
    // 🚧 TODO (ESTADO.md pendiente #4): última milla del INSERT — fuentes
    // exactas de especialidad/consultorio/centro de costos (bloque 21) aún
    // no confirmadas. La CONSULTA de disponibilidad en sí (TURNOS_MEDICOS −
    // CITAS_MEDICAS ocupadas, ver MAPEO_HIS.md §2.5) ya está diseñada y se
    // implementa en Fase 2, una vez cerrado ese pendiente — de lo contrario
    // se estaría adivinando el mapeo de especialidad/consultorio sin
    // confirmación real del hospital.
    throw new Error(
      'fetchAvailability: pendiente de Fase 2 — ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md',
    );
  }

  async detectChanges(_since: DriverCursor): Promise<DetectChangesResult> {
    // 🚧 TODO (ESTADO.md pendiente #2): el mecanismo de detección de
    // cancelación YA está resuelto (DELETE de CITAS_MEDICAS + correlación
    // con CITAS_ANULADAS, ver MAPEO_HIS.md §2.1bis) — lo que falta es decidir
    // Change Tracking vs. polling diferencial con el hospital y armar el
    // snapshot/hash inicial. Se implementa en Fase 4.
    throw new Error(
      'detectChanges: pendiente de Fase 4 — ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md',
    );
  }

  async createAppointment(
    _evt: CanonicalChangeEvent,
  ): Promise<DriverResult> {
    // 🚧 TODO (ESTADO.md pendiente #4, bloque 21): la plantilla del INSERT
    // está mapeada casi por completo (MAPEO_HIS.md §2.1 "Plantilla del
    // INSERT confirmada") EXCEPTO tres campos: NU_NUME_CONE_CIT (consecutivo
    // de sesión), CD_CODI_ESP_CIT (especialidad) y CD_CODI_CONS/CECO/LUAT
    // (consultorio/centro de costos/sede) — hay candidatos identificados
    // (tablas CONEXION*/CONSECUTIVOS, R_ESP_SER) pero sin confirmar con una
    // consulta real. Escribir esto ahora sería una cita "a medias" que
    // podría no verse bien en la aplicación del hospital — exactamente el
    // riesgo #1 del plan (§12, tabla de riesgos). Se implementa en Fase 3.
    throw new Error(
      'createAppointment: pendiente de Fase 3 — ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md',
    );
  }

  async cancelAppointment(
    _evt: CanonicalChangeEvent,
  ): Promise<DriverResult> {
    // 🚧 TODO (ESTADO.md pendiente #3): el MECANISMO ya está confirmado por
    // la prueba manual del hospital (DELETE de CITAS_MEDICAS + INSERT en
    // CITAS_ANULADAS con CD_CODI_MOTI_CIAN + TX_OBSE_CIAN, ver MAPEO_HIS.md
    // §2.1bis) — falta decidir el código de motivo que use el agente
    // (reutilizar "WB" o pedir uno dedicado) antes de escribir en
    // producción. Se implementa en Fase 3, junto con createAppointment.
    throw new Error(
      'cancelAppointment: pendiente de Fase 3 — ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md',
    );
  }

  async updateAttendance(
    _evt: CanonicalChangeEvent,
  ): Promise<DriverResult> {
    // 🚧 TODO: NU_ESTA_CIT pasa de 0 a 1/2 mediante UPDATE en sitio
    // (confirmado, MAPEO_HIS.md §2.1bis) pero qué acción exacta de la
    // aplicación del hospital dispara cada valor no se probó — riesgo bajo
    // (no bloquea Fase 3, la asistencia es secundaria al alta/cancelación).
    throw new Error(
      'updateAttendance: pendiente de Fase 3+ — ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md',
    );
  }

  async resolveCatalogMapping(
    _kind: CatalogKind,
    _agenIAId: string,
  ): Promise<string | null> {
    // 🚧 TODO: la tabla de homologación de convenios YA está cerrada
    // (MAPEO_HIS.md §2.3 — EPS+régimen+PyP → convenio vigente, 12 códigos
    // documentados) pero falta validarla con la agendadora del hospital
    // (ESTADO.md pendiente) antes de codificarla como lookup en producción.
    throw new Error(
      'resolveCatalogMapping: pendiente de validación de negocio — ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md',
    );
  }
}
