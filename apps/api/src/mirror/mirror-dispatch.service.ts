import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SYNC_AUDIT_DIRECTION,
  TITULO_EXCEPCION,
  claveExcepcion,
  compuertasHis,
  eventoPuedeSalir,
  operacionHisDelEvento,
  severidadPorCercania,
  type CompuertasHis,
} from '@agenia/shared';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import {
  AckInput,
  AckResult,
  HandshakeInput,
  HandshakeResult,
  HeartbeatInput,
  OutboxEventDto,
  OutboxEventContext,
} from './dto/mirror.types';

const DEFAULT_LONG_POLL_MS = 25_000;
const DEFAULT_LONG_POLL_INTERVAL_MS = 1_000;
const DEFAULT_EVENTS_LIMIT = 100;
/** Reintentos antes de marcar un evento como dead-letter (ver plan §6, capa 4). */
const MAX_DELIVERY_ATTEMPTS = 10;
/** Techo del backoff entre reintentos. Con 2^n y este techo, los 10 intentos
 *  se agotan en ~18 minutos: suficiente para absorber un HIS que parpadea, y
 *  lo bastante corto para que el dead-letter sea alcanzable el mismo día. */
const MAX_BACKOFF_MS = 5 * 60_000;
/** Cuántos pendientes se examinan para armar un lote de `limit` entregables.
 *  Se lee de más porque el filtro de "uno por entidad" descarta filas: con el
 *  factor en 1 un lote podría salir casi vacío teniendo trabajo de sobra. */
const SCAN_WINDOW_FACTOR = 10;

/**
 * Backoff exponencial: 2s, 4s, 8s… con techo de 5 minutos.
 *
 * Sin esto, un evento que el HIS rechaza se reintentaba en CADA vuelta del
 * agente (cada 5s en producción): ruido en el log, carga inútil sobre el HIS,
 * y 10 intentos quemados en menos de un minuto.
 */
export function backoffMs(attempts: number): number {
  const exponente = Math.min(attempts, 20);
  return Math.min(2 ** exponente * 1000, MAX_BACKOFF_MS);
}
/** Tope del motivo de fallo que se guarda en `SyncOutbox.lastError`. Un mensaje
 *  de driver puede traer una traza entera; con esto basta para diagnosticar. */
const MAX_LAST_ERROR_CHARS = 1000;
/** Un `seq` válido: dígitos. Lo que no lo sea se ignora en vez de romper el ack
 *  entero — `BigInt('abc')` lanza. */
const SEQ_RE = /^\d+$/;
/** Skew de reloj tolerado antes de alertar (ver plan §7). */
const CLOCK_SKEW_ALERT_MS = 30_000;

/**
 * Lado "AgenIA → agente" del protocolo /mirror/*: handshake, entrega de
 * eventos pendientes del outbox (long-poll), ack, y heartbeat. Nunca conoce
 * el driver que hay detrás — solo el `driverKey`/`driverConfig` que le
 * devuelve al agente en el handshake para que el agente sepa qué cargar.
 */
@Injectable()
export class MirrorDispatchService {
  private readonly logger = new Logger(MirrorDispatchService.name);

