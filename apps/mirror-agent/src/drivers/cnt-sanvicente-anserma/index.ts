import * as sql from 'mssql';
import type { CanonicalChangeEvent, HisAppointmentSnapshot } from '@agenia/shared';
import {
  AnsermaMapping,
  feHoraCitAIso,
  MappingIncompletoError,
  formatFeHoraCit,
  fechaCitaLocal,
  fechaLiteralSql,
  diaSiguienteLiteralSql,
  desenlaceDeAtencion,
  mapSexo,
  resolveConvenio,
  resolveEspecialidad,
  cuposDelTurno,
  duracionDeServicio,
  partirNombre,
  partirNombreDado,
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
  /**
   * `FE_FECH_CIT` como fecha LOCAL (`YYYY-MM-DD`).
   *
   * Se guarda en la foto, y no se deduce de la clave, porque es lo que decide
   * si una fila que ya no está desapareció o solo se salió de la ventana. Se
   * lee de la columna y no de `FE_HORA_CIT` para que una hora legada sucia no
   * arrastre a la ventana con ella.
   */
  f: string;
}

/** Rango de fechas LOCALES que cubre una foto, inclusive en los dos extremos. */
interface VentanaLocal {
  desde: string;
  hasta: string;
}

/**
 * Instantánea completa de la ventana.
 *
 * Lleva la ventana consigo a propósito: sin ella, la foto siguiente no puede
 * distinguir "esta cita se canceló" de "esta cita quedó fuera del rango que
 * miré esta vez", y las dos se ven igual — una clave que ya no está.
 */
interface SnapshotCursor {
  ventana: VentanaLocal;
  /** Filas indexadas por `${médico}|${hora}`. */
  filas: Record<string, SnapshotRow>;
}

/**
 * La foto anterior, ya normalizada.
 *
 * `ventana: null` es un cursor escrito por una versión anterior del agente:
 * trae las filas pero no dice qué fechas cubrían.
 */
interface FotoPrevia {
  filas: Record<string, SnapshotRow>;
  ventana: VentanaLocal | null;
}

/**
 * Quien ejecuta una consulta: el pool o una transacción abierta.
 *
 * Existe para que el alta de una cita se pueda escribir DENTRO de la misma
 * transacción que la anulación, que es lo que hace falta para reagendar sin
 * dejar al paciente sin nada si el segundo paso falla. `mssql` expone el
 * mismo `.request()` en los dos, así que el resto del código no se entera.
 */
type Ejecutor = { request(): sql.Request };

