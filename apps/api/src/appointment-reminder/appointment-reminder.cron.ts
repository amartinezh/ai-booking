import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { OrganizationSettingsService } from '../chatbot/organization-settings.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { SystemLogService } from '../system-log/system-log.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { addBusinessHours, formatForPatient } from '../common/business-hours';
import {
  readReminderConfig,
  ReminderConfig,
} from './appointment-reminder.config';

/**
 * ⏰ AppointmentReminderCronService
 *
 * Cron que envía recordatorios de citas por WhatsApp con N horas hábiles
 * de anticipación (N viene de `REMINDER_BUSINESS_HOURS_BEFORE` en el .env).
 *
 * Garantías:
 *   1. Multi-tenant: cada cita usa las credenciales WhatsApp de SU clínica.
 *   2. Idempotente: nunca envía dos veces — `Appointment.reminderSentAt`
 *      se actualiza atómicamente tras el envío exitoso.
 *   3. Tolerante a fallos individuales: un error en una cita NO detiene
 *      al resto del lote (try/catch por iteración).
 *   4. Trazable: cada envío deja huella en InteractionLog (Caja Negra)
 *      y un evento agregado en SystemLog cuando termina el lote.
 *   5. Time-zone aware: la matemática "skip Sat/Sun" se hace en
 *      America/Bogota (UTC-5 sin DST).
 */
const INTERVAL_NAME = 'appointment-reminders';

