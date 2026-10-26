import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { inicioMinimoParaOfrecer, isTelegramSender } from '@agenia/shared';
import type { Prisma } from '@agenia/database';
import { cupoBloqueadoParaElAsistente } from '../appointments/bloqueos-agenda';
import { fueraDelPlazoParaElAsistente } from '../appointments/plazo-agendar';
import { ConfigService } from '@nestjs/config';
import { ChatbotService } from '../chatbot/chatbot.service';

/**
 * Lo que `notifyWaitlist` guarda en `WaitlistEntry.metadata` (columna `Json`)
 * al ofrecerle el cupo a un candidato. Se lee de vuelta en
 * `confirmFromWaitlist` y `expireStaleNotifications` para saber qué cupo
 * confirmar o a quién ofrecérselo después.
 */
interface WaitlistNotificationMetadata {
  pendingSlotId?: string;
  doctorName?: string;
  /** ISO 8601 — se reconstruye con `new Date(...)` al leerlo. */
  slotDate?: string;
  /**
   * La EPS del CUPO (null = cupo para cualquier EPS). Al reofrecerlo tras un NO o
   * un vencimiento se busca con esta, no con la del paciente que lo rechazó.
   */
  epsDelCupo?: string | null;
}

/** `WaitlistEntry.metadata` es `Prisma.JsonValue`; esto valida la forma antes de usarla. */
function readWaitlistMetadata(metadata: unknown): WaitlistNotificationMetadata {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as WaitlistNotificationMetadata)
    : {};
}

/**
 * Quién de la lista puede recibir un cupo de esta EPS (2026-10-26).
 *
 *   · Cupo para cualquier EPS (`null`): cualquiera de la lista. Antes solo los que
 *     entraron sin EPS, y el asistente siempre anota la EPS: en Anserma, donde todos
 *     los cupos son para cualquier EPS, la lista de espera nunca le avisó a nadie.
 *   · Cupo de una EPS: los de esa EPS y los particulares, como siempre.
 */
function quienesPuedenTomarElCupo(
  epsDelCupo: string | null,
): Prisma.WaitlistEntryWhereInput {
  return epsDelCupo ? { OR: [{ epsId: null }, { epsId: epsDelCupo }] } : {};
}

/** Cuántos de la lista se miran por cupo antes de dejarlo en la agenda. */
const MAX_CANDIDATOS = 20;

