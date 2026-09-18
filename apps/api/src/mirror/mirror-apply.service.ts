import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { CanonicalChangeEvent, ChangesResult } from './dto/mirror.types';
import { AttendanceStatus } from '@agenia/database';
import { getErrorMessage } from '../common/error-message.util';

/**
 * Aplica al modelo de datos de AgenIA los eventos que un driver reportó desde
 * el HIS de su hospital. Deliberadamente **no sabe de qué driver vinieron**:
 * solo entiende el formato canónico de mirror.types.ts. Reutiliza la lógica
 * de negocio existente (bookAppointment, updateAttendance) en vez de escribir
 * filas a mano, para que las invariantes (slot 1:1 cita, aislamiento de
 * tenant, disponibilidad) se respeten igual que en el flujo de WhatsApp — ver
 * PLAN_ESPEJO_HOSPITAL.md §5.1c.
 */
/**
 * Vocabulario que `Appointment.attendanceStatus` acepta (enum de Prisma).
 * El driver traduce el código de su HIS a esto en su frontera; aquí solo se
 * comprueba, porque un enum inválido revienta el UPDATE.
 */
const ATTENDANCE_VALIDOS = new Set<string>(Object.values(AttendanceStatus));

function esAttendanceStatus(valor: string): valor is AttendanceStatus {
  return ATTENDANCE_VALIDOS.has(valor);
}

/**
 * Por qué esto no es simplemente `ScheduleSlot | null`.
 *
 * Las tres razones por las que un evento del HIS puede no resolverse a un cupo
 * de AgenIA NO son el mismo suceso, y tratarlas igual tiene un precio concreto
 * en producción:
 *
 *   · `MEDICO_NO_ESPEJADO` — el hospital agendó con un médico que AgenIA no
 *     homologa. **No está roto nada.** Se espeja a propósito un subconjunto de
 *     la agenda (en Anserma, el servicio contratado); el resto de los ~235
 *     eventos diarios del hospital son de médicos que no vendemos y que no nos
 *     corresponde conocer.
 *   · `SIN_CUPO` — el médico SÍ está homologado, pero falta el cupo. Eso sí es
 *     una laguna real del espejo y tiene que doler.
 *   · `EVENTO_INCOMPLETO` — el evento llegó sin médico o sin hora: está mal
 *     formado y no se puede interpretar.
 *
 * Antes las tres devolvían `null` y las tres acababan en `throw` → fila ERROR.
 * Con el hospital trabajando de verdad contra producción eso son ~200 filas
 * ERROR diarias por algo que funciona como se diseñó, y entre ese ruido se
 * pierde el error que sí importa. Es el mismo antipatrón que ya se corrigió en
 * la salida (`skippedSeqs` para los eventos SLOT que el driver no espeja) y en
 * el desenlace de atención, que ya devolvía SKIPPED: faltaba alinear el alta y
 * la cancelación entrantes.
 */
type ResolucionCupo =
  | { tipo: 'OK'; cupo: { id: string; isAvailable: boolean } }
  | { tipo: 'MEDICO_NO_ESPEJADO' }
  | { tipo: 'SIN_CUPO' }
  | { tipo: 'EVENTO_INCOMPLETO' };

@Injectable()
export class MirrorApplyService {
  private readonly logger = new Logger(MirrorApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly waitlistService: WaitlistService,
  ) {}

