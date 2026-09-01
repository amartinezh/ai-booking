import * as sql from 'mssql';
import type { CanonicalChangeEvent } from '@agenia/shared';
import {
  AnsermaMapping,
  feHoraCitAIso,
  MappingIncompletoError,
  formatFeHoraCit,
  fechaCitaLocal,
  mapSexo,
  resolveConvenio,
  resolveEspecialidad,
} from './mapping';
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
/** Una fila de la instantánea: lo mínimo para detectar qué cambió. */
interface SnapshotRow {
  /** NU_ESTA_CIT */
  e: number;
  /** CD_CODI_SER_CIT */
  s: string | null;
  /** NU_HIST_PAC_CIT */
  h: string | null;
  /** NU_DURA_CIT */
  d: number | null;
  /** true si la escribió este agente (marca de origen en DE_DESC_CIT). */
  propia: boolean;
}

/** Instantánea completa de la ventana, indexada por `${médico}|${hora}`. */
type SnapshotCursor = Record<string, SnapshotRow>;

export class CntSanVicenteAnsermaDriver implements HisDriver {
  readonly key = 'cnt-sanvicente-anserma';

  private pool: sql.ConnectionPool | null = null;
  private mapping: AnsermaMapping | null = null;
  /** Zona del hospital. El protocolo viaja en UTC; aquí es la frontera (plan §8). */
  private timeZone = 'America/Bogota';
  /** Nombre del catálogo VIVO — confirmado en Fase 0: "ESEHSVP" (los sufijos de año son archivos, no rotan). Viene de driverConfig, nunca hardcoded aquí. */
  private catalog = 'ESEHSVP';

