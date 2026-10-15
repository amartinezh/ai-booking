import { Injectable, Logger } from '@nestjs/common';
import { compuertasHis, type CompuertasHis } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 🏥 H10 (docs/PLAN_AGENDA_HUECOS.md): el bot NO le dice al paciente «su cita
 * quedó» hasta que esté en AgenIA **y** en el HIS.
 *
 * Cómo se sabe, sin tocar el protocolo del agente:
 *   · El alta de la cita genera su evento INSERT en `SyncOutbox` (disparador).
 *   · El agente lo escribe en el HIS y lo confirma (ack) → `deliveredAt`.
 *   · Si el HIS la rechaza de forma definitiva (hora tomada o cruce, H11), la
 *     API anula la cita en AgenIA al recibir el ack (`MirrorDispatchService`),
 *     así que `status = CANCELLED` es la señal de rechazo.
 *
 *   CONFIRMADA → la cita sigue viva y su INSERT está entregado.
 *   RECHAZADA  → la cita se anuló (o desapareció).
 *   PENDIENTE  → ninguna de las dos todavía (o el evento cayó en dead-letter:
 *                no se confirma; la bandeja de excepciones avisa al personal).
 *
 * Una clínica SIN espejo no espera nada: su cita vive solo en AgenIA.
 *
 * El CAMBIO de fecha espera igual (ver «CAMBIO DE FECHA» abajo): antes el bot
 * lo confirmaba al moverlo en AgenIA, y si el HIS lo rechazaba el paciente
 * quedaba con la fecha nueva en AgenIA y la vieja en el hospital.
 *
 * Y la CANCELACIÓN también (2026-10-15, ver «CANCELACIÓN» abajo): antes el bot
 * decía «cancelada» al marcarla en AgenIA, antes de que el hospital la borrara.
 */
export type EstadoConfirmacionHis = 'CONFIRMADA' | 'RECHAZADA' | 'PENDIENTE';

/**
 * Qué se espera del HIS: el ALTA de una cita nueva o el CAMBIO de fecha de una
 * existente. Las pendientes guardadas antes de existir el cambio no traen
 * `tipo`: son altas.
 */
export type TipoConfirmacionHis = 'ALTA' | 'CAMBIO' | 'CANCELACION';

/** Lo que hace falta para escribirle al paciente cuando llegue el resultado. */
export interface ConfirmacionPendiente {
  organizationId: string;
  senderId: string;
  appointmentId: string;
  /** Fecha ya formateada para el paciente (la misma del resumen). En un CAMBIO, la nueva. */
  fechaTexto: string;
  /** Cuándo se registró, ISO. */
  desde: string;
  tipo?: TipoConfirmacionHis;
  /** CAMBIO / CANCELACION: su evento en la cola hacia el HIS (`SyncOutbox.seq`). */
  seq?: string;
  /** CAMBIO: el cupo al que se movió la cita. */
  cupoNuevoId?: string;
  /**
   * CAMBIO: el cupo de antes, reservado hasta que el HIS confirme.
   * CANCELACION: el cupo de la cita cancelada, que se libera al confirmarse.
   */
  cupoAnteriorId?: string;
  /** CAMBIO: la fecha de antes, formateada (la que conserva si el HIS rechaza). */
  fechaAnteriorTexto?: string;
}

/**
 * Resultado de un CAMBIO de fecha: los tres del alta, más ANULADA (la cita
 * se canceló mientras tanto; no hay cambio que confirmar ni que rechazar).
 */
export type EstadoCambioHis = EstadoConfirmacionHis | 'ANULADA';

/**
 * Resultado de una CANCELACIÓN:
 *   CONFIRMADA  → el hospital la borró (o ya no la tenía).
 *   NO_APLICADA → en el hospital esa hora es de OTRO paciente: no se borró nada
 *                 (`MirrorDispatchService.cerrarCancelacionNoAplicada`).
 *   PENDIENTE   → nada de lo anterior todavía.
 */
export type EstadoCancelacionHis = 'CONFIRMADA' | 'NO_APLICADA' | 'PENDIENTE';

/** Tope de la espera en línea antes de decirle que se le escribe después. */
export const ESPERA_CONFIRMACION_HIS_MS = 25_000;
const INTERVALO_SONDEO_MS = 1_000;
/** Una confirmación que no llega en 24 h se abandona (la bandeja ya avisó). */
export const ABANDONO_CONFIRMACION_HIS_MS = 24 * 60 * 60_000;
const CLAVE_PENDIENTES = 'confirmacion_his:pendientes';

