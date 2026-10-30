import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  inicioMinimoParaOfrecer,
  isTelegramSender,
  minutoLocal,
} from '@agenia/shared';
import { Prisma } from '@agenia/database';
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

/**
 * Por dónde se le ofrece el cupo: TEXTO a quien escribió en las últimas 24 h (o
 * usa Telegram); PLANTILLA («Oferta de cupo», aprobada en Meta) a quien no.
 */
export type ViaOfertaCupo = 'TEXTO' | 'PLANTILLA';

/**
 * La plantilla solo de 7:00 a 19:00, hora de la clínica (2026-10-26). Quien no ha
 * escrito en 24 h recibe la oferta sin esperarla y tiene 30 minutos para responder:
 * de noche no alcanzaría, perdería el turno y el cupo saltaría al siguiente, también
 * de noche. Fuera de ese horario el cupo se le ofrece solo a quien escribió hace
 * poco; los demás conservan su lugar.
 */
export const HORARIO_OFERTA_CON_PLANTILLA = {
  desdeHora: 7,
  hastaHora: 19,
} as const;

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
    const { slotId, serviceId, epsId, organizationId, slotDate } = params;

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

    // 👨‍⚕️ Solo cupos que el asistente puede agendar: con el médico del cupo en
    // WhatsApp apagado, al «SÍ» la reserva se rechaza (DOCTOR_NOT_BOOKABLE). El
    // 2026-10-30: 8 de 14 ofertas en dos semanas fueron del médico comodín del
    // hospital, con WhatsApp apagado; ninguna terminó en cita. La regla es la misma
    // de `AppointmentsService.bookAppointment`.
    const cupo = await this.prisma.scheduleSlot.findFirst({
      where: { id: slotId, organizationId },
      select: { doctor: { select: { whatsappBookingEnabled: true } } },
    });
    if (!cupo?.doctor?.whatsappBookingEnabled) {
      this.logger.log(
        `El cupo ${slotId} es de un médico que no agenda por el asistente: no se ofrece a la lista de espera`,
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
    // escribir ahora: con texto si escribió en las últimas 24 h (o usa Telegram),
    // con la plantilla «Oferta de cupo» si no. Al que no se le puede escribir no
    // se le gasta el turno: sigue esperando. Si el mensaje no sale, tampoco.
    const saltados: string[] = [];
    // La plantilla se mira una sola vez por cupo, y solo si hace falta.
    let plantilla: boolean | null = null;
    for (let i = 0; i < MAX_CANDIDATOS; i++) {
      const candidate = await this.prisma.waitlistEntry.findFirst({
        where: {
          serviceId,
          organizationId,
          status: 'WAITING',
          ...quienesPuedenTomarElCupo(epsId),
          ...(saltados.length > 0 ? { id: { notIn: saltados } } : {}),
        },
        include: { patient: true, service: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) break;

      let via: ViaOfertaCupo | null = null;
      if (
        await this.puedeEscribirleTexto(organizationId, candidate.whatsappId)
      ) {
        via = 'TEXTO';
      } else {
        if (plantilla === null) {
          plantilla = await this.plantillaDisponible(
            organizationId,
            new Date(),
          );
        }
        if (plantilla) via = 'PLANTILLA';
      }
      if (via && (await this.ofrecerCupo(candidate, via, params))) return;
      saltados.push(candidate.id);
    }

    this.logger.log(
      saltados.length > 0
        ? `A ninguno de los ${saltados.length} en la lista de espera de ${serviceId} se le pudo escribir: el cupo ${slotId} queda en la agenda`
        : `No hay candidatos en waitlist para servicio ${serviceId}`,
    );
  }

  /**
   * Le ofrece el cupo: lo marca NOTIFIED (antes de escribirle, para que un SÍ
   * rápido lo encuentre) y le escribe. Si el mensaje no sale, vuelve a WAITING
   * con su turno: false, y el cupo pasa al siguiente.
   */
  private async ofrecerCupo(
    candidate: {
      id: string;
      whatsappId: string;
      patient: { fullName: string };
      service: { name: string };
    },
    via: ViaOfertaCupo,
    cupo: {
      slotId: string;
      epsId: string | null;
      organizationId: string;
      doctorName: string;
      slotDate: Date;
    },
  ): Promise<boolean> {
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
          pendingSlotId: cupo.slotId,
          doctorName: cupo.doctorName,
          slotDate: cupo.slotDate.toISOString(),
          epsDelCupo: cupo.epsId,
        },
      },
    });

    // Delegar el envío del mensaje al ChatbotService (mantiene consistencia de tono)
    const enviado = await this.chatbotService.notifyWaitlistCandidate({
      whatsappId: candidate.whatsappId,
      organizationId: cupo.organizationId,
      nombre: candidate.patient.fullName,
      especialidad: candidate.service.name,
      doctor: cupo.doctorName,
      slotDate: cupo.slotDate,
      slotId: cupo.slotId,
      via,
    });

    if (!enviado) {
      await this.prisma.waitlistEntry.update({
        where: { id: candidate.id },
        data: {
          status: 'WAITING',
          notifiedAt: null,
          expiresAt: null,
          metadata: Prisma.DbNull,
        },
      });
      this.logger.warn(
        `La oferta del cupo ${cupo.slotId} no le salió a ${candidate.patient.fullName} (${via}): sigue esperando con su turno`,
      );
      return false;
    }

    this.logger.log(
      `Notificación enviada a ${candidate.patient.fullName} (${via})`,
    );
    return true;
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

  /**
   * 🔁 Dijo SÍ al cupo ofrecido, pero ya no se pudo tomar (otro lo tomó, el médico
   * no agenda por el asistente o el hospital no lo registró): vuelve a la lista en
   * su mismo puesto (2026-10-30: quedaba CONFIRMED y, al anotarse otra vez, pasaba
   * del primero al noveno). El puesto lo da `createdAt`, que no se toca. Solo la
   * entrada de ESE cupo. `true` si volvió.
   */
  async volverAEsperar(params: {
    whatsappId: string;
    organizationId: string;
    slotId: string;
  }): Promise<boolean> {
    const { whatsappId, organizationId, slotId } = params;
    const { count } = await this.prisma.waitlistEntry.updateMany({
      where: {
        whatsappId,
        organizationId,
        status: 'CONFIRMED',
        metadata: { path: ['pendingSlotId'], equals: slotId },
      },
      data: {
        status: 'WAITING',
        notifiedAt: null,
        expiresAt: null,
        metadata: Prisma.DbNull,
      },
    });
    if (count > 0) {
      this.logger.log(
        `El cupo ${slotId} de la lista de espera no se pudo tomar: ${whatsappId} vuelve a esperar con su turno`,
      );
    }
    return count > 0;
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
      // Solo si el texto le llega: a quien se le ofreció con la plantilla y no
      // respondió, WhatsApp no deja escribirle (sería un envío rechazado).
      if (
        await this.puedeEscribirleTexto(entry.organizationId, entry.whatsappId)
      ) {
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
      } else {
        this.logger.log(
          `No se le avisa a ${entry.whatsappId} que el cupo expiró: no ha escrito en las últimas 24 h`,
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
   * ¿Le llega un texto libre? Telegram no tiene ventana; WhatsApp solo acepta
   * texto libre hasta 24 h después del último mensaje del paciente.
   */
  private async puedeEscribirleTexto(
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
   * ¿Se puede ofrecer el cupo con la plantilla «Oferta de cupo»? Si la clínica la
   * tiene registrada y activa, y es de día en la clínica
   * (`HORARIO_OFERTA_CON_PLANTILLA`).
   */
  private async plantillaDisponible(
    organizationId: string,
    ahora: Date,
  ): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const minuto = minutoLocal(ahora, org?.timezone || undefined);
    if (
      minuto < HORARIO_OFERTA_CON_PLANTILLA.desdeHora * 60 ||
      minuto >= HORARIO_OFERTA_CON_PLANTILLA.hastaHora * 60
    ) {
      return false;
    }
    return this.chatbotService.ofertaDeCupoConPlantilla(organizationId);
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
