import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CanonicalChangeEvent, ChangesResult } from './dto/mirror.types';

/**
 * Aplica al modelo de datos de AgenIA los eventos que un driver reportó desde
 * el HIS de su hospital. Deliberadamente **no sabe de qué driver vinieron**:
 * solo entiende el formato canónico de mirror.types.ts. Reutiliza la lógica
 * de negocio existente (bookAppointment, updateAttendance) en vez de escribir
 * filas a mano, para que las invariantes (slot 1:1 cita, aislamiento de
 * tenant, disponibilidad) se respeten igual que en el flujo de WhatsApp — ver
 * PLAN_ESPEJO_HOSPITAL.md §5.1c.
 */
@Injectable()
export class MirrorApplyService {
  private readonly logger = new Logger(MirrorApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async applyBatch(
    organizationId: string,
    events: CanonicalChangeEvent[],
  ): Promise<ChangesResult> {
    const result: ChangesResult = { applied: 0, skipped: 0, conflicts: 0 };

    // Eventos procesados en orden de llegada: si uno falla, los siguientes
    // igual se intentan — un evento malo no debe bloquear el resto del lote
    // (plan §6, capa 3: "un evento que falla bloquea solo su entidad").
    for (const event of events) {
      try {
        const outcome = await this.applyOne(organizationId, event);
        if (outcome === 'SKIPPED') result.skipped++;
        else if (outcome === 'CONFLICT') result.conflicts++;
        else result.applied++;
      } catch (error: any) {
        this.logger.error(
          `Error aplicando evento ${event.eventId} (org ${organizationId}, ${event.entityType}/${event.op}): ${error?.message}`,
        );
        await this.audit(organizationId, event, 'ERROR', error?.message);
      }
    }

    return result;
  }

  private async applyOne(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED' | 'SKIPPED' | 'CONFLICT'> {
    // 1. Idempotencia: si ya vimos este event_id, no se vuelve a aplicar.
    //    Al-menos-una-vez en la entrega + esto = exactamente-una-vez en efecto.
    const already = await this.prisma.syncInbox.findUnique({
      where: { eventId: event.eventId },
    });
    if (already) {
      return 'SKIPPED';
    }

    let outcome: 'APPLIED' | 'CONFLICT' = 'APPLIED';

    switch (event.entityType) {
      case 'APPOINTMENT':
        outcome = await this.applyAppointmentEvent(organizationId, event);
        break;

      case 'SLOT':
      case 'DOCTOR':
      case 'PATIENT':
      case 'SERVICE':
      case 'EPS':
        // 🚧 Fase 2+: la carga/homologación de estas entidades depende del
        // modelo de disponibilidad y de los catálogos propios de cada driver
        // (ver PLAN_ESPEJO_HOSPITAL.md §5.3/§5.4). El motor genérico ya sabe
        // RECIBIR estos eventos (idempotencia + auditoría abajo cubren
        // cualquier entityType), pero aplicarlos de verdad se implementa
        // cuando el primer driver llegue a esa fase — no antes, para no
        // adivinar reglas de negocio sin el driver real enfrente.
        this.logger.warn(
          `Evento ${event.entityType}/${event.op} recibido pero su aplicación aún no está implementada (Fase 2+). event_id=${event.eventId}`,
        );
        await this.audit(
          organizationId,
          event,
          'ERROR',
          `Aplicación de ${event.entityType} pendiente de Fase 2+`,
        );
        return 'SKIPPED';

      default: {
        // El switch ya es exhaustivo sobre CanonicalEntityType (TS lo tipa
        // como `never` aquí) — este guard es contra payloads mal formados
        // que lleguen por HTTP sin haber pasado por el type-checker.
        const unexpected: unknown = event.entityType;
        throw new Error(`entityType desconocido: ${String(unexpected)}`);
      }
    }

    // Idempotencia + auditoría se registran juntas, DESPUÉS de aplicar — si
    // el proceso se cae a mitad de camino, el agente reintentará el mismo
    // event_id y lo volveremos a aplicar (nunca queda "a medias y olvidado").
    await this.prisma.syncInbox.create({
      data: {
        organizationId,
        eventId: event.eventId,
        entityType: event.entityType,
      },
    });
    await this.audit(
      organizationId,
      event,
      outcome === 'CONFLICT' ? 'CONFLICT' : 'OK',
    );

    return outcome;
  }

  private async applyAppointmentEvent(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED' | 'CONFLICT'> {
    switch (event.op) {
      case 'INSERT':
        return this.applyAppointmentCreate(organizationId, event);
      case 'CANCEL':
        return this.applyAppointmentCancel(organizationId, event);
      case 'ATTENDANCE':
        return this.applyAttendanceUpdate(organizationId, event);
      default:
        throw new Error(
          `op no soportada para APPOINTMENT: ${event.op} (event_id=${event.eventId})`,
        );
    }
  }

  private async applyAppointmentCreate(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED' | 'CONFLICT'> {
    const { agenIAPatientId, agenIAScheduleSlotId } = event.payload;

    if (!agenIAPatientId || !agenIAScheduleSlotId) {
      // 🚧 Fase 2+: cuando el driver reporta una cita del HIS para un
      // paciente/slot que AgenIA todavía no conoce, hace falta homologar
      // (crear PatientProfile + su User asociado — ver el patrón existente
      // en chatbot.service.ts:1690, y crear/derivar el ScheduleSlot). Se
      // deja explícitamente sin implementar en Fase 1: requiere el driver
      // real y sus reglas de homologación en frente, no una suposición.
      throw new Error(
        'Cita entrante sin patientId/scheduleSlotId ya homologados — ' +
          'alta de paciente/slot en caliente es trabajo de Fase 2+.',
      );
    }

    const result = await this.appointmentsService.bookAppointment(
      agenIAPatientId,
      agenIAScheduleSlotId,
      null,
      'MIRROR',
      organizationId,
    );

    if (!result.success) {
      // El slot ya estaba ocupado en AgenIA (ej. lo tomó un paciente por
      // WhatsApp segundos antes de que llegara el evento del HIS). La
      // resolución completa (a quién se le da el cupo, mover al perdedor a
      // WaitlistEntry + MirrorConflictAlert) es la política configurable
      // por organización descrita en PLAN_ESPEJO_HOSPITAL.md §7 — se
      // implementa en Fase 4 (bidireccional completo), con el driver real
      // para validar el comportamiento contra su hospital. Por ahora el
      // conflicto queda **detectado y auditado, nunca perdido en silencio**.
      this.logger.warn(
        `Conflicto de slot al aplicar cita entrante del mirror (org ${organizationId}, slot ${agenIAScheduleSlotId}, event_id=${event.eventId}).`,
      );
      return 'CONFLICT';
    }

    return 'APPLIED';
  }

  private async applyAppointmentCancel(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED'> {
    const { agenIAAppointmentId, cancelReason, cancelObservations } =
      event.payload;
    if (!agenIAAppointmentId) {
      throw new Error(
        `Cancelación entrante sin agenIAAppointmentId (event_id=${event.eventId})`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Anti-eco: ver la nota equivalente en AppointmentsService.bookAppointment.
      await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);

      const appointment = await tx.appointment.findFirst({
        where: { id: agenIAAppointmentId, organizationId },
      });
      if (!appointment) {
        throw new Error(
          `Cita ${agenIAAppointmentId} no encontrada en la organización ${organizationId} (event_id=${event.eventId}).`,
        );
      }

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'CANCELLED',
          metaLog: {
            cancelledBy: 'MIRROR',
            reason: cancelReason ?? null,
            observations: cancelObservations ?? null,
            eventId: event.eventId,
          },
        },
      });

      await tx.scheduleSlot.update({
        where: { id: appointment.scheduleSlotId },
        data: { isAvailable: true },
      });
    });

    return 'APPLIED';
  }

  private async applyAttendanceUpdate(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED'> {
    const { agenIAAppointmentId, attendanceStatus } = event.payload;
    if (!agenIAAppointmentId || !attendanceStatus) {
      throw new Error(
        `Evento de asistencia incompleto (event_id=${event.eventId})`,
      );
    }

    await this.appointmentsService.updateAttendance(
      agenIAAppointmentId,
      attendanceStatus,
      organizationId,
    );

    return 'APPLIED';
  }

  private async audit(
    organizationId: string,
    event: CanonicalChangeEvent,
    outcome: 'OK' | 'CONFLICT' | 'ERROR',
    detail?: string,
  ): Promise<void> {
    await this.prisma.syncAudit.create({
      data: {
        organizationId,
        direction: 'INBOUND',
        entityType: event.entityType,
        entityId:
          event.payload.agenIAAppointmentId ??
          event.payload.agenIAScheduleSlotId ??
          null,
        op: event.op,
        outcome,
        detail: detail ?? null,
        eventId: event.eventId,
      },
    });
  }
}
