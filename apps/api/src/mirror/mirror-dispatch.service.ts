import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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
      const rows = await this.selectDeliverable(organizationId, limit);

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
  private async selectDeliverable(organizationId: string, limit: number) {
    const ahora = new Date();

    const candidatos = await this.prisma.syncOutbox.findMany({
      where: { organizationId, deliveredAt: null, deadLettered: false },
      orderBy: { seq: 'asc' },
      take: limit * SCAN_WINDOW_FACTOR,
    });

    const entidadesVistas = new Set<string>();
    const entregables: typeof candidatos = [];

    for (const row of candidatos) {
      const entidad = `${row.entityType}:${row.entityId}`;
      // Ya hay un evento de esta entidad en el lote, o el primero de la
      // entidad está esperando su backoff: en ambos casos los siguientes
      // esperan su turno, o se rompería el orden.
      if (entidadesVistas.has(entidad)) continue;
      entidadesVistas.add(entidad);

      if (row.nextAttemptAt && row.nextAttemptAt > ahora) continue;

      entregables.push(row);
      if (entregables.length >= limit) break;
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
      .map((r) => (filaDe(r).__old as Record<string, unknown> | undefined))
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
          in: [
            ...new Set(slots.flatMap((s) => [s.doctorId, s.serviceId])),
          ],
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

      if (slot) {
        context.startTimeIso = slot.startTime.toISOString();
        context.endTimeIso = slot.endTime.toISOString();

        const medico = claveExterna.get(`DOCTOR:${slot.doctorId}`);
        if (medico) context.doctorExternalKey = medico;
        else missing.push(`DOCTOR ${slot.doctorId}`);

        const servicio = claveExterna.get(`SERVICE:${slot.serviceId}`);
        if (servicio) context.serviceExternalKey = servicio;
        else missing.push(`SERVICE ${slot.serviceId}`);
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
          const medicoAnterior = claveExterna.get(`DOCTOR:${anterior.doctorId}`);
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
        if (paciente.dateOfBirth)
          context.patientBirthDateIso = paciente.dateOfBirth.toISOString();
        if (paciente.gender) context.patientGender = paciente.gender;
        if (paciente.regime) context.patientRegime = paciente.regime;
      } else {
        missing.push(`PATIENT ${String(fila.patientId)}`);
      }

      // La EPS es opcional (una cita particular no tiene): su ausencia no
      // rompe nada, pero si la cita SÍ declara una y no la encontramos, eso sí.
      if (eps) {
        if (eps.nit) context.epsNit = eps.nit;
        context.epsName = eps.name;
      } else if (fila.epsId) {
        missing.push(`EPS ${String(fila.epsId)}`);
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
    const result = await this.prisma.syncOutbox.updateMany({
      where: { organizationId, seq: { in: seqs } },
      // `nextAttemptAt: null` limpia el backoff de un evento que había fallado
      // antes y ahora sí se aplicó: la fila queda entregada y limpia, sin una
      // marca de reintento futuro que ya no significa nada.
      data: { deliveredAt: new Date(), nextAttemptAt: null },
    });

    // Los que el agente reporta como fallidos NO se marcan delivered — quedan
    // pendientes para el próximo pull hasta agotar reintentos (ver plan §6,
    // capa 4: dead-letter con alerta, nunca descarte silencioso).
    for (const seq of input.failedSeqs ?? []) {
      await this.markAttemptFailed(organizationId, seq);
    }

    for (const seq of input.skippedSeqs ?? []) {
      await this.markSkipped(organizationId, seq);
    }

    return { acknowledged: result.count };
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
        direction: 'AGENIA_TO_HIS',
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
  async markAttemptFailed(organizationId: string, seq: string): Promise<void> {
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
      data: { lastHeartbeatAt: new Date() },
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
