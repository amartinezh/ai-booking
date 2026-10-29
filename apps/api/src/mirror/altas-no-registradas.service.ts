import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  TITULO_EXCEPCION,
  claveExcepcion,
  compuertasHis,
  severidadPorCercania,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 🏥 Citas del chat que el hospital no registró (2026-10-29).
 *
 * El 29-oct una paciente agendó por WhatsApp a las 8:37 para el día siguiente; el
 * hospital no la registró (el médico se quedó sin turno), el envío se rindió tras
 * diez intentos y AgenIA la siguió teniendo vigente. A ella solo le llegó «su cita
 * está en proceso»: a las 24 horas el bot dejaba de esperar sin escribirle nada,
 * y su cita era antes. Habría ido al hospital para nada.
 *
 * Cada minuto, para cada clínica con espejo, las ALTAS de citas del chat que:
 *   · se RINDIERON (dead-letter), o
 *   · siguen sin un solo intento a los `ESPERA_SIN_INTENTO_MS` y la cita es en
 *     menos de `HORAS_CERCA` (el agente del hospital no las está tomando),
 * se tratan como un rechazo del hospital (`markRejectedByHis`, con la marca
 * `noLlego`): la cita se anula en AgenIA, su cupo se cierra y el envío se cierra
 * (ya no se reintenta: escribirla después en el hospital sería darle una cita que
 * AgenIA ya anuló). El bot ve la cita anulada y le dice al paciente que no quedó
 * registrada (`citaNoQuedoRegistrada`). El caso «Cita que el hospital aún no tiene»
 * queda ABIERTO, con la nota, por si el personal prefiere registrarla a mano.
 *
 * Solo las del chat (WhatsApp y Telegram): son las que recibieron «en proceso».
 * Las del panel las agendó una persona del hospital, que ya ve el caso. Nada de
 * esto escribe en el hospital.
 */

/** Sin un solo intento en este tiempo, el agente no está tomando la cola. */
export const ESPERA_SIN_INTENTO_MS = 30 * 60_000;
/** Solo se da por perdida sin intento si a la cita le falta menos que esto. */
export const HORAS_CERCA = 24;
/** Envíos de hasta estos días atrás (lo más viejo ya lo vio el personal). */
const DIAS_ATRAS = 3;
const ORIGENES_DEL_CHAT = ['WHATSAPP', 'TELEGRAM'];
const ESTADOS_ACTIVOS = ['ABIERTA', 'EN_REVISION'];

