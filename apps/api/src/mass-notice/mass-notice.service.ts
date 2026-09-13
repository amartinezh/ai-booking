import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { SystemLogService } from '../system-log/system-log.service';
import { formatForPatient } from '../common/business-hours';
import { getErrorMessage } from '../common/error-message.util';

/**
 * MassNoticeService — el envío de un lote de avisos masivos.
 *
 * Ver docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §7.
 *
 * EXCLUSIVO del driver cnt-sanvicente-anserma: `assertEnabled()` es la
 * defensa en profundidad — la pantalla ya comprobó las tres llaves antes de
 * dejar llegar aquí, pero este servicio las vuelve a comprobar, igual que
 * `/mirror/notice-*` hace con su propia Llave 3 (plan §5).
 *
 * "Uno por uno, no una campaña" (§7.4): un `for` secuencial con una pausa
 * entre destinatarios, sin cola ni encolador — el volumen real (J.6: promedio
 * 23/día, máximo 52 en 90 días) no lo necesita.
 */

/** Frase que llena {{5}} cuando el operador no escribió una nota adicional (§7.2). */
const DEFAULT_NOTA_ADICIONAL = 'Le ofrecemos disculpas por el inconveniente.';

/** Ritmo por defecto si `avisosMasivos.ritmoMensajesPorMinuto` no está configurado. */
const DEFAULT_RITMO_POR_MINUTO = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface AvisosMasivosConfig {
  enabled?: boolean;
  ritmoMensajesPorMinuto?: number;
}

export interface SendBatchResult {
  batchId: string;
  status: string;
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
}

@Injectable()
export class MassNoticeService {
  private readonly logger = new Logger(MassNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: WhatsappTemplateService,
    private readonly interactionLog: InteractionLogService,
    private readonly systemLog: SystemLogService,
  ) {}

