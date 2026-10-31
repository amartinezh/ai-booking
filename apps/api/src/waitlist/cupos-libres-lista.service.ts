import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { minutoLocal } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { getErrorMessage } from '../common/error-message.util';
import {
  HORARIO_OFERTA_CON_PLANTILLA,
  WaitlistService,
} from './waitlist.service';

/**
 * 🔔 La lista de espera recibe primero los cupos libres (2026-10-31).
 *
 * Antes solo recibía los cupos que alguien cancelaba. Cuando el hospital abría
 * agenda nueva, o cuando un día entraba al plazo para agendar, nadie de la lista
 * se enteraba: el 31-oct había 20 personas esperando (18 anotadas el viernes, a
 * las que se les dijo «escríbanos desde el sábado») y esa mañana 10 personas
 * nuevas tomaron por el chat los cupos del martes sin que a ninguna de la lista se
 * le ofreciera uno.
 *
 * Cada 2 minutos, de día (el mismo horario de la plantilla «Oferta de cupo»: nadie
 * recibe una oferta de madrugada), mira los cupos libres que el asistente podría
 * ofrecer por el chat —las mismas reglas: médico que agenda por el asistente,
 * anticipación mínima, días sin citas, plazo máximo— y se los ofrece, uno por
 * persona, al primero de la lista que pueda tomarlo (`notifyWaitlist`). El cupo
 * ofrecido queda apartado mientras la persona responde: el chat no lo muestra.
 * Antes saca de la lista a quien ya consiguió cita por otro camino.
 */

/** Ofertas que no salen seguidas antes de dejar el servicio para el siguiente barrido. */
const MAX_FALLOS_SEGUIDOS = 3;

@Injectable()
export class CuposLibresListaService {
  private readonly logger = new Logger(CuposLibresListaService.name);
  /** Un barrido a la vez. */
  private barriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    private readonly waitlist: WaitlistService,
  ) {}

  @Cron('35 */2 * * * *')
  async cadaDosMinutos(): Promise<void> {
    await this.ofrecerCuposLibres();
  }

  /** Cuántos cupos se ofrecieron. Nunca lanza. */
  async ofrecerCuposLibres(ahora = new Date()): Promise<number> {
    if (this.barriendo) return 0;
    this.barriendo = true;
    try {
      const grupos = await this.prisma.waitlistEntry.groupBy({
        by: ['organizationId', 'serviceId'],
        where: { status: 'WAITING' },
      });
      let ofrecidos = 0;
      for (const g of grupos) {
        try {
          ofrecidos += await this.ofrecerEnElServicio(
            g.organizationId,
            g.serviceId,
            ahora,
          );
        } catch (error: unknown) {
          this.logger.error(
            `Lista de espera: no se pudieron ofrecer los cupos libres del servicio ${g.serviceId} (org ${g.organizationId}): ${getErrorMessage(error)}`,
          );
        }
      }
      return ofrecidos;
    } catch (error: unknown) {
      this.logger.error(
        `Lista de espera: falló el barrido de cupos libres: ${getErrorMessage(error)}`,
      );
      return 0;
    } finally {
      this.barriendo = false;
    }
  }

  private async ofrecerEnElServicio(
    organizationId: string,
    serviceId: string,
    ahora: Date,
  ): Promise<number> {
    const [org, servicio] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          timezone: true,
          settings: { select: { bookingEnabled: true } },
        },
      }),
      this.prisma.medicalService.findFirst({
        where: { id: serviceId, organizationId },
        select: { name: true, isActive: true },
      }),
    ]);
    if (!org || !servicio?.isActive) return 0;
    // Con «Agendar citas» apagado el SÍ sería una cita del asistente.
    if (org.settings?.bookingEnabled === false) return 0;
    const minuto = minutoLocal(ahora, org.timezone || undefined);
    if (
      minuto < HORARIO_OFERTA_CON_PLANTILLA.desdeHora * 60 ||
      minuto >= HORARIO_OFERTA_CON_PLANTILLA.hastaHora * 60
    ) {
      return 0;
    }

    await this.waitlist.cerrarLosQueYaTienenCita(organizationId, serviceId);
    const epsDeLaLista = await this.prisma.waitlistEntry.findMany({
      where: { organizationId, serviceId, status: 'WAITING' },
      select: { epsId: true },
      distinct: ['epsId'],
    });
    if (epsDeLaLista.length === 0) return 0;

    // Los cupos que el chat le ofrecería a cada EPS de la lista.
    const ids = new Set<string>();
    for (const { epsId } of epsDeLaLista) {
      const cupos = await this.appointments.getAvailableSlots(
        servicio.name,
        epsId,
        organizationId,
        null,
        { todos: true },
      );
      for (const c of cupos) ids.add(c.slotId);
    }
    if (ids.size === 0) return 0;

    const cupos = await this.prisma.scheduleSlot.findMany({
      where: {
        id: { in: [...ids] },
        organizationId,
        serviceId,
        isAvailable: true,
      },
      include: { doctor: true },
      orderBy: { startTime: 'asc' },
    });

    let ofrecidos = 0;
    let fallosSeguidos = 0;
    for (const cupo of cupos) {
      const quedan = await this.prisma.waitlistEntry.count({
        where: { organizationId, serviceId, status: 'WAITING' },
      });
      if (quedan === 0) break;
      const ofrecido = await this.waitlist.notifyWaitlist({
        slotId: cupo.id,
        serviceId: cupo.serviceId,
        epsId: cupo.allowedEpsId,
        organizationId,
        doctorName: cupo.doctor.fullName,
        slotDate: cupo.startTime,
      });
      if (ofrecido) {
        ofrecidos++;
        fallosSeguidos = 0;
      } else if (++fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
        break;
      }
    }
    if (ofrecidos > 0) {
      this.logger.log(
        `Lista de espera: ${ofrecidos} cupo(s) libre(s) ofrecido(s) en el servicio ${serviceId} (org ${organizationId})`,
      );
    }
    return ofrecidos;
  }
}