  // Propiedades (no constructor-injectadas: Nest no puede resolver un
  // `number` por tipo) para que los tests puedan reescribirlas y usar
  // ventanas de milisegundos en vez de esperar los 25s reales de producción.
  private longPollMs = DEFAULT_LONG_POLL_MS;
  private longPollIntervalMs = DEFAULT_LONG_POLL_INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    // La bandeja: una cancelación que el HIS no aplicó (era de otro paciente) deja
    // un caso para el personal. Opcional: sin él (pruebas), solo queda la auditoría.
    @Optional() private readonly exceptions?: MirrorExceptionsService,
  ) {}

  async handshake(
    organizationId: string,
    driverKey: string,
    driverConfig: unknown,
    input: HandshakeInput,
  ): Promise<HandshakeResult> {
    const config = await this.prisma.hospitalMirrorConfig.findUniqueOrThrow({
      where: { organizationId },
    });

    const serverTime = new Date();
    const agentTime = new Date(input.agentClockIso);
    const clockSkewMs = serverTime.getTime() - agentTime.getTime();

    if (Math.abs(clockSkewMs) > CLOCK_SKEW_ALERT_MS) {
      this.logger.warn(
        `Clock skew de ${clockSkewMs}ms con el agente de la organización ${organizationId} (driver ${driverKey}).`,
      );
    }

    await this.prisma.hospitalMirrorConfig.update({
      where: { organizationId },
      data: { lastHeartbeatAt: serverTime },
    });

    return {
      ok: true,
      serverTimeIso: serverTime.toISOString(),
      clockSkewMs,
      driverKey,
      driverConfig,
      mappingVersion: config.mappingVersion,
      mappingJson: config.mappingJson,
      pushEnabled: config.pushEnabled,
      pullEnabled: config.pullEnabled,
    };
  }

  /**
   * Long-poll: si ya hay eventos entregables, responde de inmediato; si no,
   * espera hasta LONG_POLL_MS reintentando cada LONG_POLL_INTERVAL_MS antes
   * de responder con una lista vacía (el agente vuelve a preguntar).
   *
   * ⚠️ `cursorSeq` se recibe por compatibilidad de protocolo pero YA NO FILTRA.
   * Antes la consulta era `seq > cursor`, y el agente avanzaba su cursor local
   * aunque el evento fallara: un evento fallido no se volvía a servir NUNCA
   * mientras el agente siguiera vivo. Medido en vivo el 2026-08-31 — `attempts`
   * subía como mucho una vez por reinicio del agente, así que el dead-letter de
   * 10 intentos era inalcanzable y la garantía de cero pérdida del plan §6 no
   * se cumplía. La verdad de "pendiente" es `deliveredAt IS NULL`, no el
   * cursor; el espaciado entre reintentos lo da ahora `nextAttemptAt`.
   *
   * Efecto lateral bueno: si un ack se pierde en la red, el evento vuelve a
   * entregarse y la idempotencia del agente lo absorbe. Antes quedaba varado.
   */
  async getPendingEvents(
    organizationId: string,
    _cursorSeq: bigint,
    limit: number = DEFAULT_EVENTS_LIMIT,
  ): Promise<OutboxEventDto[]> {
    const deadline = Date.now() + this.longPollMs;

    while (true) {
      // 🚪 Compuertas hacia el hospital, una por operación (`compuerta-his.ts`):
      // altas con «Agendar», cancelaciones con «Cancelar», cambios de fecha con
      // «Cambiar fecha». Se consultan en CADA vuelta y no una vez al entrar:
      // apagar una a mitad de un long-poll de 25 s tiene que surtir efecto en el
      // siguiente segundo, no en la siguiente llamada. Con el interruptor apagado
      // la base ni deja hacer la operación (`fn_interruptores_del_hospital`), así
      // que lo que esperaría aquí es solo lo hecho en el instante de apagarlo.
      // Se lee la cola aunque todas estén cerradas: lo que nunca va al hospital
      // (cupos, asistencia…) se cierra igual, para que no quede nada en ella.
      const compuertas = await this.compuertasHaciaElHospital(organizationId);
      const rows = await this.selectDeliverable(
        organizationId,
        limit,
        compuertas,
      );

      if (rows.length > 0 || Date.now() >= deadline) {
        return this.hydrateSafely(organizationId, rows);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.longPollIntervalMs),
      );
    }
  }

  /**
   * Elige qué eventos pendientes son entregables ahora, con dos reglas:
   *
   * 1. **Backoff:** se salta lo que aún no cumple su `nextAttemptAt`.
   * 2. **Un evento por entidad y por lote.** Al desaparecer el cursor global
   *    se pierde el orden estricto por `seq`, y eso importa: si el INSERT de
   *    una cita falla y su DELETE posterior sí se aplica, el HIS recibe la
   *    cancelación de una cita que no existe. Entregando como mucho un evento
   *    por entidad y esperando su ack antes del siguiente, el orden POR
   *    ENTIDAD queda garantizado — que es la granularidad que pide el plan §6
   *    capa 3, sin bloquear la cola entera por una entidad atascada.
   *
   * Las entidades distintas siguen viajando juntas en el mismo lote, así que
   * el rendimiento no cambia en el caso normal: una cita acumula uno o dos
   * eventos pendientes, no cientos.
   */
  /**
   * ¿Qué se le puede entregar al agente para que lo escriba en el HIS? Falla
   * cerrado: sin fila de configuración, o con cualquier valor que no sea
   * exactamente `true`, esa compuerta no deja salir nada hacia el hospital.
   */
  private async compuertasHaciaElHospital(
    organizationId: string,
  ): Promise<CompuertasHis> {
    const ajustes = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: {
        bookingEnabled: true,
        cancelEnabled: true,
        rescheduleEnabled: true,
      },
    });
    return compuertasHis(ajustes);
  }

  private async selectDeliverable(
    organizationId: string,
    limit: number,
    compuertas: CompuertasHis,
  ) {
    const ahora = new Date();

    const candidatos = await this.prisma.syncOutbox.findMany({
      // 🪞 ANTI-ECO, por partida doble: el disparador ya marca como entregado lo que
      // nace en el HIS, y aquí se vuelve a excluir. Si una de esas filas quedara
      // pendiente por cualquier vía, el hospital recibiría de vuelta lo que él mismo
      // agendó — con el alta en caliente, una cita duplicada. Va en el WHERE y no
      // como filtro posterior: si no, esas filas ocuparían la ventana de lectura
      // para siempre (son las más viejas) y taparían a las que sí hay que entregar.
      where: {
        organizationId,
        deliveredAt: null,
        deadLettered: false,
        origin: { not: 'MIRROR' },
      },
      orderBy: { seq: 'asc' },
      take: limit * SCAN_WINDOW_FACTOR,
    });

    const entidadesVistas = new Set<string>();
    const entregables: typeof candidatos = [];
    /** Lo que nunca va al hospital: se cierra aquí, sin pasar por el agente. */
    const sinEnviar: typeof candidatos = [];

    for (const row of candidatos) {
      const entidad = `${row.entityType}:${row.entityId}`;
      // Ya hay un evento de esta entidad en el lote, o el primero de la
      // entidad está esperando su backoff o su compuerta: en todos los casos
      // los siguientes esperan su turno, o se rompería el orden.
      if (entidadesVistas.has(entidad)) continue;
      entidadesVistas.add(entidad);

      // 🚪 Cupos, médicos, asistencia, EPS, motivo, el borrado de una cita: el
      // hospital no los recibe nunca. Se cierran ya —y no se dejan esperando—
      // porque, si no, taparían a la cancelación que venga detrás de la misma
      // cita (el orden por entidad la haría esperar para siempre). El siguiente
      // evento de la entidad sale en la próxima vuelta, un segundo después.
      if (operacionHisDelEvento(row) === 'OTRO') {
        sinEnviar.push(row);
        continue;
      }
      // La compuerta de SU operación está cerrada: espera en la cola.
      if (!eventoPuedeSalir(row, compuertas)) continue;
      if (row.nextAttemptAt && row.nextAttemptAt > ahora) continue;

      entregables.push(row);
      if (entregables.length >= limit) break;
    }

    if (sinEnviar.length > 0) {
      await this.cerrarSinEnviar(organizationId, sinEnviar);
    }

    // La ventana de lectura se llenó y aun así no salió un lote completo:
    // hay una entidad acumulando muchísimos eventos pendientes y podría estar
    // tapando a las de más atrás. No es una pérdida (la siguiente vuelta
    // sigue avanzando) pero sí una anomalía que merece verse.
    if (
      candidatos.length === limit * SCAN_WINDOW_FACTOR &&
      entregables.length < limit
    ) {
      this.logger.warn(
        `La ventana de selección de la organización ${organizationId} se saturó: ` +
          `${candidatos.length} pendientes examinados para ${entregables.length} entregables. ` +
          `Probablemente una entidad acumula muchos eventos sin entregar.`,
      );
    }

    return entregables;
  }

  /**
   * Cierra, sin entregárselos al agente, los eventos que el hospital no recibe
   * nunca (`operacionHisDelEvento` = OTRO). Queda la constancia en la auditoría,
   * igual que cuando era el agente el que los declinaba.
   */
  private async cerrarSinEnviar(
    organizationId: string,
    filas: {
      seq: bigint;
      eventId: string;
      entityType: string;
      entityId: string;
      op: string;
    }[],
  ): Promise<void> {
    await this.prisma.syncOutbox.updateMany({
      where: {
        organizationId,
        seq: { in: filas.map((f) => f.seq) },
        deliveredAt: null,
      },
      data: { deliveredAt: new Date(), nextAttemptAt: null },
    });
    await this.prisma.syncAudit.createMany({
      data: filas.map((f) => ({
        organizationId,
        direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
        entityType: f.entityType,
        entityId: f.entityId,
        op: f.op,
        outcome: 'SKIPPED',
        eventId: f.eventId,
        detail:
          'No se escribe en el hospital (cupos, médicos, asistencia, EPS, motivo o ' +
          'borrado de una cita): se cierra sin enviarlo al agente.',
      })),
    });
  }

  /**
   * Envoltorio de `hydrate` que nunca deja caer el poll entero.
   *
   * Si la hidratación falla (una consulta que revienta, un modelo que no
   * responde), entregar los eventos SIN contexto sería lo peor posible: el
   * driver los recibiría con las claves del HIS vacías y escribiría citas a
   * medias. Y no entregar nada dejaría al agente sin saber por qué.
   *
   * Así que se entregan marcados como no aplicables: el motor los rechaza sin
   * tocar el HIS, suben su contador de intentos y acaban en dead-letter con el
   * motivo real escrito.
   */
  private async hydrateSafely(
    organizationId: string,
    rows: Awaited<ReturnType<MirrorDispatchService['selectDeliverable']>>,
  ): Promise<OutboxEventDto[]> {
    try {
      return await this.hydrate(organizationId, rows);
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Falló la hidratación de ${rows.length} evento(s) de la organización ${organizationId}: ${detalle}. ` +
          `Se entregan marcados como no aplicables para que el agente NO escriba en el HIS.`,
      );
      return rows.map((r) => ({
        seq: r.seq.toString(),
        eventId: r.eventId,
        entityType: r.entityType as OutboxEventDto['entityType'],
        entityId: r.entityId,
        op: r.op as OutboxEventDto['op'],
        payload: r.payload,
        context: { missingMappings: [`hidratación falló: ${detalle}`] },
        createdAt: r.createdAt.toISOString(),
      }));
    }
  }

  /**
   * Completa cada evento con lo que la fila cruda no trae.
   *
   * El trigger serializa `Appointment` tal cual, y esa fila no tiene la hora,
   * ni el médico, ni el servicio — eso vive en `ScheduleSlot`. Un driver que
   * recibiera solo eso no podría construir el INSERT de su HIS. Aquí se hacen
   * los joins y se resuelven las claves externas contra `MirrorEntityMap`.
   *
   * Se hace en lote, no evento por evento: un lote de 100 citas producía 400
   * consultas sueltas. Así son cuatro, sea cual sea el tamaño del lote.
   */
  private async hydrate(
    organizationId: string,
    rows: Awaited<ReturnType<MirrorDispatchService['selectDeliverable']>>,
  ): Promise<OutboxEventDto[]> {
    const base = rows.map((r) => ({
      seq: r.seq.toString(),
      eventId: r.eventId,
      entityType: r.entityType as OutboxEventDto['entityType'],
      entityId: r.entityId,
      op: r.op as OutboxEventDto['op'],
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));

    const citas = rows.filter((r) => r.entityType === 'APPOINTMENT');
    if (citas.length === 0) return base;

    // La fila cruda del outbox: de ahí salen los ids a los que hay que ir.
    const filaDe = (r: (typeof rows)[number]) =>
      (r.payload ?? {}) as Record<string, unknown>;
    const idsDe = (campo: string) =>
      Array.from(
        new Set(
          citas
            .map((r) => filaDe(r)[campo])
            .filter((v): v is string => typeof v === 'string'),
        ),
      );

    // Un reagendamiento mueve `scheduleSlotId` en la MISMA fila, así que el
    // cupo anterior solo existe en el `__old` que adjunta el trigger. Sin
    // resolverlo, el driver no sabría qué cita borrar en el HIS.
    const idsAnteriores = citas
      .map((r) => filaDe(r).__old as Record<string, unknown> | undefined)
      .map((old) => old?.scheduleSlotId)
      .filter((v): v is string => typeof v === 'string');

    const slotIds = Array.from(
      new Set([...idsDe('scheduleSlotId'), ...idsAnteriores]),
    );
    const patientIds = idsDe('patientId');
    const epsIds = idsDe('epsId');

    const [slots, pacientes, epsRows] = await Promise.all([
      this.prisma.scheduleSlot.findMany({
        where: { id: { in: slotIds }, organizationId },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          doctorId: true,
          serviceId: true,
        },
      }),
      this.prisma.patientProfile.findMany({
        where: { id: { in: patientIds }, organizationId },
        select: {
          id: true,
          cedula: true,
          fullName: true,
          nombres: true,
          apellidos: true,
          dateOfBirth: true,
          gender: true,
          regime: true,
        },
      }),
      this.prisma.eps.findMany({
        where: { id: { in: epsIds }, organizationId },
        select: { id: true, nit: true, name: true },
      }),
    ]);

    const slotPorId = new Map(slots.map((s) => [s.id, s]));
    const pacientePorId = new Map(pacientes.map((p) => [p.id, p]));
    const epsPorId = new Map(epsRows.map((e) => [e.id, e]));

    // Homologación de médicos y servicios en una sola consulta.
    const mapas = await this.prisma.mirrorEntityMap.findMany({
      where: {
        organizationId,
        entityType: { in: ['DOCTOR', 'SERVICE'] },
        agenIAId: {
          in: [...new Set(slots.flatMap((s) => [s.doctorId, s.serviceId]))],
        },
      },
      select: { entityType: true, agenIAId: true, externalKey: true },
    });
    const claveExterna = new Map(
      mapas.map((m) => [`${m.entityType}:${m.agenIAId}`, m.externalKey]),
    );

    return base.map((dto, i) => {
      if (dto.entityType !== 'APPOINTMENT') return dto;

      const fila = filaDe(rows[i]);
      const slot = slotPorId.get(fila.scheduleSlotId as string);
      const paciente = pacientePorId.get(fila.patientId as string);
      const eps = epsPorId.get(fila.epsId as string);

      const missing: string[] = [];
      const context: OutboxEventContext = {};
      // Un DELETE se anula en el HIS por médico + hora (`cancelAppointment`):
      // servicio, paciente y EPS no se usan. Exigirlos dejaba sin entregar
      // justo el caso típico de un borrado físico —el paciente ya se borró
      // junto con la cita— y la cita seguía viva en el HIS.
      const soloAnula = dto.op === 'DELETE';

      if (slot) {
        context.startTimeIso = slot.startTime.toISOString();
        context.endTimeIso = slot.endTime.toISOString();

        const medico = claveExterna.get(`DOCTOR:${slot.doctorId}`);
        if (medico) context.doctorExternalKey = medico;
        else missing.push(`DOCTOR ${slot.doctorId}`);

        const servicio = claveExterna.get(`SERVICE:${slot.serviceId}`);
        if (servicio) context.serviceExternalKey = servicio;
        else if (!soloAnula) missing.push(`SERVICE ${slot.serviceId}`);
      } else {
        // El cupo desapareció entre la captura y la entrega. No es
        // recuperable desde aquí, pero tampoco se descarta en silencio.
        missing.push(`SLOT ${String(fila.scheduleSlotId)}`);
      }

      // Cupo anterior de un reagendamiento: solo se adjunta si de verdad
      // cambió. Un UPDATE de asistencia no es un reagendamiento.
      const anteriorId = (fila.__old as Record<string, unknown> | undefined)
        ?.scheduleSlotId;
      if (
        typeof anteriorId === 'string' &&
        anteriorId !== fila.scheduleSlotId
      ) {
        const anterior = slotPorId.get(anteriorId);
        if (anterior) {
          context.previousStartTimeIso = anterior.startTime.toISOString();
          const medicoAnterior = claveExterna.get(
            `DOCTOR:${anterior.doctorId}`,
          );
          if (medicoAnterior) {
            context.previousDoctorExternalKey = medicoAnterior;
          } else {
            missing.push(`DOCTOR ${anterior.doctorId} (cupo anterior)`);
          }
        } else {
          missing.push(`SLOT ${anteriorId} (cupo anterior)`);
        }
      }

      if (paciente) {
        // El documento NO se homologa: en este HIS la historia ES el documento,
        // y en general es la clave con la que cualquier HIS identifica gente.
        context.patientDocument = paciente.cedula;
        context.patientFullName = paciente.fullName;
        // Si el paciente dio la frontera, viaja: el driver no tiene que
        // adivinar dónde acaban los nombres y empiezan los apellidos.
        if (paciente.nombres) context.patientNombres = paciente.nombres;
        if (paciente.apellidos) context.patientApellidos = paciente.apellidos;
        if (paciente.dateOfBirth)
          context.patientBirthDateIso = paciente.dateOfBirth.toISOString();
        if (paciente.gender) context.patientGender = paciente.gender;
        if (paciente.regime) context.patientRegime = paciente.regime;
      } else if (!soloAnula) {
        missing.push(`PATIENT ${String(fila.patientId)}`);
      }

      // La EPS es opcional (una cita particular no tiene): su ausencia no
      // rompe nada, pero si la cita SÍ declara una y no la encontramos, eso sí.
      if (eps) {
        if (eps.nit) context.epsNit = eps.nit;
        context.epsName = eps.name;
      } else if (fila.epsId && !soloAnula) {
        missing.push(`EPS ${String(fila.epsId as string)}`);
      }

      if (missing.length > 0) {
        context.missingMappings = missing;
        this.logger.warn(
          `Evento ${dto.eventId} (org ${organizationId}) se entrega SIN homologar: ` +
            `falta ${missing.join(', ')}. El agente lo rechazará sin tocar el HIS.`,
        );
      }

      return { ...dto, context };
    });
  }

  async ack(organizationId: string, input: AckInput): Promise<AckResult> {
    const seqs = input.seqs.map((s) => BigInt(s));
    // 🧾 Lo que el agente escribió en el hospital, ANTES de marcarlo: solo los
    // que aún no estaban entregados (un ack repetido no duplica la constancia).
    const escritos =
      seqs.length > 0
        ? await this.prisma.syncOutbox.findMany({
            where: { organizationId, seq: { in: seqs }, deliveredAt: null },
            select: {
              eventId: true,
              entityType: true,
              entityId: true,
              op: true,
              payload: true,
            },
          })
        : [];
    const result = await this.prisma.syncOutbox.updateMany({
      where: { organizationId, seq: { in: seqs } },
      // `nextAttemptAt: null` limpia el backoff de un evento que había fallado
      // antes y ahora sí se aplicó: la fila queda entregada y limpia, sin una
      // marca de reintento futuro que ya no significa nada. Lo mismo el motivo
      // del último fallo: un evento entregado no tiene "error vigente".
      data: { deliveredAt: new Date(), nextAttemptAt: null, lastError: null },
    });
    // 🧾 Constancia de cada escritura en el hospital (2026-10-16). Hasta hoy solo
    // quedaban los fallos, los rechazos y lo que se cerraba sin enviar: la
    // primera cancelación real en el HIS no dejó rastro en la auditoría, y
    // «escrituras en el HIS = 0» no se distinguía de «nada se escribió».
    if (escritos.length > 0) {
      const QUE = {
        AGENDAR: 'alta de la cita',
        CANCELAR: 'cancelación de la cita',
        MODIFICAR: 'cambio de fecha de la cita',
        OTRO: 'cambio',
      } as const;
      await this.prisma.syncAudit.createMany({
        data: escritos.map((e) => ({
          organizationId,
          direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
          entityType: e.entityType,
          entityId: e.entityId,
          op: e.op,
          outcome: 'OK',
          eventId: e.eventId,
          detail: `Escrito en el sistema del hospital: ${QUE[operacionHisDelEvento(e)]}.`,
        })),
      });
    }

    // Los que el agente reporta como fallidos NO se marcan delivered — quedan
    // pendientes para el próximo pull hasta agotar reintentos (ver plan §6,
    // capa 4: dead-letter con alerta, nunca descarte silencioso).
    //
    // `failures` trae el motivo; `failedSeqs` es la lista que entienden todas
    // las versiones del agente. Se unen: un agente antiguo sin `failures` cuenta
    // el intento igual (sin motivo), y un `seq` solo presente en `failures`
    // también cuenta. Cada `seq` se procesa UNA vez — contarlo dos habría
    // gastado dos intentos de los diez por un solo fallo.
    const motivos = new Map<string, string>();
    // 🏥 H10/H11 (docs/PLAN_AGENDA_HUECOS.md): el HIS rechazó la cita de forma
    // definitiva (hora tomada o cruce). Reintentarla no cambia nada: se anula en
    // AgenIA para que el bot le ofrezca otra hora al paciente.
    const rechazos = new Set<string>();
    for (const f of input.failures ?? []) {
      if (f && typeof f.seq === 'string' && SEQ_RE.test(f.seq)) {
        motivos.set(f.seq, typeof f.error === 'string' ? f.error : '');
        if (f.rechazoDelHis === true) rechazos.add(f.seq);
      }
    }
    const fallidos = new Set<string>([
      ...(input.failedSeqs ?? []),
      ...motivos.keys(),
    ]);
    for (const seq of fallidos) {
      if (
        rechazos.has(seq) &&
        (await this.markRejectedByHis(organizationId, seq, motivos.get(seq)))
      ) {
        continue;
      }
      await this.markAttemptFailed(organizationId, seq, motivos.get(seq));
    }

    for (const seq of input.skippedSeqs ?? []) {
      await this.markSkipped(organizationId, seq);
    }

    return { acknowledged: result.count };
  }

  /**
   * 🏥 El HIS rechazó el ALTA de una cita de forma definitiva: la hora ya estaba
   * tomada o se cruza con otra cita del médico (H11). Reintentarla diez veces
   * no cambia el resultado y deja al paciente creyendo que tiene cita.
   *
   * En una sola transacción con origen MIRROR (no vuelve al HIS, que nunca la
   * tuvo): la cita se anula en AgenIA con el motivo en `metaLog`, el cupo se
   * CIERRA (el hospital ya tiene ese tiempo ocupado: liberarlo lo volvería a
   * ofrecer) y el evento se cierra con el motivo. No se avisa a la lista de
   * espera por la misma razón. El bot ve la cita anulada y le ofrece otra hora
   * (H10).
   *
   * Un CAMBIO de fecha rechazado (UPDATE de la cita) no se anula: vuelve a su
   * hora anterior (`revertirCambioRechazado`).
   *
   * Devuelve false si el evento no es un alta ni un cambio de cita de esta
   * clínica: entonces se trata como cualquier fallo.
   */
  async markRejectedByHis(
    organizationId: string,
    seq: string,
    motivo?: string,
  ): Promise<boolean> {
    const evento = await this.prisma.syncOutbox.findFirst({
      where: { seq: BigInt(seq), organizationId },
      select: {
        eventId: true,
        entityType: true,
        entityId: true,
        op: true,
        payload: true,
      },
    });
    if (!evento || evento.entityType !== 'APPOINTMENT') return false;
    const operacion = operacionHisDelEvento(evento);
    if (operacion === 'CANCELAR') {
      return this.cerrarCancelacionNoAplicada(
        organizationId,
        seq,
        evento,
        motivo,
      );
    }
    if (evento.op === 'UPDATE') {
      return this.revertirCambioRechazado(organizationId, seq, evento, motivo);
    }
    if (evento.op !== 'INSERT') return false;
    const texto = (motivo ?? '').trim() || 'el HIS rechazó la cita';

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
      const cita = await tx.appointment.findFirst({
        where: { id: evento.entityId, organizationId },
        select: { id: true, status: true, scheduleSlotId: true, metaLog: true },
      });
      if (cita && cita.status !== 'CANCELLED') {
        const previo =
          cita.metaLog &&
          typeof cita.metaLog === 'object' &&
          !Array.isArray(cita.metaLog)
            ? (cita.metaLog as Record<string, unknown>)
            : {};
        await tx.appointment.update({
          where: { id: cita.id },
          data: {
            status: 'CANCELLED',
            metaLog: {
              ...previo,
              rechazoDelHis: { motivo: texto, en: new Date().toISOString() },
            },
          },
        });
        await tx.scheduleSlot.update({
          where: { id: cita.scheduleSlotId },
          data: { isAvailable: false },
        });
      }
      await tx.syncOutbox.updateMany({
        where: { seq: BigInt(seq), organizationId },
        data: {
          deliveredAt: new Date(),
          nextAttemptAt: null,
          attempts: { increment: 1 },
          lastError: `Rechazada por el HIS: ${texto}`.slice(0, 500),
        },
      });
      await tx.syncAudit.create({
        data: {
          organizationId,
          direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
          entityType: 'APPOINTMENT',
          entityId: evento.entityId,
          op: 'INSERT',
          outcome: 'CONFLICT',
          eventId: evento.eventId,
          detail:
            `El HIS rechazó la cita (${texto}). Se anuló en AgenIA y el cupo ` +
            `quedó cerrado; el bot le ofrece otra hora al paciente.`,
        },
      });
    });
    return true;
  }

  /**
   * 🛡️ El HIS no aplicó una CANCELACIÓN: a esa hora del médico tiene la cita de
   * OTRO paciente (2026-10-15). El agente no borró nada; reintentarla diez veces
   * no cambia el resultado.
   *
   * La cita sigue cancelada en AgenIA —el paciente pidió cancelarla, y en el
   * hospital no está a esa hora—, pero su cupo queda CERRADO (el hospital tiene
   * ese tiempo ocupado por otro: liberarlo lo volvería a ofrecer). El evento se
   * cierra con el motivo, queda la auditoría y un caso en la bandeja para que
   * alguien mire dónde quedó la cita de este paciente en el hospital. El bot ve la
   * marca en `metaLog` y se lo dice al paciente (H10).
   *
   * Todo con origen MIRROR: nada de esto vuelve al HIS.
   */
  private async cerrarCancelacionNoAplicada(
    organizationId: string,
    seq: string,
    evento: { eventId: string; entityId: string },
    motivo?: string,
  ): Promise<boolean> {
    const texto =
      (motivo ?? '').trim() || 'en el hospital esa hora es de otro paciente';

    const cita = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
      const fila = await tx.appointment.findFirst({
        where: { id: evento.entityId, organizationId },
        select: {
          id: true,
          patientId: true,
          epsId: true,
          scheduleSlotId: true,
          metaLog: true,
          scheduleSlot: { select: { startTime: true, doctorId: true } },
        },
      });
      if (fila) {
        const previo =
          fila.metaLog &&
          typeof fila.metaLog === 'object' &&
          !Array.isArray(fila.metaLog)
            ? (fila.metaLog as Record<string, unknown>)
            : {};
        await tx.appointment.update({
          where: { id: fila.id },
          data: {
            metaLog: {
              ...previo,
              cancelacionNoAplicadaEnElHis: {
                motivo: texto,
                en: new Date().toISOString(),
              },
            },
          },
        });
        // Solo si nadie más tiene una cita viva ahí (no debería: la de este
        // paciente está cancelada).
        await tx.scheduleSlot.updateMany({
          where: {
            id: fila.scheduleSlotId,
            appointments: { none: { status: { not: 'CANCELLED' } } },
          },
          data: { isAvailable: false },
        });
      }
      await tx.syncOutbox.updateMany({
        where: { seq: BigInt(seq), organizationId },
        data: {
          deliveredAt: new Date(),
          nextAttemptAt: null,
          attempts: { increment: 1 },
          lastError: `Cancelación no aplicada por el HIS: ${texto}`.slice(
            0,
            500,
          ),
        },
      });
      await tx.syncAudit.create({
        data: {
          organizationId,
          direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
          entityType: 'APPOINTMENT',
          entityId: evento.entityId,
          op: 'UPDATE',
          outcome: 'CONFLICT',
          eventId: evento.eventId,
          detail:
            `El HIS no aplicó la cancelación (${texto}): no se borró nada en el ` +
            `hospital. La cita sigue cancelada en AgenIA y su cupo quedó cerrado.`,
        },
      });
      return fila;
    });

    if (cita && this.exceptions) {
      try {
        const ahora = new Date();
        await this.exceptions.registrar(
          organizationId,
          {
            kind: 'CANCELACION_NO_APLICADA',
            dedupeKey: claveExcepcion.cancelacionNoAplicada(cita.id),
            severity: severidadPorCercania(
              'ALTA',
              (cita.scheduleSlot.startTime.getTime() - ahora.getTime()) /
                60_000,
            ),
            title: TITULO_EXCEPCION.CANCELACION_NO_APLICADA,
            detail: `Motivo del agente: ${texto}`.slice(0, 1000),
            appointmentId: cita.id,
            patientId: cita.patientId,
            entityType: 'APPOINTMENT',
            entityId: cita.id,
            outboxSeq: BigInt(seq),
            epsId: cita.epsId,
            doctorId: cita.scheduleSlot.doctorId,
            appointmentStartAt: cita.scheduleSlot.startTime,
            meta: {},
          },
          ahora,
        );
      } catch (error: unknown) {
        this.logger.error(
          `No se pudo abrir el caso de la cancelación no aplicada (evento ${seq}, org ${organizationId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return true;
  }

  /**
   * 🏥 H10 para el CAMBIO de fecha: el HIS rechazó de forma definitiva mover la
   * cita (la hora nueva ya está tomada o se cruza con otra, H11). El agente
   * reagenda en UNA transacción (anula la vieja y crea la nueva), así que en el
   * hospital la cita sigue en su hora de antes. AgenIA vuelve a ella.
   *
   * En una transacción con origen MIRROR (nada de esto viaja al HIS, que ya
   * tiene la cita donde estaba): la cita vuelve a su cupo anterior —que el bot
   * mantuvo reservado mientras esperaba— con el motivo en `metaLog`; el cupo
   * nuevo queda CERRADO (el hospital ya tiene ese tiempo ocupado: liberarlo lo
   * volvería a ofrecer) y el evento se cierra con el motivo. El bot ve la cita
   * de vuelta en su cupo y le ofrece otra hora al paciente.
   *
   * Devuelve false —y entonces se trata como cualquier fallo, que acaba en la
   * bandeja de excepciones— si el evento no es un cambio de cupo, si la cita ya
   * no está en el cupo nuevo o si el cupo de antes ya no se puede recuperar
   * (desapareció o tiene otra cita viva).
   */
  private async revertirCambioRechazado(
    organizationId: string,
    seq: string,
    evento: { eventId: string; entityId: string; payload: unknown },
    motivo?: string,
  ): Promise<boolean> {
    const fila =
      evento.payload && typeof evento.payload === 'object'
        ? (evento.payload as Record<string, unknown>)
        : {};
    const anterior = (fila.__old as Record<string, unknown> | undefined)
      ?.scheduleSlotId;
    const nuevo = fila.scheduleSlotId;
    if (
      typeof anterior !== 'string' ||
      typeof nuevo !== 'string' ||
      anterior === nuevo
    ) {
      return false;
    }
    const texto = (motivo ?? '').trim() || 'el HIS rechazó el cambio de fecha';

    const revertida = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
      const cita = await tx.appointment.findFirst({
        where: { id: evento.entityId, organizationId },
        select: { id: true, status: true, scheduleSlotId: true, metaLog: true },
      });
      if (
        !cita ||
        cita.status === 'CANCELLED' ||
        cita.scheduleSlotId !== nuevo
      ) {
        return false;
      }
      const cupoAnterior = await tx.scheduleSlot.findFirst({
        where: { id: anterior, organizationId },
        select: { id: true },
      });
      const ocupante = await tx.appointment.findFirst({
        where: {
          scheduleSlotId: anterior,
          status: { not: 'CANCELLED' },
          id: { not: cita.id },
        },
        select: { id: true },
      });
      if (!cupoAnterior || ocupante) return false;

      const previo =
        cita.metaLog &&
        typeof cita.metaLog === 'object' &&
        !Array.isArray(cita.metaLog)
          ? (cita.metaLog as Record<string, unknown>)
          : {};
      await tx.appointment.update({
        where: { id: cita.id },
        data: {
          scheduleSlotId: anterior,
          metaLog: {
            ...previo,
            cambioRechazadoPorElHis: {
              motivo: texto,
              cupoRechazado: nuevo,
              en: new Date().toISOString(),
            },
          },
        },
      });
      await tx.scheduleSlot.update({
        where: { id: anterior },
        data: { isAvailable: false },
      });
      await tx.scheduleSlot.update({
        where: { id: nuevo },
        data: { isAvailable: false },
      });
      await tx.syncOutbox.updateMany({
        where: { seq: BigInt(seq), organizationId },
        data: {
          deliveredAt: new Date(),
          nextAttemptAt: null,
          attempts: { increment: 1 },
          lastError: `Cambio rechazado por el HIS: ${texto}`.slice(0, 500),
        },
      });
      await tx.syncAudit.create({
        data: {
          organizationId,
          direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
          entityType: 'APPOINTMENT',
          entityId: evento.entityId,
          op: 'UPDATE',
          outcome: 'CONFLICT',
          eventId: evento.eventId,
          detail:
            `El HIS rechazó el cambio de fecha (${texto}). La cita volvió a su ` +
            `hora anterior en AgenIA, igual que en el hospital, y el cupo nuevo ` +
            `quedó cerrado; el bot le ofrece otra hora al paciente.`,
        },
      });
      return true;
    });

    if (!revertida) {
      this.logger.warn(
        `El HIS rechazó el cambio de fecha del evento ${seq} (org ${organizationId}), ` +
          `pero la cita no se pudo devolver a su cupo anterior: se trata como un fallo.`,
      );
    }
    return revertida;
  }

  /**
   * El agente declinó el evento a conciencia: su driver no espeja ese tipo de
   * entidad. Se cierra la fila (deliveredAt) en vez de reintentarla.
   *
   * 🚨 POR QUÉ EXISTE: cada reserva de cita genera además un evento SLOT (el
   * cupo pasa a ocupado) y el driver de Anserma no espeja SLOT. Antes de esto
   * esos eventos entraban por `failedSeqs`, quemaban sus diez intentos y
   * caían en dead-letter — a la décima cita el checker del monitor quedaba en
   * DOWN permanente por algo que no está roto. Una alerta que siempre está en
   * rojo deja de ser una alerta.
   *
   * No es un descarte silencioso: queda la fila en SyncAudit con outcome
   * SKIPPED, así que "no llegó al HIS porque no lo espejamos" sigue siendo
   * consultable el día que alguien pregunte.
   */
  async markSkipped(organizationId: string, seq: string): Promise<void> {
    const evento = await this.prisma.syncOutbox.findFirst({
      where: { seq: BigInt(seq), organizationId },
      select: { eventId: true, entityType: true, entityId: true, op: true },
    });

    // Mismo aislamiento de tenant que markAttemptFailed: el `seq` es una
    // secuencia global y un agente no puede cerrar el evento de otra clínica.
    if (!evento) {
      this.logger.warn(
        `La organización ${organizationId} reportó como no soportado el seq ${seq}, que no le pertenece o no existe. Ignorado.`,
      );
      return;
    }

    await this.prisma.syncOutbox.updateMany({
      where: { seq: BigInt(seq), organizationId },
      data: { deliveredAt: new Date(), nextAttemptAt: null },
    });

    await this.prisma.syncAudit.create({
      data: {
        organizationId,
        direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
        entityType: evento.entityType,
        entityId: evento.entityId,
        op: evento.op,
        outcome: 'SKIPPED',
        eventId: evento.eventId,
        detail: `El driver no espeja ${evento.entityType}; el evento se cierra sin enviarlo al HIS.`,
      },
    });
  }

  /**
   * Backoff simple: incrementa `attempts` en cada intento fallido reportado
   * por el agente; al llegar a MAX_DELIVERY_ATTEMPTS marca dead-letter y
   * queda visible en el dashboard para reproceso manual — nunca se descarta.
   *
   * 🔒 AISLAMIENTO DE TENANT: el `seq` es una secuencia GLOBAL, no por
   * organización. Hasta este cambio el update filtraba solo por `seq` y el
   * `organizationId` se recibía pero solo se usaba en el mensaje de log: un
   * agente podía reportar como fallido el `seq` de OTRA clínica y subirle los
   * intentos, o mandarle un evento a dead-letter. `updateMany` con las dos
   * condiciones cierra esa puerta; si no afectó ninguna fila, el seq no es de
   * quien dice serlo y se ignora dejando rastro.
   */
  async markAttemptFailed(
    organizationId: string,
    seq: string,
    error?: string,
  ): Promise<void> {
    // Se lee ANTES para calcular el backoff sobre el número de intentos que
    // tendrá tras este fallo. `updateMany` no devuelve la fila actualizada.
    const previo = await this.prisma.syncOutbox.findFirst({
      where: { seq: BigInt(seq), organizationId },
      select: { attempts: true },
    });
    const intentos = (previo?.attempts ?? 0) + 1;

    const { count } = await this.prisma.syncOutbox.updateMany({
      where: { seq: BigInt(seq), organizationId },
      data: {
        attempts: { increment: 1 },
        // Espacia el siguiente reintento. Sin esto el agente lo reintentaría
        // en cada vuelta de su bucle (cada 5s) y quemaría los 10 intentos en
        // menos de un minuto, mandando a dead-letter un HIS que solo estaba
        // reiniciándose.
        nextAttemptAt: new Date(Date.now() + backoffMs(intentos)),
        // Sin motivo (agente antiguo) NO se toca lo que hubiera: `undefined`
        // le dice a Prisma que ignore el campo. Con motivo vacío tampoco se
        // pisa el anterior con nada.
        lastError: error?.trim()
          ? error.trim().slice(0, MAX_LAST_ERROR_CHARS)
          : undefined,
      },
    });

    if (count === 0) {
      this.logger.warn(
        `La organización ${organizationId} reportó como fallido el seq ${seq}, que no le pertenece o no existe. Ignorado.`,
      );
      return;
    }

    const row = await this.prisma.syncOutbox.findFirst({
      where: { seq: BigInt(seq), organizationId },
    });
    if (!row) return;

    this.logger.debug(
      `Evento ${row.eventId} (org ${organizationId}) falló su intento ${row.attempts}; ` +
        `reintento no antes de ${row.nextAttemptAt?.toISOString() ?? 'ya'}.`,
    );

    if (row.attempts >= MAX_DELIVERY_ATTEMPTS && !row.deadLettered) {
      await this.prisma.syncOutbox.updateMany({
        where: { seq: row.seq, organizationId },
        data: { deadLettered: true },
      });
      this.logger.error(
        `Evento ${row.eventId} (org ${organizationId}) pasó a dead-letter tras ${row.attempts} intentos.`,
      );
    }
  }

  async heartbeat(
    organizationId: string,
    driverKey: string,
    input: HeartbeatInput,
  ): Promise<void> {
    await this.prisma.hospitalMirrorConfig.update({
      where: { organizationId },
      data: {
        lastHeartbeatAt: new Date(),
        // Se guarda, no solo se loguea: "el agente respira" y "el agente
        // alcanza su HIS" son cosas distintas, y la segunda tiene que verse en
        // el panel sin que nadie esté mirando el log en ese instante.
        lastHisReachable: input.hisReachable ?? null,
        lastHisDetail: input.hisDetail?.slice(0, 500) ?? null,
        // `null` = "no lo dice" (un agente anterior a la consulta en vivo): la
        // pantalla lo trata como "no puede", no como "sí".
        lastLookupCapable: input.lookupCapable ?? null,
      },
    });

    if (input.recentErrors && input.recentErrors > 0) {
      this.logger.warn(
        `Heartbeat con errores del agente (org ${organizationId}, driver ${driverKey}): ${input.recentErrors} errores recientes. ${input.detail ?? ''}`,
      );
    }

    // El agente late, pero ¿alcanza al HIS? Son dos cosas distintas y hasta
    // ahora el servidor solo sabía la primera.
    if (input.hisReachable === false) {
      this.logger.error(
        `🚨 El agente de la org ${organizationId} está vivo pero NO alcanza su HIS: ` +
          `${input.hisDetail ?? 'sin detalle'}. Ninguna cita se está espejando.`,
      );
    }
  }
}
