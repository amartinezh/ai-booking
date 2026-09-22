import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AppointmentReminderCronService } from './appointment-reminder.cron';
import { HisConfirmationService } from './his-confirmation.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import {
  CurrentUser,
  type JwtUserPayload,
} from '../common/current-user.decorator';

/**
 * Endpoints HTTP del módulo de recordatorios.
 *
 * Vive aquí (y no en AppointmentsController) para evitar un ciclo de
 * dependencia: AppointmentsModule ←→ AppointmentReminderModule ←→
 * ChatbotModule. El path público sigue siendo /appointments/... porque
 * pertenece al dominio de "cita", aunque la implementación esté en este
 * módulo operativo separado.
 */
@Controller('appointments')
@UseGuards(RolesGuard)
export class AppointmentReminderController {
  constructor(
    private readonly reminderService: AppointmentReminderCronService,
    private readonly hisConfirmation: HisConfirmationService,
  ) {}

  /**
   * Confirmarle al paciente, por WhatsApp, una cita que agendó el HOSPITAL y que el
   * bot no le muestra (rastreo de paciente, escenario B — §12 #7 del plan). Dentro de
   * la ventana de 24 h sale como texto; fuera, con la plantilla
   * `HIS_APPOINTMENT_CONFIRMATION`.
   *
   * Los mismos roles que pueden investigar un cupo en el rastreo (ORG_ADMIN y
   * BOOKING_AGENT). El actor y la clínica salen del TOKEN; del body solo el cupo, el
   * paciente y cómo se verificó. El destinatario NUNCA viene del body: es el WhatsApp
   * que AgenIA tiene del paciente.
   *
   * Va antes de `:id/...` solo por orden de lectura: las rutas no chocan.
   */
  @Post('his-confirmation')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN', 'BOOKING_AGENT')
  async sendHisConfirmation(
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body()
    body: {
      scheduleSlotId?: unknown;
      patientId?: unknown;
      verificacion?: unknown;
    },
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    return this.hisConfirmation.enviar({
      organizationId,
      actor: { userId: user.userId, role: user.role },
      scheduleSlotId: body?.scheduleSlotId,
      patientId: body?.patientId,
      verificacion: body?.verificacion,
    });
  }

  /**
   * Dispara un recordatorio manual de una cita SCHEDULED.
   *
   * - Reutiliza el mismo flujo de envío + idempotencia del cron automático.
   * - Al éxito, actualiza `Appointment.reminderSentAt` para que el cron
   *   programado NO vuelva a enviar el mensaje al mismo paciente.
   * - La programación del cron NO se modifica.
   */
  @Post(':id/send-manual-reminder')
  @HttpCode(HttpStatus.OK)
  @Roles('BOOKING_AGENT', 'DOCTOR', 'ORG_ADMIN')
  async sendManualReminder(
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    if (!id) throw new BadRequestException('Falta el id de la cita.');
    // El actor sale del TOKEN, nunca del body: es lo que acota a un agente o a un
    // médico a las citas que su panel le lista (§12 #10b).
    return this.reminderService.sendManualForAppointment(id, organizationId, {
      userId: user.userId,
      role: user.role,
    });
  }
}
