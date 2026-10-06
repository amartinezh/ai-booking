import { Injectable, Logger } from '@nestjs/common';
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
 */
export type EstadoConfirmacionHis = 'CONFIRMADA' | 'RECHAZADA' | 'PENDIENTE';

/** Lo que hace falta para escribirle al paciente cuando llegue el resultado. */
export interface ConfirmacionPendiente {
  organizationId: string;
  senderId: string;
  appointmentId: string;
  /** Fecha ya formateada para el paciente (la misma del resumen). */
  fechaTexto: string;
  /** Cuándo se registró, ISO. */
  desde: string;
}

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
    const limite = Date.now() + timeoutMs;
    for (;;) {
      const estado = await this.estado(organizationId, appointmentId);
      if (estado !== 'PENDIENTE' || Date.now() >= limite) return estado;
      await new Promise((r) => setTimeout(r, this.intervaloSondeoMs));
    }
  }

  async registrarPendiente(p: ConfirmacionPendiente): Promise<void> {
    await this.redis.hset(
      CLAVE_PENDIENTES,
      `${p.organizationId}|${p.appointmentId}`,
      JSON.stringify(p),
    );
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
    const borradas = await this.redis.hdel(
      CLAVE_PENDIENTES,
      `${p.organizationId}|${p.appointmentId}`,
    );
    return borradas === 1;
  }
}
