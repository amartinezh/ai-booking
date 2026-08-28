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
   * Long-poll: si ya hay eventos pendientes, responde de inmediato; si no,
   * espera hasta LONG_POLL_MS reintentando cada LONG_POLL_INTERVAL_MS antes
   * de responder con una lista vacía (el agente vuelve a preguntar).
   */
  async getPendingEvents(
    organizationId: string,
    cursorSeq: bigint,
    limit: number = DEFAULT_EVENTS_LIMIT,
  ): Promise<OutboxEventDto[]> {
    const deadline = Date.now() + this.longPollMs;

    while (true) {
      const rows = await this.prisma.syncOutbox.findMany({
        where: {
          organizationId,
          seq: { gt: cursorSeq },
          deliveredAt: null,
          deadLettered: false,
        },
        orderBy: { seq: 'asc' },
        take: limit,
      });

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

  async ack(organizationId: string, input: AckInput): Promise<AckResult> {
    const seqs = input.seqs.map((s) => BigInt(s));
    const result = await this.prisma.syncOutbox.updateMany({
      where: { organizationId, seq: { in: seqs } },
      data: { deliveredAt: new Date() },
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
   */
  async markAttemptFailed(organizationId: string, seq: string): Promise<void> {
    const row = await this.prisma.syncOutbox.update({
      where: { seq: BigInt(seq) },
      data: { attempts: { increment: 1 } },
    });

    if (row.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await this.prisma.syncOutbox.update({
        where: { seq: row.seq },
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