@Injectable()
export class AppointmentReminderCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AppointmentReminderCronService.name);
  private readonly cfg: ReminderConfig;
  /** Lock para evitar runs concurrentes si la ejecución previa se demora. */
  private inFlight = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly chatbot: ChatbotService,
    private readonly organizationSettings: OrganizationSettingsService,
    private readonly interactionLog: InteractionLogService,
    private readonly systemLog: SystemLogService,
    private readonly templates: WhatsappTemplateService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    // Validación temprana — si el .env está mal, el módulo no arranca.
    this.cfg = readReminderConfig(this.config);
  }

  onModuleInit() {
    // Registramos el intervalo dinámicamente para respetar el valor del .env.
    // Usamos addInterval (ms) en lugar de @Cron() porque el decorador fija
    // el intervalo en tiempo de compilación.
    const ms = this.cfg.cronMinutes * 60 * 1000;
    const handle = setInterval(() => {
      // Lock para evitar runs concurrentes si un tick se demora más que el
      // intervalo (ej. envíos lentos contra Meta).
      if (this.inFlight) {
        this.logger.warn(
          'Tick anterior aún en curso — se omite este disparo para evitar concurrencia.',
        );
        return;
      }
      this.inFlight = true;
      this.runOnce()
        .catch((err) => {
          this.logger.error(
            `Cron falló (no propagado): ${err?.message}`,
            err?.stack,
          );
        })
        .finally(() => {
          this.inFlight = false;
        });
    }, ms);
    this.scheduler.addInterval(INTERVAL_NAME, handle);

    this.logger.log(
      `Cron de recordatorios iniciado: cada ${this.cfg.cronMinutes} min, ` +
        `${this.cfg.businessHoursBefore}h hábiles de anticipación.`,
    );
  }

  onModuleDestroy() {
    try {
      this.scheduler.deleteInterval(INTERVAL_NAME);
    } catch {
      // Si nunca se registró (ej. fallo temprano en onModuleInit), ignorar.
    }
  }

  // ════════════════════════════════════════════════════════════════
  // RUTINA PRINCIPAL
  // ════════════════════════════════════════════════════════════════

  /**
   * Punto de entrada del cron. Calcula la ventana, busca citas elegibles,
   * itera y delega. Catchea errores por iteración para no romper el lote.
   * Expuesto público porque facilita testeo manual desde un script o un
   * endpoint admin futuro.
   */
  async runOnce(): Promise<{ sent: number; failed: number; skipped: number }> {
    const start = Date.now();
    const now = new Date();
    const targetThreshold = addBusinessHours(now, this.cfg.businessHoursBefore);

    this.logger.debug(
      `Tick — ventana de recordatorios: (${now.toISOString()}, ${targetThreshold.toISOString()}]`,
    );

    const eligible = await this.findEligibleAppointments(now, targetThreshold);
    if (eligible.length === 0) {
      this.logger.debug('Sin citas elegibles en esta ventana.');
      return { sent: 0, failed: 0, skipped: 0 };
    }

    this.logger.log(`Procesando ${eligible.length} recordatorios pendientes.`);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const apt of eligible) {
      try {
        const outcome = await this.processOne(apt);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'failed') failed += 1;
        else skipped += 1;
      } catch (error: any) {
        // Cinturón de seguridad — processOne ya tiene su propio try/catch,
        // pero si algo escapa, lo absorbemos aquí para no detener el lote.
        failed += 1;
        this.logger.error(
          `Error inesperado procesando cita ${apt.id}: ${error.message}`,
          error.stack,
        );
        await this.systemLog.error({
          action: 'REMINDER_CRON_ITEM_ERROR',
          message: error.message,
          organizationId: apt.organizationId ?? null,
          metadata: {
            appointmentId: apt.id,
            stack: error.stack?.substring(0, 1000),
          },
        });
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `Resumen lote — enviados=${sent}, fallidos=${failed}, omitidos=${skipped} (${durationMs}ms).`,
    );

    await this.systemLog.event({
      action: 'REMINDER_CRON_RUN',
      message: `Recordatorios procesados: ${sent} enviados, ${failed} fallidos, ${skipped} omitidos.`,
      metadata: {
        sent,
        failed,
        skipped,
        durationMs,
        businessHoursBefore: this.cfg.businessHoursBefore,
        windowFrom: now.toISOString(),
        windowTo: targetThreshold.toISOString(),
      },
    });

    return { sent, failed, skipped };
  }

  // ════════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Devuelve citas SCHEDULED + reminderSentAt=NULL + dentro de la ventana,
   * con todos los joins necesarios para construir el mensaje sin más
   * roundtrips a la DB.
   *
   * El filtro `scheduleSlot.startTime > now` evita molestar al paciente con
   * un recordatorio para una cita que ya pasó (puede ocurrir si el cron
   * estuvo abajo varias horas y se "atrasó").
   */
  private async findEligibleAppointments(now: Date, threshold: Date) {
    return this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        reminderSentAt: null,
        scheduleSlot: {
          startTime: { gt: now, lte: threshold },
        },
      },
      include: {
        patient: {
          select: {
            cedula: true,
            fullName: true,
            whatsappId: true,
            bsuid: true,
          },
        },
        scheduleSlot: {
          include: {
            doctor: { select: { fullName: true } },
            service: { select: { name: true } },
          },
        },
        organization: { select: { id: true, name: true } },
      },
      // Procesamos en orden cronológico — las citas más cercanas primero.
      orderBy: { scheduleSlot: { startTime: 'asc' } },
      // Cap por seguridad: si por alguna razón hay miles, no quemar el worker
      // en un solo tick. La siguiente ejecución del cron recogerá el resto.
      take: 200,
    });
  }

  /**
   * Procesa una cita individual: validaciones → envío → idempotencia → log.
   * Devuelve el outcome para que el caller alimente las métricas del lote.
   *
   * Casos:
   *  - 'skipped' → la cita no es enviable (sin whatsappId, sin org activa, etc.).
   *  - 'sent'    → WhatsApp respondió OK y guardamos reminderSentAt.
   *  - 'failed'  → intentamos pero el envío falló (token revocado, red, etc.).
   */
  private async processOne(
    apt: Awaited<ReturnType<typeof this.findEligibleAppointments>>[number],
  ): Promise<'sent' | 'failed' | 'skipped'> {
    if (!apt.organizationId) {
      this.logger.warn(`Cita ${apt.id} sin organizationId — omitida.`);
      return 'skipped';
    }
    // El BSUID manda sobre el teléfono: es el identificador estable, y el
    // teléfono puede haber caducado de la caché de 30 días de Meta.
    const phone = apt.patient?.bsuid || apt.patient?.whatsappId;
    if (!phone) {
      this.logger.warn(
        `Cita ${apt.id} sin identificador de WhatsApp del paciente (${apt.patient?.cedula ?? 'sin cédula'}) — omitida.`,
      );
      return 'skipped';
    }

    const slotDate = apt.scheduleSlot.startTime;
    const message = await this.buildMessage(apt);

    // ⏱️ VENTANA DE ATENCIÓN. Un recordatorio sale el día ANTES de la cita, así
    // que casi siempre cae FUERA de las 24 h desde el último mensaje del
    // paciente. Ahí Meta rechaza el texto libre y exige plantilla aprobada:
    // hasta ahora se mandaba texto libre siempre y esos envíos fallaban.
    const withinWindow = await this.chatbot.isWithinServiceWindow(
      apt.organizationId,
      phone,
    );

    const result = withinWindow
      ? await this.chatbot.sendOutboundForOrg(
          apt.organizationId,
          phone,
          message,
        )
      : await this.sendReminderTemplate(apt, phone);

    if (result.error === 'template-not-configured') {
      // No es un fallo de red que reintentar: falta que la clínica apruebe y
      // registre su plantilla. Se deja huella para que lo vea en su auditoría.
      this.logger.warn(
        `Cita ${apt.id} (org ${apt.organizationId}): fuera de la ventana de 24 h y ` +
          `sin plantilla APPOINTMENT_REMINDER configurada. Recordatorio NO enviado — ` +
          `registre la plantilla aprobada por Meta para esta clínica.`,
      );
      await this.interactionLog.logReminderSent({
        whatsappId: phone,
        organizationId: apt.organizationId,
        appointmentId: apt.id,
        patientCedula: apt.patient?.cedula ?? null,
        doctorName: apt.scheduleSlot.doctor?.fullName ?? null,
        serviceName: apt.scheduleSlot.service?.name ?? null,
        slotDate,
        businessHoursBefore: this.cfg.businessHoursBefore,
        success: false,
        error:
          'Sin plantilla APPOINTMENT_REMINDER configurada para la clínica.',
        botReply: message,
      });
      return 'skipped';
    }

    if (result.success) {
      // Idempotencia: marca la cita ANTES de loggear para evitar reenvíos
      // si algo posterior falla.
      await this.prisma.appointment.update({
        where: { id: apt.id },
        data: { reminderSentAt: new Date() },
      });

      await this.interactionLog.logReminderSent({
        whatsappId: phone,
        organizationId: apt.organizationId,
        appointmentId: apt.id,
        patientCedula: apt.patient?.cedula ?? null,
        doctorName: apt.scheduleSlot.doctor?.fullName ?? null,
        serviceName: apt.scheduleSlot.service?.name ?? null,
        slotDate,
        businessHoursBefore: this.cfg.businessHoursBefore,
        success: true,
        botReply: message,
      });

      this.logger.log(
        `✅ Recordatorio enviado — apt=${apt.id} org=${apt.organizationId} to=${phone}`,
      );
      return 'sent';
    }

    // Envío fallido: dejamos reminderSentAt en NULL para que el siguiente
    // tick lo reintente. NO escribimos en la cita; sí dejamos huella en logs.
    this.logger.error(
      `❌ Falló envío de recordatorio — apt=${apt.id} org=${apt.organizationId} to=${phone} error=${result.error}`,
    );
    await this.interactionLog.logReminderSent({
      whatsappId: phone,
      organizationId: apt.organizationId,
      appointmentId: apt.id,
      patientCedula: apt.patient?.cedula ?? null,
      doctorName: apt.scheduleSlot.doctor?.fullName ?? null,
      serviceName: apt.scheduleSlot.service?.name ?? null,
      slotDate,
      businessHoursBefore: this.cfg.businessHoursBefore,
      success: false,
      botReply: message,
      error: result.error ?? 'unknown',
    });
    return 'failed';
  }

  /**
   * Construye el texto del recordatorio adaptado al tono configurado por
   * la clínica (FORMAL → "usted", INFORMAL → "tú"). Reutiliza el servicio
   * existente OrganizationSettingsService para mantener una única fuente
   * de verdad sobre el tono.
   */
  /**
   * Envía el recordatorio como PLANTILLA aprobada (vía fuera de la ventana).
   *
   * CONTRATO DE VARIABLES — la plantilla que la clínica apruebe en Meta debe
   * declarar sus marcadores del cuerpo en este orden exacto:
   *
   *   {{1}} nombre del paciente   {{2}} servicio
   *   {{3}} médico                {{4}} fecha y hora
   *
   * Si la aprobación usa otro orden u otra cantidad, Meta rechaza el envío y
   * el error viaja tal cual hasta la auditoría.
   */
  private async sendReminderTemplate(
    apt: Awaited<ReturnType<typeof this.findEligibleAppointments>>[number],
    recipientId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.templates.sendTemplate({
      organizationId: apt.organizationId,
      recipientId,
      kind: 'APPOINTMENT_REMINDER',
      bodyParams: [
        apt.patient?.fullName?.split(' ')[0] ?? 'Paciente',
        apt.scheduleSlot.service?.name ?? 'su consulta',
        apt.scheduleSlot.doctor?.fullName ?? 'su médico',
        formatForPatient(apt.scheduleSlot.startTime),
      ],
    });
  }

  private async buildMessage(
    apt: Awaited<ReturnType<typeof this.findEligibleAppointments>>[number],
  ): Promise<string> {
    const style = await this.organizationSettings.getCommunicationStyle(
      apt.organizationId,
    );
    const botName = await this.organizationSettings.getBotName(
      apt.organizationId,
    );
    const clinicName = apt.organization?.name ?? 'su clínica';
    const patientName = apt.patient?.fullName?.split(' ')[0] ?? '';
    const doctorName = apt.scheduleSlot.doctor?.fullName ?? 'su médico';
    const serviceName = apt.scheduleSlot.service?.name ?? 'su consulta';
    const fecha = formatForPatient(apt.scheduleSlot.startTime);

    if (style === 'INFORMAL') {
      return (
        `¡Hola${patientName ? ' ' + patientName : ''}! 👋 Soy *${botName}* de *${clinicName}*.\n\n` +
        `Te recuerdo tu cita de *${serviceName}* con *${doctorName}* el *${fecha}*.\n\n` +
        `Si necesitas reagendar o cancelar, escríbeme *cancelar cita* y te ayudo. ¡Te esperamos! 🩺`
      );
    }

    return (
      `Buenos días${patientName ? ' ' + patientName : ''}. Le saluda *${botName}*, asistente virtual de *${clinicName}*.\n\n` +
      `Le recordamos su cita de *${serviceName}* con *${doctorName}* programada para el *${fecha}*.\n\n` +
      `Si requiere reagendar o cancelar, por favor responda *cancelar cita* y le ayudaremos. Le esperamos. 🩺`
    );
  }

  // ════════════════════════════════════════════════════════════════
  // ENVÍO MANUAL — DISPARO DESDE EL DASHBOARD
  // ════════════════════════════════════════════════════════════════
  //
  // Reutiliza la misma maquinaria que el cron (`processOne`) pero para una
  // sola cita identificada por ID. El caller decide cuándo dispararlo (botón
  // en la tabla de citas). Como `processOne` ya actualiza `reminderSentAt`,
  // el cron NO volverá a enviar a esta cita en la siguiente ejecución
  // automática — exactamente la garantía de idempotencia que se pide.
  //
  // Si la cita ya tenía `reminderSentAt`, se permite el reenvío manual
  // (el operador clínico tiene la última palabra) y el campo se actualiza
  // al nuevo timestamp.
  async sendManualForAppointment(
    appointmentId: string,
    organizationId: string,
  ): Promise<{
    success: boolean;
    outcome: 'sent' | 'failed' | 'skipped';
    error?: string;
    appointment?: {
      id: string;
      reminderSentAt: Date | null;
      patientWhatsappId: string | null;
    };
  }> {
    // 1. Cargar la cita con los MISMOS includes que usa el cron, para que
    //    processOne reciba exactamente el mismo shape.
    const apt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      include: {
        patient: {
          select: {
            cedula: true,
            fullName: true,
            whatsappId: true,
            bsuid: true,
          },
        },
        scheduleSlot: {
          include: {
            doctor: { select: { fullName: true } },
            service: { select: { name: true } },
          },
        },
        organization: { select: { id: true, name: true } },
      },
    });

    if (!apt) {
      return {
        success: false,
        outcome: 'skipped',
        error: 'Cita no encontrada o no pertenece a esta clínica.',
      };
    }

    if (apt.status !== 'SCHEDULED') {
      return {
        success: false,
        outcome: 'skipped',
        error: `No se puede enviar recordatorio: la cita está en estado ${apt.status}.`,
      };
    }

    if (!apt.patient?.whatsappId) {
      return {
        success: false,
        outcome: 'skipped',
        error: 'El paciente no tiene número de WhatsApp registrado.',
      };
    }

    // 2. Delegar al mismo flujo del cron — actualiza reminderSentAt y registra
    //    InteractionLog automáticamente.
    const outcome = await this.processOne(apt);

    if (outcome === 'sent') {
      // Eco hacia SystemLog para diferenciar disparos manuales de los del cron.
      await this.systemLog.event({
        action: 'REMINDER_MANUAL_SENT',
        message: `Recordatorio manual enviado para cita ${apt.id}.`,
        organizationId: apt.organizationId ?? null,
        metadata: {
          appointmentId: apt.id,
          patientCedula: apt.patient?.cedula ?? null,
          slotDate: apt.scheduleSlot.startTime.toISOString(),
        },
      });

      // Releemos para devolver el reminderSentAt ya actualizado al frontend.
      const refreshed = await this.prisma.appointment.findUnique({
        where: { id: apt.id },
        select: { id: true, reminderSentAt: true },
      });
      return {
        success: true,
        outcome,
        appointment: {
          id: apt.id,
          reminderSentAt: refreshed?.reminderSentAt ?? null,
          patientWhatsappId: apt.patient.whatsappId,
        },
      };
    }

    if (outcome === 'failed') {
      return {
        success: false,
        outcome,
        error:
          'Meta no aceptó el envío del recordatorio. Revise las credenciales de WhatsApp o vuelva a intentar.',
      };
    }

    // 'skipped' por algún check interno de processOne (edge case).
    return {
      success: false,
      outcome,
      error: 'No fue posible enviar el recordatorio.',
    };
  }
}