function leerCursor(since: DriverCursor): FotoPrevia | null {
  if (!since || typeof since !== 'object') return null;
  const c = since as Partial<SnapshotCursor>;
  if (c.ventana?.desde && c.ventana?.hasta && c.filas) {
    return { filas: c.filas, ventana: c.ventana };
  }
  // Forma anterior: un mapa plano de clave → fila, sin ventana.
  return { filas: since as Record<string, SnapshotRow>, ventana: null };
}

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

  /**
   * La agenda del hospital, convertida en cupos de AgenIA (Fase 2).
   *
   * ═══ El modelo ═══
   * `CITAS_MEDICAS` NO tiene filas de cupo libre: solo existe la fila cuando
   * hay cita. La disponibilidad vive en `TURNOS_MEDICOS` como BLOQUES por
   * médico/fecha/consultorio (07:00–12:00, 14:00–18:00…), y la aplicación del
   * hospital calcula los huecos dividiendo el bloque entre la duración y
   * descontando las citas ya tomadas. Esto replica esa cuenta.
   *
   * ═══ Por qué importa ═══
   * Hasta ahora los cupos de AgenIA se creaban a mano y no tenían por qué
   * parecerse a la agenda real: se podía vender por WhatsApp una hora en la
   * que el médico no atiende. Esta es la pata que hace que la agenda de AgenIA
   * SEA la del hospital.
   *
   * Se devuelve la rejilla COMPLETA, marcando cuáles están ocupados, y no solo
   * los libres: entre traer la rejilla y marcar lo ocupado en un segundo viaje
   * cabe una ventana en la que se ofrecería una hora recién vendida.
   */
  async fetchAvailability(window: {
    from: Date;
    to: Date;
  }): Promise<CanonicalSlot[]> {
    const pool = this.requirePool();
    const mapping = this.requireMapping();

    // ⚠️ La ventana viaja en UTC; `FE_FECH_TUME` es una fecha LOCAL sin zona.
    //
    // Filtrar la una con la otra desplaza un día entero: un día de Bogotá va de
    // las 05:00Z a las 05:00Z siguientes, así que el turno del día D (00:00
    // local, que el motor guarda tal cual) caía dentro de la ventana del día
    // D-1. Los cupos generados quedaban FUERA de la ventana que el servidor
    // estaba podando, y ese descuadre hacía que cada vuelta creara y borrara
    // los mismos cupos. Lo destapó la primera pasada en modo sombra.
    //
    // Se consulta por FECHAS LOCALES —el lenguaje de esa columna— y después se
    // recortan los cupos a la ventana real.
    const fechaDesde = fechaCitaLocal(window.from.toISOString(), this.timeZone);
    const fechaHasta = fechaCitaLocal(window.to.toISOString(), this.timeZone);
    // Bordes como literal 'YYYYMMDD' y el superior EXCLUSIVO: así la columna
    // queda SIN envolver y el índice del hospital se puede usar. Ver
    // diaSiguienteLiteralSql().
    const desdeSql = fechaLiteralSql(fechaDesde);
    const hastaSql = diaSiguienteLiteralSql(fechaHasta);

    // Solo turnos vigentes: `NU_TIPO_TUME = 0` (el tipo 1 no existe a futuro,
    // verificado en el bloque 20e) e `ID_DISP_TUME = '1'` (disponible).
    const turnos = await pool
      .request()
      .input('desde', sql.VarChar(8), desdeSql)
      .input('hasta', sql.VarChar(8), hastaSql).query(`
        SELECT CD_MED_TUME med,
               CONVERT(varchar(10), FE_FECH_TUME, 23) fecha,
               CONVERT(varchar(5), FE_HOIN_TUME, 108) hora_ini,
               CONVERT(varchar(5), FE_HOFI_TUME, 108) hora_fin
          FROM dbo.TURNOS_MEDICOS
         WHERE FE_FECH_TUME >= @desde AND FE_FECH_TUME < @hasta
           AND ISNULL(NU_TIPO_TUME, 0) = 0
           AND ISNULL(ID_DISP_TUME, '1') = '1'`);

    // Las horas ya vendidas. Mismo criterio de fecha local, y la clave es la
    // que usa la PK de la cita: médico + FE_HORA_CIT.
    const ocupadas = await pool
      .request()
      .input('desde', sql.VarChar(8), desdeSql)
      .input('hasta', sql.VarChar(8), hastaSql).query(`
        SELECT CD_CODI_MED_CIT med, FE_HORA_CIT hora
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta`);

    const vendidas = new Set(
      ocupadas.recordset.map(
        (f: { med: string; hora: string }) => `${f.med}|${f.hora.trim()}`,
      ),
    );

    const cupos: CanonicalSlot[] = [];
    for (const t of turnos.recordset as {
      med: string;
      fecha: string;
      hora_ini: string;
      hora_fin: string;
    }[]) {
      const duracion = duracionDeServicio(mapping, undefined, t.med);
      for (const cupo of cuposDelTurno(
        { fechaLocal: t.fecha, horaInicio: t.hora_ini, horaFin: t.hora_fin },
        duracion,
        this.timeZone,
      )) {
        // Recorte a la ventana pedida. El servidor borra, dentro de la
        // ventana que declara, todo cupo que no venga en el envío: devolver
        // uno de fuera lo haría crear algo que la siguiente vuelta borraría.
        const inicio = new Date(cupo.startTimeIso);
        if (inicio < window.from || inicio >= window.to) continue;

        cupos.push({
          doctorExternalKey: t.med,
          startTimeIso: cupo.startTimeIso,
          endTimeIso: cupo.endTimeIso,
          occupied: vendidas.has(`${t.med}|${cupo.feHoraCit}`),
        });
      }
    }
    return cupos;
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
   *
   * ⚠️ SOLO SE COMPARA LO QUE LAS DOS FOTOS MIRARON
   * Una ventana que se mueve hace aparecer y desaparecer filas sin que nadie
   * haya tocado nada. Tratar esa desaparición como una cancelación cancelaba,
   * en AgenIA, citas que el hospital tenía perfectamente vivas:
   *
   *   · La ventana se filtraba con `FE_FECH_CIT >= new Date()`, y `mssql`
   *     serializa un `Date` en UTC. A las 20:13 de Bogotá el borde llegaba al
   *     servidor como `2026-09-02 01:13` — el día siguiente. Así que cada
   *     noche, a las 19:00 en punto, TODAS las citas del día siguiente salían
   *     de la foto y se reportaban como canceladas: ~235 pacientes por noche
   *     perdían su cita y su cupo volvía a venderse por WhatsApp, con el HIS
   *     rechazando después la segunda cita por violación de PK.
   *   · Y como el borde inferior era "ahora", el día en curso quedaba SIEMPRE
   *     fuera: una cita que el hospital cancelaba hoy para hoy no se detectaba
   *     nunca.
   *
   * Se arregla en dos partes, y hacen falta las dos:
   *   1. La ventana se consulta en FECHAS LOCALES (`CONVERT(...,23)`), que es
   *      el idioma de esa columna — el mismo remedio que ya usa
   *      `fetchAvailability`, donde el mismo desfase se descubrió antes.
   *   2. La foto guarda qué fechas cubrió, y el diff solo mira la
   *      INTERSECCIÓN de las dos ventanas. Lo que entra o sale por el borde no
   *      es un cambio: es la ventana moviéndose.
   */
  async detectChanges(since: DriverCursor): Promise<DetectChangesResult> {
    const pool = this.requirePool();
    const mapping = this.requireMapping();
    const anterior = leerCursor(since);

    // Fechas LOCALES del hospital, inclusive en los dos extremos. `desde` es
    // HOY: el día en curso es justo el que más duele perder de vista.
    const dias = mapping.ventanaVigilanciaDias ?? 90;
    const ahoraMs = Date.now();
    const ventana: VentanaLocal = {
      desde: fechaCitaLocal(new Date(ahoraMs).toISOString(), this.timeZone),
      hasta: fechaCitaLocal(
        new Date(ahoraMs + dias * 86_400_000).toISOString(),
        this.timeZone,
      ),
    };

    // 🔎 Esta es LA consulta caliente: la repite el bucle de entrada, y
    // `CITAS_MEDICAS` tiene 1.084.093 filas / 855 MB (bloque 29b). El hospital
    // tiene un índice con `FE_FECH_CIT` de primera columna (bloque 29a), así
    // que la columna va SIN envolver — con `CONVERT` encima, ese índice no se
    // podía usar y cada vuelta era un recorrido de la tabla entera.
    const filas = await pool
      .request()
      .input('desde', sql.VarChar(8), fechaLiteralSql(ventana.desde))
      .input('hasta', sql.VarChar(8), diaSiguienteLiteralSql(ventana.hasta))
      .query(`
        SELECT CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist,
               NU_DURA_CIT dura, DE_DESC_CIT descripcion,
               CONVERT(varchar(10), FE_FECH_CIT, 23) fecha
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta`);

    // ⚠️ Puede haber más de una fila por médico+hora — no es un caso que
    // "no debería pasar".
    //
    // La PK es (médico, hora, ESTADO): el desenlace de atención LIBERA la
    // tupla (médico, hora, 0) con un UPDATE en sitio (MAPEO_HIS.md §1), y
    // nada en el esquema impide que esa hora se vuelva a agendar después. El
    // resultado son dos filas reales, vigentes las dos, para el mismo
    // médico+hora: una atendida (estado 1/2) y una nueva (estado 0).
    //
    // Agrupar por clave y quedarse con "la última que trajo la consulta" —lo
    // que hacía este bucle antes— decide en silencio y sin ningún criterio
    // cuál de las dos cuenta, según el orden en que SQL Server devuelva las
    // filas. Aquí se decide a propósito: la fila VIVA (estado 0) manda, por
    // ser la única sobre la que el motor puede actuar (cancelar, reagendar);
    // la atendida ya es historia y no puede volver a cambiar.
    const porClave = new Map<string, (typeof filas.recordset)[number][]>();
    for (const f of filas.recordset) {
      const clave = `${f.med}|${f.hora}`;
      const lista = porClave.get(clave);
      if (lista) lista.push(f);
      else porClave.set(clave, [f]);
    }

    const actual: SnapshotCursor = { ventana, filas: {} };
    for (const [clave, filasDeLaClave] of porClave) {
      let elegida = filasDeLaClave[0];
      if (filasDeLaClave.length > 1) {
        elegida =
          filasDeLaClave.find((f) => f.estado === 0) ?? filasDeLaClave[0];
        console.warn(
          `[driver cnt-sanvicente-anserma] ${clave}: ${filasDeLaClave.length} filas ` +
            `vigentes en CITAS_MEDICAS para el mismo médico+hora (estados ` +
            `${filasDeLaClave.map((f) => f.estado).join(', ')}) — se sigue la ` +
            `de estado ${elegida.estado}.`,
        );
      }
      actual.filas[clave] = {
        e: elegida.estado,
        s: elegida.servicio,
        h: elegida.hist,
        d: elegida.dura,
        f: elegida.fecha,
        propia: elegida.descripcion === mapping.marcaOrigen,
      };
    }

    if (!anterior) {
      return { events: [], nextCursor: actual };
    }

    // Franja que las DOS fotos cubrieron. Fuera de ella no se puede afirmar
    // nada: la foto anterior no miró ahí, o esta no mira ya.
    const comun: VentanaLocal = anterior.ventana
      ? {
          desde:
            anterior.ventana.desde > ventana.desde
              ? anterior.ventana.desde
              : ventana.desde,
          hasta:
            anterior.ventana.hasta < ventana.hasta
              ? anterior.ventana.hasta
              : ventana.hasta,
        }
      : ventana;
    const dentro = (fila: SnapshotRow) =>
      !!fila.f && fila.f >= comun.desde && fila.f <= comun.hasta;

    const events: CanonicalChangeEvent[] = [];
    const ahora = new Date().toISOString();

    for (const [clave, fila] of Object.entries(actual.filas)) {
      const previo = anterior.filas[clave];
      if (!previo) {
        // Entró por el borde lejano: la cita ya existía, solo que antes no se
        // miraba tan lejos. Reportarla como alta del hospital sería inventar
        // un evento; que su cupo quede ocupado lo resuelve `fetchAvailability`,
        // que sí barre esas fechas y viaja con el `occupied`.
        if (!dentro(fila)) continue;
        // Alta nueva. Si la escribimos nosotros, no se devuelve al servidor.
        if (fila.propia) continue;
        events.push(this.eventoDeCita('INSERT', clave, fila, ahora));
      } else if (previo.e !== fila.e && dentro(fila)) {
        // Solo se reporta el desenlace que sabemos traducir al vocabulario de
        // AgenIA. El estado 2 existe y nadie ha confirmado qué significa
        // (MAPEO_HIS.md §2.1): inventarle una asistencia a un paciente es
        // peor que no escribirla. Se avisa para que no sea un silencio.
        if (desenlaceDeAtencion(fila.e)) {
          events.push(this.eventoDeCita('ATTENDANCE', clave, fila, ahora));
        } else {
          console.warn(
            `[driver cnt-sanvicente-anserma] ${clave}: NU_ESTA_CIT pasó de ` +
              `${previo.e} a ${fila.e}, un desenlace sin significado confirmado. ` +
              `No se reporta.`,
          );
        }
      }
    }

    for (const [clave, previo] of Object.entries(anterior.filas)) {
      if (actual.filas[clave]) continue;
      // 🛡️ Una cita solo se da por cancelada si esta foto MIRÓ su fecha y aun
      // así no estaba. Si la fecha cayó fuera, lo único que se sabe es que no
      // se miró — y cancelar por eso es cancelarle la cita a un paciente que
      // la tiene.
      //
      // Con un cursor de una versión anterior no se sabe qué ventana cubría,
      // así que en esa única vuelta no se cancela nada: se prefiere una cita
      // fantasma (que la reconciliación diaria reporta) a una cancelación
      // inventada. Las altas sí se siguen reportando — ocupan cupos, nunca
      // los liberan.
      if (!anterior.ventana || !dentro(previo)) continue;
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
        // 🌐 El protocolo viaja en el vocabulario de AgenIA, no en el del
        // hospital — igual que las horas viajan en UTC. Antes se mandaba
        // `String(fila.e)`, el código crudo del HIS, contra un enum de Prisma
        // que solo entiende PENDING/ATTENDED/NO_SHOW.
        attendanceStatus:
          op === 'ATTENDANCE' ? (desenlaceDeAtencion(fila.e) ?? undefined) : undefined,
      },
    };
  }

  /**
   * Instantánea de las citas vigentes, para la reconciliación.
   *
   * Se lee `CITAS_MEDICAS` entera dentro de la ventana — sin filtrar por la
   * marca de origen. Es deliberado: reconciliar es justamente comparar TODO lo
   * que el hospital tiene contra todo lo que AgenIA cree tener, incluidas las
   * citas que el hospital agendó por ventanilla. Si se filtraran, la
   * comparación solo confirmaría lo que ya sabemos.
   *
   * ⚠️ MISMO DESFASE QUE TENÍA `detectChanges` (ver ESTADO.md, corregido
   * 2026-09-01): `FE_FECH_CIT` es una fecha LOCAL sin zona, y `mssql`
   * serializa un `Date` de JS en UTC. Filtrar la una con la otra desplaza el
   * borde de la ventana hasta un día entero según la hora en que corra la
   * reconciliación.
   *
   * Aquí no cancela nada —esto es de solo lectura—, pero sí falsea el
   * reporte que decide qué se repara: una cita real cerca del borde puede
   * faltar en la foto (la reconciliación la reporta como "el hospital no la
   * tiene" sin ser cierto) o la foto puede traer una de fuera de lo pedido
   * (comparándose contra cupos que la consulta de AgenIA nunca miró). Se
   * consulta por FECHAS LOCALES —el lenguaje de esa columna, igual que en
   * `fetchAvailability`— y se recorta el resultado a la ventana UTC real
   * que pidió el llamador: la consulta por día completo trae un
   * superconjunto, y el contrato de este método es la ventana exacta.
   */
  async snapshotAppointments(window: {
    from: Date;
    to: Date;
  }): Promise<HisAppointmentSnapshot[]> {
    const pool = this.requirePool();
    const fechaDesde = fechaCitaLocal(window.from.toISOString(), this.timeZone);
    const fechaHasta = fechaCitaLocal(window.to.toISOString(), this.timeZone);
    // Bordes como literal 'YYYYMMDD' y el superior EXCLUSIVO: así la columna
    // queda SIN envolver y el índice del hospital se puede usar. Ver
    // diaSiguienteLiteralSql().
    const desdeSql = fechaLiteralSql(fechaDesde);
    const hastaSql = diaSiguienteLiteralSql(fechaHasta);

    const filas = await pool
      .request()
      .input('desde', sql.VarChar(8), desdeSql)
      .input('hasta', sql.VarChar(8), hastaSql).query(`
        SELECT CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_HIST_PAC_CIT hist
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta`);

    const foto: HisAppointmentSnapshot[] = [];
    for (const f of filas.recordset as {
      med: string;
      hora: string;
      hist: string | null;
    }[]) {
      // El HIS guarda hora local; el protocolo viaja en UTC (plan §8).
      const startTimeIso = feHoraCitAIso(f.hora, this.timeZone);
      const inicio = new Date(startTimeIso);
      if (inicio < window.from || inicio >= window.to) continue;
      foto.push({
        doctorExternalKey: f.med,
        startTimeIso,
        patientDocument: f.hist ?? undefined,
      });
    }
    return foto;
  }

  async createAppointment(evt: CanonicalChangeEvent): Promise<DriverResult> {
    return this.crearCita(this.requirePool(), evt);
  }

  /**
   * El alta de verdad, sobre el ejecutor que se le pase.
   *
   * Separada de `createAppointment` para que `rescheduleAppointment` pueda
   * escribirla dentro de SU transacción, junto con la anulación de la cita
   * anterior. Un alta suelta usa el pool y se comporta igual que siempre.
   */
  private async crearCita(
    ej: Ejecutor,
    evt: CanonicalChangeEvent,
  ): Promise<DriverResult> {
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

    try {
      const feHora = formatFeHoraCit(p.startTimeIso!, this.timeZone);
      const feFecha = fechaCitaLocal(p.startTimeIso!, this.timeZone);
      const convenio = resolveConvenio(mapping, {
        epsNit: p.epsNit,
        patientRegime: p.patientRegime,
        serviceExternalKey: p.serviceExternalKey,
      });

      await this.ensurePaciente(ej, p);

      // El consultorio sale del turno del médico ese día, y con él la duración.
      // Es la regla documentada en MAPEO_HIS.md §2.5bis; si el turno no existe,
      // la cita no debería crearse: el médico no atiende ese día.
      const turno = await this.turnoDelDia(ej, p.doctorExternalKey!, feFecha);
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

      await ej
        .request()
        .input('med', sql.VarChar(4), p.doctorExternalKey)
        .input('hora', sql.VarChar(18), feHora)
        .input('ser', sql.VarChar(12), p.serviceExternalKey)
        .input('hist', sql.VarChar(20), p.patientDocument)
        .input('dura', sql.Int, duracion)
        // Literal 'YYYYMMDD', no un Date: ver fechaLiteralSql(). Un Date se
        // serializa en UTC y le pegaba cinco horas a la fecha del hospital.
        .input('fecha', sql.VarChar(8), fechaLiteralSql(feFecha))
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
    ej: Ejecutor,
    p: CanonicalChangeEvent['payload'],
  ): Promise<void> {
    const mapping = this.requireMapping();

    const existe = await ej
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

    // Si el paciente dio la frontera en el chatbot, se usa tal cual: no hay
    // nada que adivinar. La heurística queda solo para los pacientes
    // anteriores al cambio y para los que no vienen por WhatsApp.
    const nombre = p.patientNombres
      ? partirNombreDado(p.patientNombres, p.patientApellidos)
      : partirNombre(p.patientFullName);

    await ej
      .request()
      .input('hist', sql.VarChar(20), p.patientDocument)
      .input('docu', sql.VarChar(20), p.patientDocument)
      // El HIS parte el nombre en cuatro columnas, y `NO_NOMB_PAC` es solo el
      // PRIMER NOMBRE, varchar(20). Meter ahí el nombre completo reventaba el
      // INSERT en producción con el error 8152 — ver partirNombre().
      .input('nomb', sql.VarChar(20), nombre.primerNombre)
      .input('sgno', sql.VarChar(20), nombre.segundoNombre)
      .input('prap', sql.VarChar(30), nombre.primerApellido)
      .input('sgap', sql.VarChar(30), nombre.segundoApellido)
      .input('naci', sql.DateTime, new Date(p.patientBirthDateIso))
      .input('sexo', sql.TinyInt, mapSexo(mapping, p.patientGender)).query(`
        INSERT INTO dbo.PACIENTES (
          NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC,
          NO_NOMB_PAC, NO_SGNO_PAC, DE_PRAP_PAC, DE_SGAP_PAC,
          FE_NACI_PAC, NU_SEXO_PAC, FE_HIST_PAC, NU_EXTR_PAC
        ) VALUES (@hist, @docu, 0, @nomb, @sgno, @prap, @sgap,
                  @naci, @sexo, GETDATE(), 0)`);
  }

  /** Turno del médico ese día: de ahí salen el consultorio y la disponibilidad. */
  private async turnoDelDia(
    ej: Ejecutor,
    medico: string,
    fechaIso: string,
  ): Promise<{ consultorio: string | null } | null> {
    const r = await ej
      .request()
      .input('med', sql.VarChar(4), medico)
      // Mismo motivo que en el INSERT: `FE_FECH_TUME` es una fecha sin zona.
      // El `CAST(... AS date)` disimulaba el desfase mientras el agente
      // corriera al oeste de UTC — desde una zona al este, la comparación
      // caía en el día anterior y el médico "no tenía turno".
      .input('fecha', sql.VarChar(8), fechaLiteralSql(fechaIso)).query(`
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

      // El alta de la cita nueva reusa la MISMA lógica que un alta suelta
      // —convenio, consultorio, alta de paciente, validaciones— pero sobre
      // esta transacción. Duplicarla aquí sería garantizar que las dos
      // versiones se separen con el tiempo.
      const alta = await this.crearCita(tx, evt);

      // 🛡️ Si la cita nueva no se pudo crear, la vieja NO se puede haber
      // ido. Antes esto no era así: la anulación hacía `commit` y solo
      // DESPUÉS se intentaba el alta, fuera de la transacción. Si el alta
      // fallaba —el médico no tiene turno ese día, el cupo ya está vendido en
      // el HIS— el paciente se quedaba sin NINGUNA cita: la vieja borrada y
      // la nueva nunca escrita, mientras AgenIA creía haberla movido.
      // Reagendar es mover, y mover es una sola cosa o ninguna.
      if (!alta.success) {
        await tx.rollback();
        return {
          success: false,
          message: `no se reagendó, la cita anterior sigue en pie: ${alta.message ?? 'el alta falló'}`,
        };
      }

      await tx.commit();
      return { success: true };
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
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
    //
    // ⚠️ `AND NU_ESTA_CIT = 0` no es un refinamiento — sin él se cancela lo
    // que no se debía.
    //
    // La PK de `CITAS_MEDICAS` es (médico, hora, ESTADO) — el estado integra
    // la clave (MAPEO_HIS.md §1) precisamente para que dos citas puedan
    // coexistir en el mismo médico+hora si tienen estados distintos. Eso pasa
    // de verdad: la aplicación del hospital hace el desenlace de atención con
    // un UPDATE en sitio (0→1/2), lo que LIBERA la tupla (médico, hora, 0) —
    // y nada impide que esa hora se vuelva a agendar después. Filtrar solo
    // por (médico, hora), como hacía este método, significaba que cancelar la
    // cita nueva (estado 0) también copiaba y BORRABA la cita ya atendida
    // (estado 1/2) que compartía la misma hora: un paciente ya atendido
    // desaparecía de la historia del hospital por la cancelación de otro.
    const copia = await tx.request()
      .input('med', sql.VarChar(4), datos.medico)
      .input('hora', sql.VarChar(18), datos.feHora)
      .input('moti', sql.VarChar(2), datos.motivo)
      .input('obse', sql.VarChar(255), datos.observacion).query(`
        -- ⚠️ CITAS_ANULADAS NO es CITAS_MEDICAS con el sufijo cambiado.
        --
        -- Le faltan cuatro columnas que la cita SÍ tiene: NU_ESTA, CD_CODI_CECO,
        -- CD_CODI_LUAT y FE_SOLI. Nombrarlas aquí hacía fallar el INSERT en el
        -- hospital con "Invalid column name" (error 207) y, con él, TODA
        -- cancelación: el paciente recibía "cancelada" por WhatsApp y el
        -- hospital se quedaba con la cita. No se veía en pruebas porque el mock
        -- local se había construido creyendo esa equivalencia y las inventó.
        -- Esquema real confirmado en el bloque 28 (esquema-real.tsv).
        INSERT INTO dbo.CITAS_ANULADAS (
          CD_CODI_MED_CIAN, FE_HORA_CIAN, CD_CODI_SER_CIAN,
          NU_HIST_PAC_CIAN, NU_DURA_CIAN, FE_ELAB_CIAN, FE_FECH_CIAN,
          NU_DIA_CIAN, NU_NUME_MOVI_CIAN, NU_PRIM_CIAN, NU_NUME_CONE_CIAN,
          NU_CONE_CALL_CIAN, CD_CODI_ESP_CIAN, CD_CODI_CONS_CIAN,
          NU_NUME_CONV_CIAN, NU_TIPO_CIAN, DE_DESC_CIAN, NU_AUTO_AGRU_CIAN,
          CD_CODI_EST_CIAN, CD_CODI_CAMP_CIAN, NU_CODIGO_HSWE_CIAN,
          CD_CODI_MOTI_CIAN, TX_OBSE_CIAN
        )
        SELECT
          CD_CODI_MED_CIT, FE_HORA_CIT, CD_CODI_SER_CIT,
          NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
          NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_NUME_CONE_CIT,
          NU_CONE_CALL_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT,
          NU_NUME_CONV_CIT, NU_TIPO_CIT, DE_DESC_CIT, NU_AUTO_AGRU_CIT,
          CD_CODI_EST_CIT, CD_CODI_CAMP_CIT, NU_CODIGO_HSWE_CIT,
          @moti, @obse
        FROM dbo.CITAS_MEDICAS
        WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora AND NU_ESTA_CIT = 0`);

    if ((copia.rowsAffected[0] ?? 0) === 0) return false;

    await tx
      .request()
      .input('med', sql.VarChar(4), datos.medico)
      .input('hora', sql.VarChar(18), datos.feHora)
      .query(
        'DELETE FROM dbo.CITAS_MEDICAS WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora AND NU_ESTA_CIT = 0',
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
