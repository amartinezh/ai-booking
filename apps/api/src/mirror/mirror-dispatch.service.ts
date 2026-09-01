import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AckInput,
  AckResult,
  HandshakeInput,
  HandshakeResult,
  HeartbeatInput,
  OutboxEventDto,
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
        return rows.map((r) => ({
          seq: r.seq.toString(),
          eventId: r.eventId,
          entityType: r.entityType as OutboxEventDto['entityType'],
          entityId: r.entityId,
          op: r.op as OutboxEventDto['op'],
          payload: r.payload,
          createdAt: r.createdAt.toISOString(),
        }));
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

    return { acknowledged: result.count };
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
  }
}