  /**
   * Llave 2 + Llave 3 (plan §1), del lado del servidor — defensa en
   * profundidad. Nunca lanza por CÓMO está apagada la función, solo SI lo
   * está: el mensaje es genérico a propósito (no delata si el problema es el
   * driver o la bandera) igual que hace `MirrorAgentGuard`.
   */
  private async assertEnabled(
    organizationId: string,
  ): Promise<AvisosMasivosConfig> {
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { driverKey: true, enabled: true, avisosMasivos: true },
    });

    const avisos = (config?.avisosMasivos ??
      null) as AvisosMasivosConfig | null;

    if (
      !config ||
      !config.enabled ||
      config.driverKey !== 'cnt-sanvicente-anserma' ||
      !avisos?.enabled
    ) {
      throw new ForbiddenException(
        'Los avisos masivos no están disponibles para esta clínica.',
      );
    }

    return avisos;
  }

  /**
   * Envía (o reanuda) un lote. Idempotente: solo toca destinatarios
   * seleccionados con `outcome` en PENDIENTE o FALLIDO — reapretar el botón
   * después de un fallo parcial (o de un crash a mitad de lote) retoma donde
   * quedó, sin volver a escribirle a quien ya recibió el mensaje.
   */
  async sendBatch(
    batchId: string,
    organizationId: string,
  ): Promise<SendBatchResult> {
    const avisosConfig = await this.assertEnabled(organizationId);

    const batch = await this.prisma.massNoticeBatch.findFirst({
      where: { id: batchId, organizationId },
    });
    if (!batch) {
      throw new NotFoundException('Lote no encontrado.');
    }
    if (batch.status === 'ENVIADO' || batch.status === 'CANCELADO') {
      return {
        batchId,
        status: batch.status,
        sent: batch.sent,
        failed: batch.failed,
        skipped: batch.skipped,
        error: `Este lote ya está en estado ${batch.status} — no se puede volver a enviar.`,
      };
    }

    // ── Plantilla — si no está configurada, el envío NO se intenta (§7.1) ──
    // `findTemplate` es una lectura pura contra la base (sin llamar a Meta):
    // a diferencia de `sendTemplate`, es seguro usarla solo para comprobar
    // que la plantilla exista antes de tocar un solo destinatario.
    const template = await this.templates.findTemplate(
      organizationId,
      'APPOINTMENT_CANCELLED_MASS',
    );
    if (!template) {
      return {
        batchId,
        status: batch.status,
        sent: batch.sent,
        failed: batch.failed,
        skipped: batch.skipped,
        error:
          'No hay una plantilla APPOINTMENT_CANCELLED_MASS aprobada para esta clínica. ' +
          'Regístrela en Configuración → WhatsApp antes de enviar.',
      };
    }

    await this.prisma.massNoticeBatch.update({
      where: { id: batchId },
      data: { status: 'ENVIANDO' },
    });

    const pending = await this.prisma.massNoticeRecipient.findMany({
      where: {
        batchId,
        selected: true,
        outcome: { in: ['PENDIENTE', 'FALLIDO'] },
      },
      orderBy: { appointmentAtUtc: 'asc' },
    });

    const ritmo =
      avisosConfig.ritmoMensajesPorMinuto || DEFAULT_RITMO_POR_MINUTO;
    const delayMs = Math.max(0, Math.round(60_000 / Math.max(1, ritmo)));
    const notaAdicional = batch.notaAdicional?.trim() || DEFAULT_NOTA_ADICIONAL;

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < pending.length; i++) {
      const recipient = pending[i];
      try {
        await this.sendOne(batch, recipient, notaAdicional);
        sentCount++;
      } catch (error: unknown) {
        // Cinturón de seguridad — sendOne ya captura sus propios errores de
        // Meta y los guarda como FALLIDO; esto solo cubre un fallo inesperado
        // (ej. la propia escritura a la base) para que el lote no se detenga.
        failedCount++;
        this.logger.error(
          `Error inesperado enviando aviso a ${recipient.id} (lote ${batchId}): ${getErrorMessage(error)}`,
        );
      }
      if (i < pending.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    // Recuento final DESDE la tabla — nunca desde los contadores del loop:
    // así un reintento parcial (segunda corrida del mismo lote) refleja el
    // estado real acumulado, no solo lo que pasó en ESTA llamada.
    const [totalSelected, sentTotal, failedTotal] = await Promise.all([
      this.prisma.massNoticeRecipient.count({
        where: { batchId, selected: true },
      }),
      this.prisma.massNoticeRecipient.count({
        where: { batchId, outcome: 'ENVIADO' },
      }),
      this.prisma.massNoticeRecipient.count({
        where: { batchId, outcome: 'FALLIDO' },
      }),
    ]);
    const skippedTotal = Math.max(0, totalSelected - sentTotal - failedTotal);
    const allDone = sentTotal + failedTotal >= totalSelected;

    await this.prisma.massNoticeBatch.update({
      where: { id: batchId },
      data: {
        status: allDone ? 'ENVIADO' : 'ENVIANDO',
        sent: sentTotal,
        failed: failedTotal,
        skipped: skippedTotal,
        sentAt: allDone ? new Date() : batch.sentAt,
      },
    });

    await this.systemLog.event({
      action: 'MASS_NOTICE_SENT',
      message: `Lote de avisos masivos ${batchId}: ${sentCount} enviados, ${failedCount} fallidos en esta corrida (totales del lote: ${sentTotal} enviados, ${failedTotal} fallidos).`,
      organizationId,
      metadata: {
        batchId,
        doctorLabel: batch.doctorLabel,
        thisRun: {
          sent: sentCount,
          failed: failedCount,
          attempted: pending.length,
        },
        totals: { sent: sentTotal, failed: failedTotal, skipped: skippedTotal },
      },
    });

    return {
      batchId,
      status: allDone ? 'ENVIADO' : 'ENVIANDO',
      sent: sentTotal,
      failed: failedTotal,
      skipped: skippedTotal,
    };
  }

  /** Un destinatario: construye el mensaje, envía, registra, y suprime el recordatorio duplicado (§8). */
  private async sendOne(
    batch: {
      id: string;
      organizationId: string;
      doctorLabel: string | null;
      serviceLabel: string | null;
    },
    recipient: {
      id: string;
      patientDocument: string;
      patientName: string | null;
      phoneE164: string | null;
      appointmentAtUtc: Date;
      agenIAPatientId: string | null;
    },
    notaAdicional: string,
  ): Promise<void> {
    const nombre = recipient.patientName?.split(' ')[0] ?? 'Paciente';
    const servicio = batch.serviceLabel ?? 'su consulta';
    const medico = batch.doctorLabel ?? 'su médico';
    const fecha = formatForPatient(recipient.appointmentAtUtc);

    const bodyParams = [nombre, servicio, medico, fecha, notaAdicional];
    const recipientId = await this.resolveRecipientId(recipient);
    const message =
      `Hola ${nombre}. Le escribimos respecto a su cita de ${servicio} con ${medico}, ` +
      `programada para el ${fecha}: fue cancelada. ${notaAdicional}`;

    if (!recipientId) {
      await this.markOutcome(
        recipient.id,
        'FALLIDO',
        'Sin teléfono ni identificador de WhatsApp.',
      );
      await this.interactionLog.logMassNoticeSent({
        whatsappId: recipient.phoneE164 ?? recipient.patientDocument,
        organizationId: batch.organizationId,
        batchId: batch.id,
        recipientId: recipient.id,
        patientDocument: recipient.patientDocument,
        doctorLabel: batch.doctorLabel,
        appointmentAtUtc: recipient.appointmentAtUtc,
        success: false,
        botReply: message,
        error: 'sin-destinatario',
      });
      return;
    }

    const result = await this.templates.sendTemplate({
      organizationId: batch.organizationId,
      recipientId,
      kind: 'APPOINTMENT_CANCELLED_MASS',
      bodyParams,
    });

    await this.markOutcome(
      recipient.id,
      result.success ? 'ENVIADO' : 'FALLIDO',
      result.success ? null : (result.error ?? 'unknown'),
      result.templateName,
    );

    await this.interactionLog.logMassNoticeSent({
      whatsappId: recipientId,
      organizationId: batch.organizationId,
      batchId: batch.id,
      recipientId: recipient.id,
      patientDocument: recipient.patientDocument,
      doctorLabel: batch.doctorLabel,
      appointmentAtUtc: recipient.appointmentAtUtc,
      success: result.success,
      botReply: message,
      error: result.error,
    });

    if (result.success) {
      await this.suppressDuplicateReminder(
        batch.organizationId,
        recipient.agenIAPatientId,
        recipient.appointmentAtUtc,
      );
    }
  }

  /**
   * BSUID de AgenIA si el paciente ya existe ahí (identificador estable de
   * Meta), si no el teléfono normalizado del lote (§7.3).
   */
  private async resolveRecipientId(recipient: {
    phoneE164: string | null;
    agenIAPatientId: string | null;
  }): Promise<string | null> {
    if (recipient.agenIAPatientId) {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { id: recipient.agenIAPatientId },
        select: { bsuid: true },
      });
      if (patient?.bsuid) return patient.bsuid;
    }
    if (!recipient.phoneE164) return null;
    // `sendTemplate` espera el identificador SIN "+" para un teléfono (mismo
    // formato que `buildWhatsappRecipient` de @agenia/shared).
    return recipient.phoneE164.replace(/^\+/, '');
  }

  private async markOutcome(
    recipientId: string,
    outcome: 'ENVIADO' | 'FALLIDO',
    error: string | null,
    usedTemplate?: string,
  ): Promise<void> {
    await this.prisma.massNoticeRecipient.update({
      where: { id: recipientId },
      data: {
        outcome,
        error,
        sentAt: outcome === 'ENVIADO' ? new Date() : null,
        usedTemplate: usedTemplate ?? null,
      },
    });
  }

  /**
   * §8 del plan: si el paciente de especialista YA tiene una cita real en
   * AgenIA (el espejo la creó al homologarlo — ver §8.1), marcar
   * `reminderSentAt` para que el cron de recordatorios no le escriba
   * después de que se le acaba de avisar que la cita se canceló. Solo aplica
   * cuando hay `agenIAPatientId`: las citas nativas del HIS (CSV/espejo sin
   * homologar) no son `Appointment` y el cron no las mira — ahí no hay nada
   * que suprimir.
   */
  private async suppressDuplicateReminder(
    organizationId: string,
    agenIAPatientId: string | null,
    appointmentAtUtc: Date,
  ): Promise<void> {
    if (!agenIAPatientId) return;
    try {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          organizationId,
          patientId: agenIAPatientId,
          status: 'SCHEDULED',
          reminderSentAt: null,
          scheduleSlot: { startTime: appointmentAtUtc },
        },
        select: { id: true },
      });
      if (appointment) {
        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: { reminderSentAt: new Date() },
        });
      }
    } catch (error: unknown) {
      // Best-effort a propósito, igual que `auditarEnHIS` del driver: si esto
      // falla, el aviso YA se envió y no hay que perderlo por un error acá.
      this.logger.warn(
        `No se pudo suprimir el recordatorio duplicado para paciente ${agenIAPatientId}: ${getErrorMessage(error)}`,
      );
    }
  }
}
