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
import {
  compuertasHis,
  destinoDeContacto,
  saludoPorHora,
} from '@agenia/shared';
import {
  addBusinessHours,
  formatForPatientInSentence,
} from '../common/business-hours';
import { getErrorMessage, getErrorStack } from '../common/error-message.util';
import { citaFueraDelAlcanceDelActor } from '../common/alcance-actor.util';
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

/**
 * Los orígenes de una cita que el propio paciente se agendó por el chat. Con
 * «recordatorios solo a quien agendó él mismo» encendido, solo estas reciben el
 * recordatorio automático (ver `remindersOnlySelfBooked` en el schema).
 */
export const ORIGENES_AGENDADOS_POR_EL_PACIENTE = [
  'WHATSAPP',
  'TELEGRAM',
] as const;

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
        .catch((err: unknown) => {
          this.logger.error(
            `Cron falló (no propagado): ${getErrorMessage(err)}`,
            getErrorStack(err),
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

    const eligible = await this.findEligibleAppointments(
      now,
      targetThreshold,
      await this.pacientesConTelefonoEquivocado(),
    );
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
      } catch (error: unknown) {
        // Cinturón de seguridad — processOne ya tiene su propio try/catch,
        // pero si algo escapa, lo absorbemos aquí para no detener el lote.
        failed += 1;
        const message = getErrorMessage(error);
        const stack = getErrorStack(error);
        this.logger.error(
          `Error inesperado procesando cita ${apt.id}: ${message}`,
          stack,
        );
        await this.systemLog.error({
          action: 'REMINDER_CRON_ITEM_ERROR',
          message,
          organizationId: apt.organizationId ?? null,
          metadata: {
            appointmentId: apt.id,
            stack: stack?.substring(0, 1000),
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
  private async findEligibleAppointments(
    now: Date,
    threshold: Date,
    telefonoEquivocado: string[] = [],
  ) {
    return this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        reminderSentAt: null,
        scheduleSlot: {
          startTime: { gt: now, lte: threshold },
          // 🩺 Solo las citas de médicos con «WhatsApp ON» (Médicos) y de un
          // servicio activo (Servicios): AgenIA trabaja con ellas y con nada más
          // (2026-10-15: 187 de 252 recordatorios —82 de odontología— eran de
          // médicos fuera del bot, cuyas citas solo llegan a AgenIA porque las
          // trae el hospital; y un médico de medicina general también atiende
          // hipertensos y lectura de exámenes). El servicio es el del cupo, que
          // el espejo pone igual al de la cita del hospital.
          doctor: { whatsappBookingEnabled: true },
          service: { isActive: true },
        },
        // ☎️ Ni a quien, según la persona que contestó, tiene el número de otro
        // (ver `pacientesConTelefonoEquivocado`). En la consulta, por lo mismo que
        // el opt-out: no se marca, y si el caso se cierra a tiempo, sale.
        ...(telefonoEquivocado.length > 0
          ? { patientId: { notIn: telefonoEquivocado } }
          : {}),
        // 🔔 A quien pidió no recibir recordatorios no se le escribe, venga la cita
        // de WhatsApp o del hospital (docs/PLAN_ALTA_EN_CALIENTE.md, D2). Se filtra
        // en la consulta y no al enviar: así tampoco se le marca `reminderSentAt`,
        // que sería decir «ya se le avisó» de algo que nunca salió.
        patient: { remindersOptOut: false },
        // 🔕 El interruptor de la clínica (/dashboard/configuracion). También en la
        // consulta y no al enviar, por la misma razón que el opt-out: apagado no
        // marca nada, y como se lee en cada vuelta, prenderlo o apagarlo surte
        // efecto sin reiniciar. Sin fila de settings = prendido (su default).
        organization: {
          OR: [
            { settings: { is: null } },
            { settings: { is: { remindersEnabled: true } } },
          ],
        },
        // 💬 «Solo a quien agendó él mismo» (/dashboard/configuracion): con la
        // opción encendida, solo las citas que el paciente se sacó por el chat;
        // las del panel (MANUAL) y las del hospital (MIRROR) quedan fuera. En la
        // consulta, como el interruptor general: las que excluye no se marcan, y
        // si se apaga, las que sigan en plazo reciben el suyo. Sin fila de
        // settings = apagada (su default): todas, como siempre.
        OR: [
          { origin: { in: [...ORIGENES_AGENDADOS_POR_EL_PACIENTE] } },
          {
            organization: {
              OR: [
                { settings: { is: null } },
                { settings: { is: { remindersOnlySelfBooked: false } } },
              ],
            },
          },
        ],
      },
      include: {
        patient: {
          select: {
            cedula: true,
            fullName: true,
            whatsappId: true,
            bsuid: true,
            // Telegram (docs/PLAN_TELEGRAM.md, T4): el canal del recordatorio.
            telegramChatId: true,
            telegramBlockedAt: true,
          },
        },
        scheduleSlot: {
          include: {
            doctor: { select: { fullName: true } },
            service: { select: { name: true } },
          },
        },
        // `timezone` es lo que decide si el paciente lee «Buenos días» o
        // «Buenas tardes»: el cron corre cada 15 min y el contenedor no
        // siempre está en la hora de la clínica (ver CLAUDE.md, multi-tenant).
        // `supportPhone`, `settings` y el espejo: con cancelar o cambiar
        // apagados el recordatorio remite al hospital en vez de al bot.
        organization: {
          select: {
            id: true,
            name: true,
            timezone: true,
            supportPhone: true,
            settings: {
              select: { cancelEnabled: true, rescheduleEnabled: true },
            },
            // 🏥 Con espejo, cancelar y cambiar fecha sin su interruptor no se
            // pueden hacer en AgenIA: el recordatorio no puede ofrecerlos.
            hospitalMirrorConfig: {
              select: { enabled: true },
            },
          },
        },
      },
      // Procesamos en orden cronológico — las citas más cercanas primero.
      orderBy: { scheduleSlot: { startTime: 'asc' } },
      // Cap por seguridad: si por alguna razón hay miles, no quemar el worker
      // en un solo tick. La siguiente ejecución del cron recogerá el resto.
      take: 200,
    });
  }

  /**
   * ☎️ Pacientes con un caso `TELEFONO_EQUIVOCADO` abierto en la bandeja: quien
   * contestó dijo que ese número es de otra persona (2026-10-15). No se les escribe
   * hasta que el personal corrija el teléfono y cierre el caso, o lo descarte si no
   * era cierto: cerrarlo devuelve los recordatorios sin tocar nada del paciente.
   */
  private async pacientesConTelefonoEquivocado(): Promise<string[]> {
    const filas = await this.prisma.syncException.findMany({
      where: {
        kind: 'TELEFONO_EQUIVOCADO',
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        patientId: { not: null },
      },
      select: { patientId: true },
    });
    return [
      ...new Set(
        filas.map((f) => f.patientId).filter((id): id is string => id !== null),
      ),
    ];
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
    // ¿Por qué canal? La regla compartida con el panel (`destinoDeContacto`,
    // docs/PLAN_TELEGRAM.md T4): el de la cita, con caída al otro. Para una
    // cita que no es de Telegram da lo de siempre: el BSUID manda sobre el
    // teléfono (es el identificador estable, y el teléfono puede haber
    // caducado de la caché de 30 días de Meta).
    const destino = apt.patient
      ? destinoDeContacto(apt.patient, apt.origin)
      : null;
    if (!destino) {
      this.logger.warn(
        `Cita ${apt.id} sin identificador de WhatsApp del paciente (${apt.patient?.cedula ?? 'sin cédula'}) — omitida.`,
      );
      return 'skipped';
    }
    let phone = destino.destinatario;

    const slotDate = apt.scheduleSlot.startTime;
    const message = await this.buildMessage(apt);

    let result: { success: boolean; error?: string };
    if (destino.canal === 'TELEGRAM') {
      // ✈️ Telegram no tiene ventana de 24 h ni plantillas: texto libre siempre.
      result = await this.chatbot.sendOutboundForOrg(
        apt.organizationId,
        phone,
        message,
        { kind: 'APPOINTMENT_REMINDER', appointmentId: apt.id },
      );
      // T4: si Telegram no entrega (bloqueó al bot, canal caído), cae a
      // WhatsApp por el camino de siempre, si el paciente lo tiene.
      const respaldo = result.success
        ? null
        : destinoDeContacto(
            { ...apt.patient, telegramChatId: null },
            'WHATSAPP',
          );
      if (respaldo) {
        this.logger.warn(
          `Recordatorio de la cita ${apt.id} no salió por Telegram (${result.error ?? 'sin detalle'}): se intenta por WhatsApp.`,
        );
        phone = respaldo.destinatario;
        result = await this.sendViaWhatsapp(apt, phone, message);
      }
    } else {
      result = await this.sendViaWhatsapp(apt, phone, message);
    }

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
   * El recordatorio por WhatsApp, exactamente como era antes de Telegram:
   * texto libre dentro de la ventana de 24 h, plantilla aprobada fuera.
   */
  private async sendViaWhatsapp(
    apt: Awaited<ReturnType<typeof this.findEligibleAppointments>>[number],
    phone: string,
    message: string,
  ): Promise<{ success: boolean; error?: string }> {
    // ⏱️ VENTANA DE ATENCIÓN. Un recordatorio sale el día ANTES de la cita, así
    // que casi siempre cae FUERA de las 24 h desde el último mensaje del
    // paciente. Ahí Meta rechaza el texto libre y exige plantilla aprobada:
    // hasta ahora se mandaba texto libre siempre y esos envíos fallaban.
    const withinWindow = await this.chatbot.isWithinServiceWindow(
      apt.organizationId,
      phone,
    );

    return withinWindow
      ? await this.chatbot.sendOutboundForOrg(
          apt.organizationId,
          phone,
          message,
          { kind: 'APPOINTMENT_REMINDER', appointmentId: apt.id },
        )
      : await this.sendReminderTemplate(apt, phone);
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
      appointmentId: apt.id,
      bodyParams: [
        apt.patient?.fullName?.split(' ')[0] ?? 'Paciente',
        apt.scheduleSlot.service?.name ?? 'su consulta',
        apt.scheduleSlot.doctor?.fullName ?? 'su médico',
        // La plantilla dice «el {{4}}.»: sin el punto de «a. m.», no «a. m..».
        formatForPatientInSentence(apt.scheduleSlot.startTime),
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
    const clinicName = apt.organization?.name ?? 'su hospital';
    const patientName = apt.patient?.fullName?.split(' ')[0] ?? '';
    const doctorName = apt.scheduleSlot.doctor?.fullName ?? 'su médico';
    const serviceName = apt.scheduleSlot.service?.name ?? 'su consulta';
    // Va seguida de un punto en las dos redacciones («el *{fecha}*.»).
    const fecha = formatForPatientInSentence(apt.scheduleSlot.startTime);
    // 🔒 El recordatorio solo ofrece lo que el bot de verdad puede hacer: cada
    // operación tiene su interruptor (/dashboard/configuracion), que con espejo
    // es también su compuerta hacia el hospital (`compuerta-his.ts`). Lo que no,
    // remite al hospital. Sin fila de settings y sin espejo = prendidos.
    const espejo = apt.organization?.hospitalMirrorConfig;
    const settings = apt.organization?.settings;
    const compuertas = espejo?.enabled ? compuertasHis(settings) : null;
    const cancelar =
      (settings?.cancelEnabled ?? true) && (compuertas?.cancelar ?? true);
    const cambiar =
      (settings?.rescheduleEnabled ?? true) && (compuertas?.modificar ?? true);
    const telefono = apt.organization?.supportPhone;
    const hospital = telefono ? `el hospital al *${telefono}*` : 'el hospital';

    if (style === 'INFORMAL') {
      return (
        `¡Hola${patientName ? ' ' + patientName : ''}! 👋 Soy *${botName}* de *${clinicName}*.\n\n` +
        `Te recuerdo tu cita de *${serviceName}* con *${doctorName}* el *${fecha}*.\n\n` +
        (cancelar && cambiar
          ? `Si necesitas cambiar la fecha, escríbeme *cambiar cita*; si no puedes ir, escríbeme *cancelar cita*. ¡Te esperamos! 🩺`
          : cancelar
            ? `Si no puedes ir, escríbeme *cancelar cita* y te ayudo. Para cambiar la fecha, comunícate con ${hospital}. ¡Te esperamos! 🩺`
            : cambiar
              ? `Si necesitas cambiar la fecha, escríbeme *cambiar cita* y te ayudo. Para cancelarla, comunícate con ${hospital}. ¡Te esperamos! 🩺`
              : `Si necesitas reagendar o cancelar, comunícate con ${hospital}. ¡Te esperamos! 🩺`)
      );
    }

    return (
      `${saludoPorHora(new Date(), { timeZone: apt.organization?.timezone ?? undefined })}` +
      `${patientName ? ' ' + patientName : ''}. Le saluda *${botName}*, asistente virtual de *${clinicName}*.\n\n` +
      `Le recordamos su cita de *${serviceName}* con *${doctorName}* programada para el *${fecha}*.\n\n` +
      (cancelar && cambiar
        ? `Si requiere cambiar la fecha, responda *cambiar cita*; si no puede asistir, responda *cancelar cita*. Le esperamos. 🩺`
        : cancelar
          ? `Si no puede asistir, por favor responda *cancelar cita* y le ayudaremos. Para cambiar la fecha, comuníquese con ${hospital}. Le esperamos. 🩺`
          : cambiar
            ? `Si requiere cambiar la fecha, por favor responda *cambiar cita* y le ayudaremos. Para cancelarla, comuníquese con ${hospital}. Le esperamos. 🩺`
            : `Si requiere reagendar o cancelar, por favor comuníquese con ${hospital}. Le esperamos. 🩺`)
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
  /**
   * Recordatorio manual de UNA cita, pedido desde el panel.
   *
   * 🔐 `actor` NO es opcional a propósito (§12 #10b del plan del rastreo): este
   * endpoint aplicaba solo rol y tenant, así que un agente acotado a una EPS o a un
   * médico podía mandarle un WhatsApp al paciente de cualquier otro llamándolo
   * directo con su token. La regla es la MISMA que aplica la web
   * (`citaFueraDeAlcance`, en `@agenia/shared`): una sola copia para los dos lados.
   */
  async sendManualForAppointment(
    appointmentId: string,
    organizationId: string,
    actor: { userId: string; role: string },
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
            // Telegram (docs/PLAN_TELEGRAM.md, T4): el canal del recordatorio.
            telegramChatId: true,
            telegramBlockedAt: true,
          },
        },
        scheduleSlot: {
          include: {
            doctor: {
              select: { fullName: true, whatsappBookingEnabled: true },
            },
            service: { select: { name: true, isActive: true } },
          },
        },
        // `timezone` es lo que decide si el paciente lee «Buenos días» o
        // «Buenas tardes»: el cron corre cada 15 min y el contenedor no
        // siempre está en la hora de la clínica (ver CLAUDE.md, multi-tenant).
        // `supportPhone`, `settings` y el espejo: con cancelar o cambiar
        // apagados el recordatorio remite al hospital en vez de al bot.
        organization: {
          select: {
            id: true,
            name: true,
            timezone: true,
            supportPhone: true,
            settings: {
              select: { cancelEnabled: true, rescheduleEnabled: true },
            },
            // 🏥 Con espejo, cancelar y cambiar fecha sin su interruptor no se
            // pueden hacer en AgenIA: el recordatorio no puede ofrecerlos.
            hospitalMirrorConfig: {
              select: { enabled: true },
            },
          },
        },
      },
    });

    if (!apt) {
      return {
        success: false,
        outcome: 'skipped',
        error: 'Cita no encontrada o no pertenece a esta clínica.',
      };
    }

    // 🩺 El mismo alcance que el cron: solo médicos con «WhatsApp ON» y
    // servicios activos.
    if (apt.scheduleSlot?.doctor?.whatsappBookingEnabled === false) {
      return {
        success: false,
        outcome: 'skipped',
        error:
          'El médico de esta cita no tiene «WhatsApp ON» en Médicos: AgenIA no le escribe a sus pacientes.',
      };
    }
    if (apt.scheduleSlot?.service?.isActive === false) {
      return {
        success: false,
        outcome: 'skipped',
        error:
          'El servicio de esta cita no está activo en Servicios: AgenIA no le escribe a sus pacientes.',
      };
    }

    const fuera = await this.citaFueraDelAlcanceDelActor(actor, {
      epsId: apt.epsId,
      doctorId: apt.scheduleSlot?.doctorId ?? null,
    });
    if (fuera) {
      return {
        success: false,
        outcome: 'skipped',
        error: 'Esta cita está fuera de su alcance (EPS o médico asignados).',
      };
    }

    if (apt.status !== 'SCHEDULED') {
      return {
        success: false,
        outcome: 'skipped',
        error: `No se puede enviar recordatorio: la cita está en estado ${apt.status}.`,
      };
    }

    // ¿Hay a quién escribirle? La MISMA regla con la que processOne elige el
    // canal (`destinoDeContacto`): BSUID o teléfono de WhatsApp, o chat de
    // Telegram. Antes aquí se exigía `whatsappId`, y un paciente que ocultó su
    // número (solo BSUID) se rechazaba aunque el cron sí le escribía.
    const destino = apt.patient
      ? destinoDeContacto(apt.patient, apt.origin)
      : null;
    if (!destino) {
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
          destino.canal === 'TELEGRAM'
            ? 'No se pudo entregar el recordatorio por Telegram (ni por WhatsApp, si el paciente lo tiene). Revise la conexión del bot en Configuración o vuelva a intentar.'
            : 'Meta no aceptó el envío del recordatorio. Revise las credenciales de WhatsApp o vuelva a intentar.',
      };
    }

    // 'skipped' por algún check interno de processOne (edge case).
    return {
      success: false,
      outcome,
      error: 'No fue posible enviar el recordatorio.',
    };
  }

  /**
   * El alcance del actor, leído de sus perfiles: un BOOKING_AGENT por su
   * `AgentProfile` (EPS y médico), un DOCTOR por su propia agenda. Los demás roles
   * no quedan acotados.
   *
   * Si el perfil no se puede leer, devuelve `true` (fuera de alcance): falla CERRADO,
   * porque no saber quién es no puede habilitar un envío al paciente de otro.
   */
  private async citaFueraDelAlcanceDelActor(
    actor: { userId: string; role: string },
    cita: { epsId: string | null; doctorId: string | null },
  ): Promise<boolean> {
    return citaFueraDelAlcanceDelActor(this.prisma, actor, cita, this.logger);
  }
}