  async applyBatch(
    organizationId: string,
    events: CanonicalChangeEvent[],
  ): Promise<ChangesResult> {
    const result: ChangesResult = {
      applied: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    };

    // Eventos procesados en orden de llegada: si uno falla, los siguientes
    // igual se intentan — un evento malo no debe bloquear el resto del lote
    // (plan §6, capa 3: "un evento que falla bloquea solo su entidad").
    for (const event of events) {
      try {
        const outcome = await this.applyOne(organizationId, event);
        if (outcome === 'SKIPPED') result.skipped++;
        else if (outcome === 'CONFLICT') result.conflicts++;
        else result.applied++;
      } catch (error: unknown) {
        // Se cuenta, además de auditarse. Sin el contador, el agente recibía
        // 200 y no tenía forma de saber que la mitad del lote se había caído.
        result.errors++;
        const message = getErrorMessage(error);
        this.logger.error(
          `Error aplicando evento ${event.eventId} (org ${organizationId}, ${event.entityType}/${event.op}): ${message}`,
        );
        await this.audit(organizationId, event, 'ERROR', message);
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

    let outcome: 'APPLIED' | 'CONFLICT' | 'SKIPPED' = 'APPLIED';

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
    // SKIPPED se audita como SKIPPED. Antes un evento omitido se registraba
    // como 'OK', que es mentira por omisión: quien mañana pregunte "¿por qué
    // esta cita del hospital no está en AgenIA?" necesita leer SKIPPED, no un
    // OK que promete lo contrario. Mismo criterio que ya usa la salida en
    // `markSkipped`.
    //
    // APPLIED se sigue escribiendo como 'OK' a propósito: es el valor que
    // lleva toda la auditoría histórica y el que consultan los tableros.
    // Renombrarlo ahora partiría en dos la serie por un matiz de vocabulario.
    await this.audit(
      organizationId,
      event,
      outcome === 'APPLIED' ? 'OK' : outcome,
    );

    return outcome;
  }

  private async applyAppointmentEvent(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED' | 'CONFLICT' | 'SKIPPED'> {
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

  /**
   * Encuentra el cupo de AgenIA que corresponde a una cita del HIS.
   *
   * El driver no conoce los ids de AgenIA: reporta "el médico 76 a las 07:00".
   * La traducción se hace aquí, con la misma homologación que usa la salida
   * (`MirrorEntityMap`), para que la equivalencia viva en un solo sitio.
   */
  private async resolverCupo(
    organizationId: string,
    payload: CanonicalChangeEvent['payload'],
  ): Promise<ResolucionCupo> {
    if (!payload.doctorExternalKey || !payload.startTimeIso) {
      return { tipo: 'EVENTO_INCOMPLETO' };
    }

    const mapa = await this.prisma.mirrorEntityMap.findFirst({
      where: {
        organizationId,
        entityType: 'DOCTOR',
        externalKey: payload.doctorExternalKey,
      },
      select: { agenIAId: true },
    });
    if (!mapa) return { tipo: 'MEDICO_NO_ESPEJADO' };

    const cupo = await this.prisma.scheduleSlot.findFirst({
      where: {
        organizationId,
        doctorId: mapa.agenIAId,
        startTime: new Date(payload.startTimeIso),
      },
    });

    return cupo ? { tipo: 'OK', cupo } : { tipo: 'SIN_CUPO' };
  }

  private async applyAppointmentCreate(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED' | 'CONFLICT' | 'SKIPPED'> {
    const { agenIAPatientId } = event.payload;
    let { agenIAScheduleSlotId } = event.payload;

    // 🏥 Cita nacida en el HIS: el driver la reporta por médico y hora, no por
    // id de AgenIA. Sin resolverla, ese cupo seguiría ofreciéndose por
    // WhatsApp aunque el hospital ya lo hubiera vendido — la sobreventa que
    // encontró la prueba de punta a punta.
    if (!agenIAScheduleSlotId) {
      const resuelto = await this.resolverCupo(organizationId, event.payload);

      if (resuelto.tipo === 'MEDICO_NO_ESPEJADO') {
        // Cita del hospital con un médico que no espejamos: correcto que no
        // llegue a AgenIA. Se cierra como SKIPPED, no como error. Ver la nota
        // larga sobre `ResolucionCupo`.
        this.logger.debug(
          `Alta entrante de un médico no espejado ` +
            `(${event.payload.doctorExternalKey}). Se omite.`,
        );
        return 'SKIPPED';
      }

      if (resuelto.tipo !== 'OK') {
        throw new Error(
          `Cita entrante del HIS sin cupo equivalente en AgenIA ` +
            `(médico ${event.payload.doctorExternalKey}, ${event.payload.startTimeIso}). ` +
            `${
              resuelto.tipo === 'SIN_CUPO'
                ? 'El médico está homologado pero falta generar el cupo.'
                : 'El evento llegó sin médico o sin hora.'
            }`,
        );
      }

      const { cupo } = resuelto;

      // Ocupar el cupo es lo que evita la sobreventa, y hay que hacerlo
      // aunque el paciente no se pueda homologar: da igual quién tenga la
      // cita, lo que importa es que AgenIA deje de ofrecer esa hora.
      if (!cupo.isAvailable) return 'APPLIED'; // ya estaba ocupado: nada que hacer

      if (!agenIAPatientId) {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
          await tx.scheduleSlot.update({
            where: { id: cupo.id },
            data: { isAvailable: false },
          });
        });
        this.logger.log(
          `Cupo ${cupo.id} marcado como ocupado por una cita del HIS ` +
            `(paciente ${event.payload.patientDocument ?? 'desconocido'} sin homologar).`,
        );
        return 'APPLIED';
      }

      agenIAScheduleSlotId = cupo.id;
    }

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
  ): Promise<'APPLIED' | 'SKIPPED'> {
    const { cancelReason, cancelObservations } = event.payload;
    let { agenIAAppointmentId } = event.payload;

    // 🏥 Cancelación hecha en el HIS: llega identificada por médico y hora.
    // Se resuelve al cupo y de ahí a la cita, si es que AgenIA tenía una.
    if (!agenIAAppointmentId) {
      const resuelto = await this.resolverCupo(organizationId, event.payload);

      if (resuelto.tipo === 'MEDICO_NO_ESPEJADO') {
        // El hospital canceló una cita de un médico que no espejamos. No hay
        // cupo nuestro que liberar ni paciente nuestro al que avisarle.
        this.logger.debug(
          `Cancelación entrante de un médico no espejado ` +
            `(${event.payload.doctorExternalKey}). Se omite.`,
        );
        return 'SKIPPED';
      }

      if (resuelto.tipo !== 'OK') {
        throw new Error(
          `Cancelación entrante del HIS sin cupo equivalente en AgenIA ` +
            `(médico ${event.payload.doctorExternalKey}, ${event.payload.startTimeIso}). ` +
            `${
              resuelto.tipo === 'SIN_CUPO'
                ? 'El médico está homologado pero falta generar el cupo.'
                : 'El evento llegó sin médico o sin hora.'
            }`,
        );
      }

      const { cupo } = resuelto;

      // ⚠️ `status: { not: 'CANCELLED' }` NO sobra. Un mismo cupo puede tener
      // VARIAS citas: las canceladas se conservan como historia y el índice
      // parcial `uq_appointment_cupo_vigente` solo exige que haya una VIGENTE.
      // Ese estado no es teórico — la campaña de certificación del 2026-09-18
      // dejó tres cupos con una cita cancelada y otra nueva encima.
      //
      // Sin el filtro, `findFirst` elegía entre ellas sin orden ni criterio:
      // podía devolver una cita ya cancelada (y volver a "cancelarla", inocuo)
      // o —el caso que importa— la cita VIVA del paciente que tomó el cupo
      // después, y cancelársela por una cancelación que no era la suya.
      const cita = await this.prisma.appointment.findFirst({
        where: {
          scheduleSlotId: cupo.id,
          organizationId,
          status: { not: 'CANCELLED' },
        },
      });

      if (!cita) {
        // O el hospital canceló una cita suya, que AgenIA nunca tuvo, o es la
        // re-entrega de una cancelación ya aplicada. En ambos casos lo único
        // que corresponde es que el cupo quede libre para volver a ofrecerse
        // por WhatsApp.
        if (!cupo.isAvailable) {
          await this.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL agenia.sync_origin = 'MIRROR'`,
            );
            await tx.scheduleSlot.update({
              where: { id: cupo.id },
              data: { isAvailable: true },
            });
          });
          this.logger.log(
            `Cupo ${cupo.id} liberado: el hospital canceló una cita que AgenIA no tenía.`,
          );
          await this.avisarListaDeEspera(organizationId, cupo.id);
        }
        return 'APPLIED';
      }

      agenIAAppointmentId = cita.id;
    }

    const cupoLiberadoId = await this.prisma.$transaction(async (tx) => {
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

      return appointment.scheduleSlotId;
    });

    await this.avisarListaDeEspera(organizationId, cupoLiberadoId);

    return 'APPLIED';
  }

  /**
   * Avisa al primero de la lista de espera que este cupo volvió a estar libre.
   *
   * 🚨 POR QUÉ EXISTE. Cuando el paciente cancela por WhatsApp, el chatbot ya
   * avisa a la lista de espera. Cuando cancela el HOSPITAL —que es de donde
   * sale la mayoría de las cancelaciones: 2.134 de 2.409 en 90 días son
   * "PACIENTE LLAMA A CANCELAR"— no avisaba nadie. El cupo quedaba libre en
   * silencio, para quien pasara a conversar por casualidad.
   *
   * Con una agenda holgada eso solo es una oportunidad perdida. Con el 30% de
   * la agenda que el hospital destina al canal, donde casi todo el que escribe
   * termina en lista de espera, es la diferencia entre una lista que se drena
   * y una que solo acumula: dentro del pozo MDD hay ~1,1 cancelaciones diarias
   * frente a ~4,4 cupos nuevos, o sea que era un cuarto de la capacidad real
   * del canal el que no llegaba a quien llevaba días esperando.
   *
   * Va FUERA de la transacción y con su propio try/catch a propósito: el aviso
   * es un efecto secundario. No debe poder deshacer una cancelación ya
   * aplicada ni dejarla a medias porque WhatsApp esté caído; y el evento del
   * HIS ya está aplicado y auditado aunque el mensaje no salga.
   */
  private async avisarListaDeEspera(
    organizationId: string,
    slotId: string,
  ): Promise<void> {
    try {
      const cupo = await this.prisma.scheduleSlot.findFirst({
        where: { id: slotId, organizationId },
        include: { doctor: true },
      });

      // Se relee el cupo en vez de fiarse de lo que se acaba de escribir: si
      // entre la cancelación y este punto alguien ya tomó la hora, avisar
      // sería ofrecer un cupo que ya no está.
      if (!cupo || !cupo.isAvailable) return;

      await this.waitlistService.notifyWaitlist({
        slotId: cupo.id,
        serviceId: cupo.serviceId,
        epsId: cupo.allowedEpsId,
        organizationId,
        doctorName: cupo.doctor.fullName,
        slotDate: cupo.startTime,
      });
    } catch (error: unknown) {
      this.logger.error(
        `Cancelación aplicada, pero no se pudo avisar a la lista de espera ` +
          `del cupo ${slotId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Desenlace de atención nacido en el HIS.
   *
   * 🚨 Esto NUNCA se aplicó. El driver reporta la cita por médico y hora —no
   * conoce los ids de AgenIA, no puede—, así que `agenIAAppointmentId` venía
   * siempre vacío y este método lanzaba. `applyBatch` se tragaba el error, lo
   * dejaba como una fila ERROR en `SyncAudit`, y el agente recibía 200 y
   * avanzaba el cursor: el evento no se reintentaba jamás. Eran ~235 al día, y
   * `Appointment.attendanceStatus` se quedaba en PENDING para siempre — nadie
   * sabía quién había asistido.
   *
   * La cancelación entrante ya resolvía esto por el cupo desde hacía tiempo.
   * La asistencia hace ahora lo mismo.
   */
  private async applyAttendanceUpdate(
    organizationId: string,
    event: CanonicalChangeEvent,
  ): Promise<'APPLIED' | 'SKIPPED'> {
    const { attendanceStatus } = event.payload;
    let { agenIAAppointmentId } = event.payload;

    if (!attendanceStatus) {
      throw new Error(
        `Evento de asistencia sin desenlace (event_id=${event.eventId})`,
      );
    }

    // El driver traduce el código del HIS al vocabulario de AgenIA antes de
    // enviarlo. Si aun así llega algo que este modelo no conoce, se rechaza
    // en vez de escribirlo: un valor inventado en la asistencia de un
    // paciente es peor que no tener el dato.
    if (!esAttendanceStatus(attendanceStatus)) {
      throw new Error(
        `Desenlace de atención desconocido "${attendanceStatus}" ` +
          `(event_id=${event.eventId}). Esperados: ${[...ATTENDANCE_VALIDOS].join(', ')}.`,
      );
    }

    if (!agenIAAppointmentId) {
      const resuelto = await this.resolverCupo(organizationId, event.payload);
      const cita =
        resuelto.tipo === 'OK'
          ? await this.prisma.appointment.findFirst({
              where: { scheduleSlotId: resuelto.cupo.id, organizationId },
            })
          : null;

      if (!cita) {
        // El hospital atendió una cita que AgenIA nunca tuvo: la agendó él
        // por ventanilla. No hay nada que actualizar y no es un fallo — el
        // cupo ya está ocupado, que es lo único que nos importaba de ella.
        this.logger.log(
          `Desenlace de atención de una cita que AgenIA no tiene ` +
            `(médico ${event.payload.doctorExternalKey}, ${event.payload.startTimeIso}). Se omite.`,
        );
        return 'SKIPPED';
      }

      agenIAAppointmentId = cita.id;
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
    outcome: 'OK' | 'SKIPPED' | 'CONFLICT' | 'ERROR',
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