@Injectable()
export class AltasNoRegistradasService {
  private readonly logger = new Logger(AltasNoRegistradasService.name);
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: MirrorDispatchService,
    private readonly exceptions: MirrorExceptionsService,
  ) {}

  @Cron('40 * * * * *')
  async cadaMinuto(): Promise<void> {
    // Sin parámetros: la librería de cron le pasa al método sus propios argumentos.
    await this.revisarTodas();
  }

  async revisarTodas(ahora: Date = new Date()): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const clinicas = await this.prisma.hospitalMirrorConfig.findMany({
        where: { enabled: true },
        select: { organizationId: true },
      });
      for (const { organizationId } of clinicas) {
        try {
          await this.revisar(organizationId, ahora);
        } catch (error: unknown) {
          this.logger.error(
            `Altas no registradas (org ${organizationId}): ${getErrorMessage(error)}`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Barrido de altas no registradas falló: ${getErrorMessage(error)}`,
      );
    } finally {
      this.enCurso = false;
    }
  }

  async revisar(
    organizationId: string,
    ahora: Date = new Date(),
  ): Promise<number> {
    const ajustes = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { bookingEnabled: true },
    });
    // «Agendar» apagado: lo que está en cola espera por decisión, no por falla.
    const agendarAbierto = compuertasHis(ajustes).agendar;

    const eventos = await this.prisma.syncOutbox.findMany({
      where: {
        organizationId,
        entityType: 'APPOINTMENT',
        op: 'INSERT',
        origin: { not: 'MIRROR' },
        deliveredAt: null,
        createdAt: { gte: new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000) },
        OR: [
          { deadLettered: true },
          ...(agendarAbierto
            ? [
                {
                  deadLettered: false,
                  attempts: 0,
                  createdAt: {
                    lte: new Date(ahora.getTime() - ESPERA_SIN_INTENTO_MS),
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        seq: true,
        entityId: true,
        attempts: true,
        deadLettered: true,
        lastError: true,
        createdAt: true,
      },
      orderBy: { seq: 'asc' },
      take: 50,
    });
    if (eventos.length === 0) return 0;

    const citas = await this.prisma.appointment.findMany({
      where: {
        organizationId,
        id: { in: eventos.map((e) => e.entityId) },
        status: 'SCHEDULED',
        origin: { in: ORIGENES_DEL_CHAT as never },
        scheduleSlot: { startTime: { gt: ahora } },
      },
      select: {
        id: true,
        patientId: true,
        epsId: true,
        scheduleSlot: { select: { startTime: true, doctorId: true } },
      },
    });
    const citaDe = new Map(citas.map((c) => [c.id, c]));

    let anuladas = 0;
    for (const e of eventos) {
      const cita = citaDe.get(e.entityId);
      if (!cita) continue;
      const inicio = cita.scheduleSlot.startTime;
      // Sin intento: solo si la cita está cerca (si no, aún hay tiempo).
      if (
        !e.deadLettered &&
        inicio.getTime() - ahora.getTime() > HORAS_CERCA * 3_600_000
      ) {
        continue;
      }
      const motivo = e.deadLettered
        ? `no llegó al sistema del hospital tras ${e.attempts} intentos` +
          (e.lastError ? ` (último error: ${e.lastError})` : '')
        : `el agente del hospital no la tomó en ${Math.round(
            (ahora.getTime() - e.createdAt.getTime()) / 60_000,
          )} minutos y la cita es en menos de ${HORAS_CERCA} horas`;

      const yaSeLeEscribio = await this.personalYaLeEscribio(
        organizationId,
        cita.id,
      );
      const hecho = await this.dispatch.markRejectedByHis(
        organizationId,
        String(e.seq),
        motivo,
        { noLlego: true, yaSeLeEscribio },
      );
      if (!hecho) continue;
      anuladas++;
      this.logger.warn(
        `Cita ${cita.id} (org ${organizationId}): ${motivo}. Se anuló en AgenIA; el bot le avisa al paciente.`,
      );
      await this.dejarElCaso(organizationId, cita, e, motivo, ahora);
    }
    return anuladas;
  }

  /** ¿Alguien del personal ya le escribió desde el caso de la Bandeja? */
  private async personalYaLeEscribio(
    organizationId: string,
    appointmentId: string,
  ): Promise<boolean> {
    const casos = await this.prisma.syncException.findMany({
      where: { organizationId, appointmentId, kind: 'CITA_NO_ENTREGADA' },
      select: { id: true },
    });
    if (casos.length === 0) return false;
    const escrito = await this.prisma.syncExceptionLog.findFirst({
      where: {
        exceptionId: { in: casos.map((c) => c.id) },
        action: 'MENSAJE_AL_PACIENTE',
      },
      select: { id: true },
    });
    return !!escrito;
  }

  /**
   * El caso «Cita que el hospital aún no tiene» queda ABIERTO y dice lo que pasó
   * (`meta.noRegistrada`: el vigilante ya no lo cierra solo). Si aún no existía, se
   * abre.
   */
  private async dejarElCaso(
    organizationId: string,
    cita: {
      id: string;
      patientId: string;
      epsId: string | null;
      scheduleSlot: { startTime: Date; doctorId: string };
    },
    e: { seq: bigint; attempts: number; deadLettered: boolean },
    motivo: string,
    ahora: Date,
  ): Promise<void> {
    const nota = `El hospital no registró la cita: ${motivo}. AgenIA la anuló y le avisa al paciente por el chat.`;
    const abiertos = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        appointmentId: cita.id,
        kind: 'CITA_NO_ENTREGADA',
        status: { in: ESTADOS_ACTIVOS },
      },
      select: { id: true, meta: true },
    });
    if (abiertos.length > 0) {
      for (const c of abiertos) {
        const meta =
          c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta)
            ? (c.meta as Record<string, unknown>)
            : {};
        await this.prisma.syncException.updateMany({
          where: { id: c.id, organizationId },
          data: {
            meta: {
              ...meta,
              noRegistrada: true,
              noRegistradaIso: ahora.toISOString(),
            },
          },
        });
        await this.exceptions.anotar(c.id, 'NO_REGISTRADA', null, null, nota);
      }
      return;
    }
    const minutos = Math.floor(
      (cita.scheduleSlot.startTime.getTime() - ahora.getTime()) / 60_000,
    );
    await this.exceptions.registrar(
      organizationId,
      {
        kind: 'CITA_NO_ENTREGADA',
        dedupeKey: claveExcepcion.citaNoEntregada(cita.id, e.seq),
        severity: severidadPorCercania('ALTA', minutos),
        title: TITULO_EXCEPCION.CITA_NO_ENTREGADA,
        detail: nota,
        appointmentId: cita.id,
        patientId: cita.patientId,
        entityType: 'APPOINTMENT',
        entityId: cita.id,
        outboxSeq: e.seq,
        epsId: cita.epsId,
        doctorId: cita.scheduleSlot.doctorId,
        appointmentStartAt: cita.scheduleSlot.startTime,
        meta: {
          motivo: e.deadLettered ? 'RENDIDA' : 'EN_COLA',
          intentos: e.attempts,
          noRegistrada: true,
          noRegistradaIso: ahora.toISOString(),
        },
      },
      ahora,
    );
  }
}