  async connect(
    config: DriverConnectionConfig,
    mapping?: unknown,
  ): Promise<void> {
    // La tabla de valores (convenios, sedes, sexo) llega en el handshake desde
    // HospitalMirrorConfig.mappingJson, no vive en el código: la tabla de
    // convenios está pendiente de validación con la agendadora, y cuando la
    // valide tiene que ser un cambio de configuración, no un despliegue.
    if (mapping) this.mapping = mapping as AnsermaMapping;

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

  /**
   * Adopta una conexión ya abierta en vez de crear una.
   *
   * Existe por las pruebas: el SQL que este driver le escribe a un hospital
   * merece verificarse valor a valor, y montar un SQL Server para cada
   * aserción no es viable. También sirve si algún día conviene compartir un
   * pool entre drivers de la misma organización.
   */
  useConnection(pool: sql.ConnectionPool, mapping: unknown): void {
    this.pool = pool;
    this.mapping = mapping as AnsermaMapping;
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

  /**
   * Detección de cambios del HIS por instantánea diferencial.
   *
   * POR QUE INSTANTÁNEA Y NO UN CURSOR POR FECHA
   * Un cursor sobre `FE_ELAB_CIT` detectaría las altas nuevas, pero no las
   * cancelaciones: cancelar BORRA la fila de `CITAS_MEDICAS`, y
   * `CITAS_ANULADAS` copia `FE_ELAB_CIAN` de la cita original — no guarda
   * cuándo se canceló. Una fila que desaparece no se detecta mirando fechas:
   * hay que saber qué había antes.
   *
   * Se compara el conjunto (médico|hora → estado) de la ventana de vigilancia
   * contra la lectura anterior:
   *   apareció     → alta en el HIS
   *   desapareció  → cancelación
   *   cambió estado→ desenlace de atención
   *
   * ANTI-ECO: las citas que escribió el propio agente llevan la marca de
   * origen en `DE_DESC_CIT`, así que no se reportan como altas del hospital
   * — pero SÍ entran a la instantánea, para poder detectar si el hospital las
   * cancela después.
   *
   * La PRIMERA lectura no emite nada: sin instantánea previa no se sabe qué
   * cambió, y reportar todo como nuevo duplicaría la agenda entera. Solo toma
   * la línea base. La carga inicial es un paso aparte.
   */
  async detectChanges(since: DriverCursor): Promise<DetectChangesResult> {
    const pool = this.requirePool();
    const mapping = this.requireMapping();
    const anterior = (since as SnapshotCursor | null) ?? null;

    const desde = new Date();
    const hasta = new Date();
    hasta.setDate(hasta.getDate() + (mapping.ventanaVigilanciaDias ?? 90));

    const filas = await pool
      .request()
      .input('desde', sql.DateTime, desde)
      .input('hasta', sql.DateTime, hasta).query(`
        SELECT CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist,
               NU_DURA_CIT dura, DE_DESC_CIT descripcion
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta`);

    const actual: SnapshotCursor = {};
    for (const f of filas.recordset) {
      actual[`${f.med}|${f.hora}`] = {
        e: f.estado,
        s: f.servicio,
        h: f.hist,
        d: f.dura,
        propia: f.descripcion === mapping.marcaOrigen,
      };
    }

    if (!anterior) {
      return { events: [], nextCursor: actual };
    }

    const events: CanonicalChangeEvent[] = [];
    const ahora = new Date().toISOString();

    for (const [clave, fila] of Object.entries(actual)) {
      const previo = anterior[clave];
      if (!previo) {
        // Alta nueva. Si la escribimos nosotros, no se devuelve al servidor.
        if (fila.propia) continue;
        events.push(this.eventoDeCita('INSERT', clave, fila, ahora));
      } else if (previo.e !== fila.e) {
        events.push(this.eventoDeCita('ATTENDANCE', clave, fila, ahora));
      }
    }

    for (const [clave, previo] of Object.entries(anterior)) {
      if (actual[clave]) continue;
      // Desapareció de CITAS_MEDICAS: es una cancelación, la haya hecho el
      // hospital sobre una cita nuestra o sobre una suya.
      events.push(this.eventoDeCita('CANCEL', clave, previo, ahora));
    }

    return { events, nextCursor: actual };
  }

  /** Traduce una fila del HIS al formato canónico que entiende el motor. */
  private eventoDeCita(
    op: 'INSERT' | 'CANCEL' | 'ATTENDANCE',
    clave: string,
    fila: SnapshotRow,
    ahora: string,
  ): CanonicalChangeEvent {
    const [medico, feHora] = clave.split('|');
    return {
      // El `eventId` lo genera el AGENTE y debe ser estable para la misma
      // observación: si el mismo cambio se reportara dos veces (un reintento
      // tras un corte de red), la idempotencia del servidor lo absorbe.
      eventId: `cnt:${op}:${clave}:${fila.e}`,
      entityType: 'APPOINTMENT',
      op,
      occurredAtIso: ahora,
      payload: {
        doctorExternalKey: medico,
        serviceExternalKey: fila.s ?? undefined,
        patientDocument: fila.h ?? undefined,
        // La hora del HIS es local; el protocolo viaja en UTC (plan §8).
        startTimeIso: feHoraCitAIso(feHora, this.timeZone),
        attendanceStatus: op === 'ATTENDANCE' ? String(fila.e) : undefined,
      },
    };
  }

  async createAppointment(evt: CanonicalChangeEvent): Promise<DriverResult> {
    const p = evt.payload;

    // El motor genérico ya rechaza los eventos sin homologar antes de llegar
    // aquí (ver engine.applyOutboxEvent). Esto es la segunda línea: el driver
    // NO escribe una cita a medias ni aunque se lo pidan.
    const faltan = [
      !p.doctorExternalKey && 'médico',
      !p.serviceExternalKey && 'servicio',
      !p.patientDocument && 'documento del paciente',
      !p.startTimeIso && 'hora de la cita',
    ].filter(Boolean);
    if (faltan.length > 0) {
      return {
        success: false,
        message: `faltan datos para escribir la cita: ${faltan.join(', ')}`,
      };
    }

    const mapping = this.requireMapping();
    const pool = this.requirePool();

    try {
      const feHora = formatFeHoraCit(p.startTimeIso!, this.timeZone);
      const feFecha = fechaCitaLocal(p.startTimeIso!, this.timeZone);
      const convenio = resolveConvenio(mapping, {
        epsNit: p.epsNit,
        patientRegime: p.patientRegime,
        serviceExternalKey: p.serviceExternalKey,
      });

      await this.ensurePaciente(p);

      // El consultorio sale del turno del médico ese día, y con él la duración.
      // Es la regla documentada en MAPEO_HIS.md §2.5bis; si el turno no existe,
      // la cita no debería crearse: el médico no atiende ese día.
      const turno = await this.turnoDelDia(p.doctorExternalKey!, feFecha);
      if (!turno) {
        return {
          success: false,
          message:
            `El médico ${p.doctorExternalKey} no tiene turno el ${feFecha}: ` +
            `la agenda de AgenIA y la del HIS no coinciden.`,
        };
      }

      const duracion = p.startTimeIso && p.endTimeIso
        ? Math.round(
            (new Date(p.endTimeIso).getTime() -
              new Date(p.startTimeIso).getTime()) /
              60000,
          )
        : mapping.duracionMinutos;

      await pool
        .request()
        .input('med', sql.VarChar(4), p.doctorExternalKey)
        .input('hora', sql.VarChar(18), feHora)
        .input('ser', sql.VarChar(12), p.serviceExternalKey)
        .input('hist', sql.VarChar(20), p.patientDocument)
        .input('dura', sql.Int, duracion)
        .input('fecha', sql.DateTime, new Date(`${feFecha}T00:00:00`))
        .input('esp', sql.VarChar(3), resolveEspecialidad(mapping, p.serviceExternalKey))
        .input('cons', sql.VarChar(8), turno.consultorio)
        .input('conv', sql.Int, convenio)
        .input('desc', sql.VarChar(600), mapping.marcaOrigen)
        .input('ceco', sql.VarChar(11), mapping.centroCostos ?? null)
        .input('luat', sql.VarChar(2), mapping.lugarAtencion).query(`
          INSERT INTO dbo.CITAS_MEDICAS (
            CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
            NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
            NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
            NU_TIPO_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT,
            DE_DESC_CIT, CD_CODI_CECO_CIT, CD_CODI_LUAT_CIT, FE_SOLI_CIT
          ) VALUES (
            @med, @hora, 0, @ser,
            @hist, @dura, GETDATE(), @fecha,
            0, 0, 0, 0,
            0, @esp, @cons, @conv,
            @desc, @ceco, @luat, GETDATE()
          )`);

      return { success: true };
    } catch (error: any) {
      // Violación de la PK (médico + hora + estado): ese cupo YA está vendido
      // en el HIS. No es un fallo del agente, es el detector natural de
      // colisión que la Fase 0 identificó — y la política de este hospital es
      // que el HIS gana. Se reporta como fallo para que quede auditado, pero
      // con un mensaje que dice qué pasó de verdad.
      if (error?.number === 2627 || error?.number === 2601) {
        return {
          success: false,
          message:
            `El cupo del médico ${p.doctorExternalKey} a las ` +
            `${formatFeHoraCit(p.startTimeIso!, this.timeZone)} ya está ocupado en el HIS.`,
        };
      }
      if (error instanceof MappingIncompletoError) {
        return { success: false, message: error.message };
      }
      throw error;
    }
  }

  /**
   * Crea el paciente en `PACIENTES` si no existe.
   *
   * El HIS tiene una FK: solo pacientes existentes pueden tener cita. La
   * historia ES el documento (confirmado en el 100% de los 78.654 pacientes),
   * y `FE_NACI_PAC`/`NU_SEXO_PAC` son NOT NULL — de ahí que el chatbot ahora
   * los pregunte.
   */
  private async ensurePaciente(
    p: CanonicalChangeEvent['payload'],
  ): Promise<void> {
    const pool = this.requirePool();
    const mapping = this.requireMapping();

    const existe = await pool
      .request()
      .input('hist', sql.VarChar(20), p.patientDocument)
      .query('SELECT 1 AS x FROM dbo.PACIENTES WHERE NU_HIST_PAC = @hist');
    if (existe.recordset.length > 0) return;

    if (!p.patientBirthDateIso || !p.patientGender) {
      throw new MappingIncompletoError(
        `El paciente ${p.patientDocument} no existe en el HIS y faltan datos ` +
          `para darlo de alta (nacimiento y/o sexo). PACIENTES los exige NOT NULL.`,
      );
    }

    await pool
      .request()
      .input('hist', sql.VarChar(20), p.patientDocument)
      .input('docu', sql.VarChar(20), p.patientDocument)
      .input('nomb', sql.VarChar(60), (p.patientFullName ?? '').slice(0, 60))
      .input('naci', sql.DateTime, new Date(p.patientBirthDateIso))
      .input('sexo', sql.TinyInt, mapSexo(mapping, p.patientGender)).query(`
        INSERT INTO dbo.PACIENTES (
          NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC, NO_NOMB_PAC,
          FE_NACI_PAC, NU_SEXO_PAC, FE_HIST_PAC, NU_EXTR_PAC
        ) VALUES (@hist, @docu, 0, @nomb, @naci, @sexo, GETDATE(), 0)`);
  }

  /** Turno del médico ese día: de ahí salen el consultorio y la disponibilidad. */
  private async turnoDelDia(
    medico: string,
    fechaIso: string,
  ): Promise<{ consultorio: string | null } | null> {
    const r = await this.requirePool()
      .request()
      .input('med', sql.VarChar(4), medico)
      .input('fecha', sql.DateTime, new Date(`${fechaIso}T00:00:00`)).query(`
        SELECT TOP 1 CD_CODI_CONS_TUME AS consultorio
          FROM dbo.TURNOS_MEDICOS
         WHERE CD_MED_TUME = @med
           AND CAST(FE_FECH_TUME AS date) = CAST(@fecha AS date)
           AND ID_DISP_TUME = '1'`);
    return r.recordset[0] ?? null;
  }

  private requirePool(): sql.ConnectionPool {
    if (!this.pool) throw new Error('El driver no está conectado al HIS.');
    return this.pool;
  }

  private requireMapping(): AnsermaMapping {
    if (!this.mapping) {
      throw new Error(
        'Falta mappingJson en HospitalMirrorConfig: sin la tabla de convenios, ' +
          'sedes y equivalencias no se puede escribir en el HIS.',
      );
    }
    return this.mapping;
  }

  /**
   * Cancelar = DELETE de `CITAS_MEDICAS` + INSERT de auditoría en
   * `CITAS_ANULADAS`.
   *
   * No es un cambio de estado en sitio: lo confirmó el propio hospital
   * ejecutando una cancelación real desde su aplicación (evidencia del
   * 2026-08-23). Las dos escrituras van en UNA transacción — dejar la cita
   * borrada sin su registro de auditoría le rompería los reportes al hospital.
   *
   * `CITAS_ANULADAS` no tiene PK ni índices: es un log de auditoría puro, así
   * que se inserta sin más.
   */
  async cancelAppointment(evt: CanonicalChangeEvent): Promise<DriverResult> {
    const p = evt.payload;
    if (!p.doctorExternalKey || !p.startTimeIso) {
      return {
        success: false,
        message: 'faltan médico u hora para identificar la cita a cancelar',
      };
    }

    const mapping = this.requireMapping();
    const pool = this.requirePool();
    const feHora = formatFeHoraCit(p.startTimeIso, this.timeZone);

    const tx = pool.transaction();
    await tx.begin();
    try {
      const borrada = await this.copiarAAnuladas(tx, {
        medico: p.doctorExternalKey,
        feHora,
        motivo: mapping.motivoAnulacion,
        observacion: p.cancelObservations ?? 'Cancelada por el paciente vía WhatsApp',
      });

      if (!borrada) {
        // No estaba: o el hospital ya la canceló por su lado, o nunca llegó a
        // escribirse. En ambos casos el resultado deseado ya se cumple, así
        // que se reporta como éxito — reintentar no cambiaría nada.
        await tx.rollback();
        return { success: true, message: 'La cita ya no existía en el HIS.' };
      }

      await tx.commit();
      return { success: true };
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Reagendar = cancelar la vieja y crear la nueva, en una transacción.
   *
   * Es la decisión explícita del hospital: su HIS no tiene movimiento nativo
   * de citas. La observación de la anulación dice que fue un reagendamiento
   * para que su tasa de cancelación —hoy del 8-9%— no se infle sola.
   */
  async rescheduleAppointment(evt: CanonicalChangeEvent): Promise<DriverResult> {
    const p = evt.payload;
    if (!p.previousStartTimeIso || !p.previousDoctorExternalKey) {
      return {
        success: false,
        message: 'no se conoce el cupo anterior: no se puede reagendar sin él',
      };
    }

    const mapping = this.requireMapping();
    const pool = this.requirePool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      await this.copiarAAnuladas(tx, {
        medico: p.previousDoctorExternalKey,
        feHora: formatFeHoraCit(p.previousStartTimeIso, this.timeZone),
        motivo: mapping.motivoAnulacion,
        observacion: 'Reagendada por el paciente vía WhatsApp',
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }

    // El alta de la cita nueva reusa createAppointment tal cual: mismas
    // reglas de convenio, consultorio y validación. Duplicarlas aquí sería
    // garantizar que las dos versiones se separen con el tiempo.
    return this.createAppointment(evt);
  }

  /**
   * Mueve una cita de `CITAS_MEDICAS` a `CITAS_ANULADAS` dentro de una
   * transacción. Devuelve false si no había nada que mover.
   */
  private async copiarAAnuladas(
    tx: sql.Transaction,
    datos: {
      medico: string;
      feHora: string;
      motivo: string;
      observacion: string;
    },
  ): Promise<boolean> {
    // Copia campo a campo: `CITAS_ANULADAS` repite las columnas de
    // `CITAS_MEDICAS` con sufijo _CIAN, más motivo y observaciones.
    const copia = await tx.request()
      .input('med', sql.VarChar(4), datos.medico)
      .input('hora', sql.VarChar(18), datos.feHora)
      .input('moti', sql.VarChar(2), datos.motivo)
      .input('obse', sql.VarChar(255), datos.observacion).query(`
        INSERT INTO dbo.CITAS_ANULADAS (
          CD_CODI_MED_CIAN, FE_HORA_CIAN, NU_ESTA_CIAN, CD_CODI_SER_CIAN,
          NU_HIST_PAC_CIAN, NU_DURA_CIAN, FE_ELAB_CIAN, FE_FECH_CIAN,
          NU_DIA_CIAN, NU_NUME_MOVI_CIAN, NU_PRIM_CIAN, NU_NUME_CONE_CIAN,
          NU_CONE_CALL_CIAN, CD_CODI_ESP_CIAN, CD_CODI_CONS_CIAN,
          NU_NUME_CONV_CIAN, NU_TIPO_CIAN, DE_DESC_CIAN, CD_CODI_CECO_CIAN,
          CD_CODI_LUAT_CIAN, FE_SOLI_CIAN, CD_CODI_MOTI_CIAN, TX_OBSE_CIAN
        )
        SELECT
          CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
          NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
          NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_NUME_CONE_CIT,
          NU_CONE_CALL_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT,
          NU_NUME_CONV_CIT, NU_TIPO_CIT, DE_DESC_CIT, CD_CODI_CECO_CIT,
          CD_CODI_LUAT_CIT, FE_SOLI_CIT, @moti, @obse
        FROM dbo.CITAS_MEDICAS
        WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora`);

    if ((copia.rowsAffected[0] ?? 0) === 0) return false;

    await tx
      .request()
      .input('med', sql.VarChar(4), datos.medico)
      .input('hora', sql.VarChar(18), datos.feHora)
      .query(
        'DELETE FROM dbo.CITAS_MEDICAS WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora',
      );

    return true;
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