/** La EPS del cupo guardada al ofrecerlo; las ofertas de antes no la tienen. */
const epsDelCupoGuardada = (
  metadata: WaitlistNotificationMetadata,
  epsDelPaciente: string | null,
): string | null =>
  metadata.epsDelCupo !== undefined ? metadata.epsDelCupo : epsDelPaciente;

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);
  private readonly CONFIRMATION_TTL_MINUTES = 30;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(forwardRef(() => ChatbotService))
    private chatbotService: ChatbotService,
  ) {}

  // ════════════════════════════════════════════════════════════
  // 1. UNIRSE A LA LISTA DE ESPERA
  // ════════════════════════════════════════════════════════════
  async joinWaitlist(params: {
    patientId: string;
    serviceId: string;
    epsId: string | null;
    whatsappId: string;
    organizationId: string;
    preferredDoctorId?: string | null;
  }): Promise<{ success: boolean; position: number; id: string }> {
    const {
      patientId,
      serviceId,
      epsId,
      whatsappId,
      organizationId,
      preferredDoctorId = null,
    } = params;

    // Evitar duplicados: si ya está esperando lo mismo, devolver su posición actual
    const existing = await this.prisma.waitlistEntry.findFirst({
      where: { patientId, serviceId, organizationId, status: 'WAITING' },
    });

    if (existing) {
      const position = await this.getPosition(
        existing.id,
        serviceId,
        organizationId,
      );
      return { success: true, position, id: existing.id };
    }

    const entry = await this.prisma.waitlistEntry.create({
      data: {
        patientId,
        serviceId,
        epsId,
        whatsappId,
        organizationId,
        preferredDoctorId,
      },
    });

    const position = await this.getPosition(
      entry.id,
      serviceId,
      organizationId,
    );
    this.logger.log(`Paciente ${patientId} en waitlist posición ${position}`);
    return { success: true, position, id: entry.id };
  }

  // ════════════════════════════════════════════════════════════
  // 2. NOTIFICAR CUANDO UN SLOT SE LIBERA
  // ════════════════════════════════════════════════════════════
  async notifyWaitlist(params: {
    slotId: string;
    serviceId: string;
    epsId: string | null;
    organizationId: string;
    doctorName: string;
    slotDate: Date;
  }): Promise<void> {
    const { slotId, serviceId, epsId, organizationId, doctorName, slotDate } =
      params;

    // 🔒 Con las operaciones del bot apagadas (/dashboard/configuracion) no se
    // ofrece el cupo: el «SÍ» del paciente sería una cita agendada por el bot.
    // La cola queda intacta (nadie pasa a NOTIFIED) y se retoma al encenderlo.
    const settings = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { bookingEnabled: true },
    });
    if (settings?.bookingEnabled === false) {
      this.logger.log(
        `Operaciones del bot apagadas en ${organizationId}: no se ofrece el cupo ${slotId} a la lista de espera`,
      );
      return;
    }

    // ⏱️ Un cupo que empieza antes de la anticipación mínima no se ofrece: el
    // paciente no alcanzaría a llegar, y al reservar se rechazaría igual.
    if (slotDate < inicioMinimoParaOfrecer(new Date())) {
      this.logger.log(
        `El cupo ${slotId} empieza antes de la anticipación mínima: no se ofrece a la lista de espera`,
      );
      return;
    }

    // 📅 Un cupo de un día u hora sin citas por el asistente no se ofrece.
    if (
      await cupoBloqueadoParaElAsistente(this.prisma, organizationId, slotDate)
    ) {
      this.logger.log(
        `El cupo ${slotId} cae en un día u hora sin citas por el asistente: no se ofrece a la lista de espera`,
      );
      return;
    }

    // 🗓️ Ni un cupo más allá del plazo máximo para agendar: la cola espera a
    // que se libere uno dentro del plazo.
    if (
      await fueraDelPlazoParaElAsistente(this.prisma, organizationId, slotDate)
    ) {
      this.logger.log(
        `El cupo ${slotId} queda más allá del plazo máximo para agendar: no se ofrece a la lista de espera`,
      );
      return;
    }

    // El primero de la cola (FIFO) que puede tomar el cupo y a quien se le puede
    // escribir ahora. Al que no se le puede escribir (WhatsApp solo deja texto
    // libre hasta 24 h después de su último mensaje) no se le gasta el turno:
    // sigue esperando y se le ofrece el siguiente cupo si vuelve a escribir.
    const { candidate, saltados } = await this.primeroAQuienEscribirle(
      organizationId,
      serviceId,
      epsId,
    );

    if (!candidate) {
      this.logger.log(
        saltados.length > 0
          ? `Ninguno de los ${saltados.length} en la lista de espera de ${serviceId} escribió en las últimas 24 h: el cupo ${slotId} queda en la agenda`
          : `No hay candidatos en waitlist para servicio ${serviceId}`,
      );
      return;
    }

    const expiresAt = new Date(
      Date.now() + this.CONFIRMATION_TTL_MINUTES * 60 * 1000,
    );

    await this.prisma.waitlistEntry.update({
      where: { id: candidate.id },
      data: {
        status: 'NOTIFIED',
        notifiedAt: new Date(),
        expiresAt,
        metadata: {
          pendingSlotId: slotId,
          doctorName,
          slotDate: slotDate.toISOString(),
          epsDelCupo: epsId,
        },
      },
    });

    // Delegar el envío del mensaje al ChatbotService (mantiene consistencia de tono)
    await this.chatbotService.notifyWaitlistCandidate({
      whatsappId: candidate.whatsappId,
      organizationId,
      nombre: candidate.patient.fullName,
      especialidad: candidate.service.name,
      doctor: doctorName,
      slotDate,
    });

    this.logger.log(`Notificación enviada a ${candidate.patient.fullName}`);
  }

  // ════════════════════════════════════════════════════════════
  // 3. CONFIRMAR O RECHAZAR DESDE EL CHATBOT
  // ════════════════════════════════════════════════════════════
  async confirmFromWaitlist(params: {
    whatsappId: string;
    organizationId: string;
    confirmed: boolean;
  }): Promise<{
    slotId: string | null;
    patientId: string | null;
    /**
     * La EPS con la que el paciente ENTRÓ a la lista (null = particular). La cita se
     * reserva con esta, no con la de su ficha: quien está en el padrón de una EPS
     * puede pedir una cita particular, y la ficha solo guarda su EPS de siempre.
     */
    epsId: string | null;
  }> {
    const { whatsappId, organizationId, confirmed } = params;

    const entry = await this.prisma.waitlistEntry.findFirst({
      where: { whatsappId, organizationId, status: 'NOTIFIED' },
      include: { patient: true },
    });

    if (!entry) return { slotId: null, patientId: null, epsId: null };

    const metadata = readWaitlistMetadata(entry.metadata);
    const slotId = metadata.pendingSlotId ?? null;

    if (confirmed) {
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'CONFIRMED' },
      });
      return { slotId, patientId: entry.patientId, epsId: entry.epsId };
    }

    // Rechazó: marcar como cancelado y ofrecer al siguiente
    await this.prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: 'CANCELLED' },
    });

    if (slotId) {
      await this.notifyWaitlist({
        slotId,
        serviceId: entry.serviceId,
        epsId: epsDelCupoGuardada(metadata, entry.epsId),
        organizationId,
        doctorName: metadata.doctorName ?? '',
        slotDate: metadata.slotDate ? new Date(metadata.slotDate) : new Date(),
      });
    }

    return { slotId: null, patientId: null, epsId: null };
  }

  // ════════════════════════════════════════════════════════════
  // 4. CRON: EXPIRAR ENTRADAS SIN CONFIRMACIÓN (cada 5 min)
  // ════════════════════════════════════════════════════════════
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStaleNotifications(): Promise<void> {
    const expired = await this.prisma.waitlistEntry.findMany({
      where: {
        status: 'NOTIFIED',
        expiresAt: { lt: new Date() },
      },
      include: { patient: true },
    });

    for (const entry of expired) {
      this.logger.log(`Expirando waitlist de ${entry.patient.fullName}`);
      const metadata = readWaitlistMetadata(entry.metadata);

      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'EXPIRED' },
      });

      // Avisar al paciente que perdió el cupo — por la línea de SU clínica
      // (antes dependía del caché origin_org, que podía apuntar a otra org).
      try {
        await this.chatbotService.sendOutboundMessage(
          entry.whatsappId,
          `Lo sentimos, el tiempo para confirmar el cupo expiró. ⏰\n\nSi aún desea una cita, escríbame "Hola" y lo agregaremos nuevamente. 😊`,
          entry.organizationId,
        );
      } catch {
        this.logger.warn(
          `No se pudo notificar expiración a ${entry.whatsappId}`,
        );
      }

      // Ofrecer el slot al siguiente candidato
      if (metadata.pendingSlotId) {
        await this.notifyWaitlist({
          slotId: metadata.pendingSlotId,
          serviceId: entry.serviceId,
          epsId: epsDelCupoGuardada(metadata, entry.epsId),
          organizationId: entry.organizationId,
          doctorName: metadata.doctorName ?? '',
          slotDate: metadata.slotDate
            ? new Date(metadata.slotDate)
            : new Date(),
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════

  /**
   * El primero de la cola que puede tomar un cupo de esa EPS y a quien se le
   * puede escribir ahora; `saltados`, los de delante a quienes no.
   */
  private async primeroAQuienEscribirle(
    organizationId: string,
    serviceId: string,
    epsDelCupo: string | null,
  ) {
    const saltados: string[] = [];
    for (let i = 0; i < MAX_CANDIDATOS; i++) {
      const siguiente = await this.prisma.waitlistEntry.findFirst({
        where: {
          serviceId,
          organizationId,
          status: 'WAITING',
          ...quienesPuedenTomarElCupo(epsDelCupo),
          ...(saltados.length > 0 ? { id: { notIn: saltados } } : {}),
        },
        include: { patient: true, service: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!siguiente) break;
      if (await this.puedeEscribirle(organizationId, siguiente.whatsappId)) {
        return { candidate: siguiente, saltados };
      }
      saltados.push(siguiente.id);
    }
    return { candidate: null, saltados };
  }

  /**
   * ¿El mensaje con el cupo le llega? Telegram no tiene ventana; WhatsApp solo
   * acepta texto libre hasta 24 h después del último mensaje del paciente (y la
   * plantilla de oferta de cupo todavía no se envía). Ante la duda, no: un envío
   * que Meta rechaza le haría perder el turno sin enterarse.
   */
  private async puedeEscribirle(
    organizationId: string,
    whatsappId: string,
  ): Promise<boolean> {
    if (isTelegramSender(whatsappId)) return true;
    return this.chatbotService.isWithinServiceWindow(
      organizationId,
      whatsappId,
    );
  }

  /**
   * Cuántos esperan delante: los del mismo servicio que entraron antes. Con la
   * EPS no se filtra: un cupo para cualquier EPS (los de Anserma) se le ofrece
   * al primero de la cola, sea cual sea la suya.
   */
  private async getPosition(
    entryId: string,
    serviceId: string,
    organizationId: string,
  ): Promise<number> {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) return 1;

    const ahead = await this.prisma.waitlistEntry.count({
      where: {
        serviceId,
        organizationId,
        status: 'WAITING',
        id: { not: entryId },
        createdAt: { lt: entry.createdAt },
      },
    });
    return ahead + 1;
  }
}