@Injectable()
export class ConfirmacionHisService {
  private readonly logger = new Logger(ConfirmacionHisService.name);
  /** Sobrescribible en pruebas para no esperar segundos reales. */
  intervaloSondeoMs = INTERVALO_SONDEO_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** ¿Las citas de esta clínica viajan al HIS? Solo entonces hay que esperar. */
  async requiereConfirmacion(organizationId: string): Promise<boolean> {
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { enabled: true },
    });
    return config?.enabled === true;
  }

  /**
   * 🚪 Qué puede llegar al HIS en esta clínica, operación por operación
   * (`compuerta-his.ts`). `null` = sin espejo: todo vive solo en AgenIA y no hay
   * compuerta que mirar.
   */
  async compuertas(organizationId: string): Promise<CompuertasHis | null> {
    const [config, ajustes] = await Promise.all([
      this.prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { enabled: true, pushEnabled: true },
      }),
      this.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { cancelEnabled: true, rescheduleEnabled: true },
      }),
    ]);
    if (!config?.enabled) return null;
    return compuertasHis(config, ajustes);
  }

  /**
   * ¿El bot puede agendar? Con espejo, solo si el envío al hospital está
   * encendido: con `pushEnabled` apagado la cita nunca llegaría al HIS y el bot
   * nunca podría confirmarla (H10). Sin espejo, sí.
   */
  async puedeAgendar(organizationId: string): Promise<boolean> {
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { enabled: true, pushEnabled: true },
    });
    if (!config?.enabled) return true;
    return config.pushEnabled === true;
  }

  async estado(
    organizationId: string,
    appointmentId: string,
  ): Promise<EstadoConfirmacionHis> {
    const cita = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: { status: true },
    });
    if (!cita || cita.status === 'CANCELLED') return 'RECHAZADA';

    const evento = await this.prisma.syncOutbox.findFirst({
      where: {
        organizationId,
        entityType: 'APPOINTMENT',
        entityId: appointmentId,
        op: 'INSERT',
        origin: { not: 'MIRROR' },
      },
      orderBy: { seq: 'desc' },
      select: { deliveredAt: true },
    });
    return evento?.deliveredAt ? 'CONFIRMADA' : 'PENDIENTE';
  }

  /** Espera el resultado hasta `timeoutMs`; si no llega, PENDIENTE. */
  async esperar(
    organizationId: string,
    appointmentId: string,
    timeoutMs = ESPERA_CONFIRMACION_HIS_MS,
  ): Promise<EstadoConfirmacionHis> {
    return this.sondear(
      () => this.estado(organizationId, appointmentId),
      timeoutMs,
    );
  }

  // ── CAMBIO DE FECHA ────────────────────────────────────────────────────
  //
  // Cómo se sabe, igual que el alta y sin tocar el protocolo del agente:
  //   · Mover la cita (`scheduleSlotId`) genera su evento UPDATE en la cola.
  //   · El agente anula la vieja y crea la nueva en el HIS, en UNA transacción,
  //     y lo confirma (ack) → `deliveredAt`.
  //   · Si el HIS lo rechaza de forma definitiva (la hora nueva ya está tomada
  //     o se cruza, H11), la API DEVUELVE la cita a su cupo anterior al recibir
  //     el ack (`MirrorDispatchService.markRejectedByHis`).
  //
  //   CONFIRMADA → la cita sigue en el cupo nuevo y su evento está entregado.
  //   RECHAZADA  → la cita volvió a otro cupo (el anterior).
  //   ANULADA    → la cita se canceló entre tanto (o desapareció).
  //   PENDIENTE  → nada de lo anterior todavía.

  /**
   * El evento del cambio que se acaba de hacer: el último UPDATE de la cita
   * que va hacia el HIS (no los nacidos en él). Se lee justo después de mover
   * la cita, para seguir ESE evento y no otro posterior.
   */
  async eventoDelCambio(
    organizationId: string,
    appointmentId: string,
  ): Promise<string | null> {
    const evento = await this.prisma.syncOutbox.findFirst({
      where: {
        organizationId,
        entityType: 'APPOINTMENT',
        entityId: appointmentId,
        op: 'UPDATE',
        origin: { not: 'MIRROR' },
      },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return evento ? evento.seq.toString() : null;
  }

  /**
   * `seq` ausente: no se encontró el evento del cambio en la cola (no debería
   * pasar con el espejo encendido). Sin él no hay cómo saber que llegó al HIS:
   * nunca se da por CONFIRMADA; solo se detecta si se revirtió o se anuló.
   */
  async estadoCambio(
    organizationId: string,
    appointmentId: string,
    seq: string | undefined,
    cupoNuevoId: string,
  ): Promise<EstadoCambioHis> {
    const cita = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: { status: true, scheduleSlotId: true },
    });
    if (!cita || cita.status === 'CANCELLED') return 'ANULADA';
    if (cita.scheduleSlotId !== cupoNuevoId) return 'RECHAZADA';
    if (!seq) return 'PENDIENTE';

    const evento = await this.prisma.syncOutbox.findFirst({
      where: { organizationId, seq: BigInt(seq) },
      select: { deliveredAt: true },
    });
    return evento?.deliveredAt ? 'CONFIRMADA' : 'PENDIENTE';
  }

  /** Espera el resultado del cambio hasta `timeoutMs`; si no llega, PENDIENTE. */
  async esperarCambio(
    organizationId: string,
    appointmentId: string,
    seq: string | undefined,
    cupoNuevoId: string,
    timeoutMs = ESPERA_CONFIRMACION_HIS_MS,
  ): Promise<EstadoCambioHis> {
    return this.sondear(
      () => this.estadoCambio(organizationId, appointmentId, seq, cupoNuevoId),
      timeoutMs,
    );
  }

  // ── CANCELACIÓN ────────────────────────────────────────────────────────
  //
  // Igual que el cambio: cancelar genera su UPDATE (estado CANCELLED) en la cola;
  // el agente borra la cita en el HIS y lo confirma (ack) → `deliveredAt`. Si en
  // el hospital esa hora es de otro paciente, el agente no borra nada y la API
  // deja la marca `cancelacionNoAplicadaEnElHis` en la cita. Su evento se lee con
  // `eventoDelCambio` (es el último UPDATE de la cita).

  async estadoCancelacion(
    organizationId: string,
    appointmentId: string,
    seq: string | undefined,
  ): Promise<EstadoCancelacionHis> {
    const cita = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: { metaLog: true },
    });
    const meta =
      cita?.metaLog &&
      typeof cita.metaLog === 'object' &&
      !Array.isArray(cita.metaLog)
        ? (cita.metaLog as Record<string, unknown>)
        : {};
    if (meta.cancelacionNoAplicadaEnElHis) return 'NO_APLICADA';
    if (!seq) return 'PENDIENTE';
    const evento = await this.prisma.syncOutbox.findFirst({
      where: { organizationId, seq: BigInt(seq) },
      select: { deliveredAt: true },
    });
    return evento?.deliveredAt ? 'CONFIRMADA' : 'PENDIENTE';
  }

  /** Espera el resultado de la cancelación hasta `timeoutMs`; si no llega, PENDIENTE. */
  async esperarCancelacion(
    organizationId: string,
    appointmentId: string,
    seq: string | undefined,
    timeoutMs = ESPERA_CONFIRMACION_HIS_MS,
  ): Promise<EstadoCancelacionHis> {
    return this.sondear(
      () => this.estadoCancelacion(organizationId, appointmentId, seq),
      timeoutMs,
    );
  }

  /**
   * El HIS confirmó el cambio (o la cancelación): el cupo de antes, que se
   * mantuvo reservado mientras tanto, queda libre. Con origen MIRROR (el hospital
   * ya lo liberó al anular la cita: no hay nada que mandarle). Solo si nadie tiene
   * una cita viva ahí. Devuelve si se liberó.
   */
  async liberarCupoAnterior(
    organizationId: string,
    cupoId: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
      return tx.scheduleSlot.updateMany({
        where: {
          id: cupoId,
          organizationId,
          appointments: { none: { status: { not: 'CANCELLED' } } },
        },
        data: { isAvailable: true },
      });
    });
    return count > 0;
  }

  private async sondear<E extends string>(
    consultar: () => Promise<E>,
    timeoutMs: number,
  ): Promise<E> {
    const limite = Date.now() + timeoutMs;
    for (;;) {
      const estado = await consultar();
      if (estado !== 'PENDIENTE' || Date.now() >= limite) return estado;
      await new Promise((r) => setTimeout(r, this.intervaloSondeoMs));
    }
  }

  async registrarPendiente(p: ConfirmacionPendiente): Promise<void> {
    await this.redis.hset(CLAVE_PENDIENTES, campoDe(p), JSON.stringify(p));
  }

  async pendientes(): Promise<ConfirmacionPendiente[]> {
    const todo = await this.redis.hgetall(CLAVE_PENDIENTES);
    const lista: ConfirmacionPendiente[] = [];
    for (const [campo, valor] of Object.entries(todo ?? {})) {
      try {
        lista.push(JSON.parse(valor) as ConfirmacionPendiente);
      } catch (error: unknown) {
        this.logger.warn(
          `Confirmación pendiente ilegible (${campo}): ${getErrorMessage(error)}. Se descarta.`,
        );
        await this.redis.hdel(CLAVE_PENDIENTES, campo);
      }
    }
    return lista;
  }

  /**
   * Toma una pendiente para atenderla. Compare-and-set: con varias réplicas de
   * la API, solo la que la borra primero le escribe al paciente.
   */
  async reclamar(p: ConfirmacionPendiente): Promise<boolean> {
    const borradas = await this.redis.hdel(CLAVE_PENDIENTES, campoDe(p));
    return borradas === 1;
  }
}

/**
 * Campo de la pendiente en el hash. Un alta y un cambio de la MISMA cita no se
 * pisan; el alta conserva el formato de antes (las ya guardadas siguen valiendo).
 */
const campoDe = (p: ConfirmacionPendiente): string =>
  `${p.organizationId}|${p.appointmentId}` +
  (p.tipo === 'CAMBIO' || p.tipo === 'CANCELACION' ? `|${p.tipo}` : '');
