import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AppointmentReminderCronService } from './appointment-reminder.cron';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';

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
  ) {}

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
    @Param('id') id: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin organización.');
    if (!id) throw new BadRequestException('Falta el id de la cita.');
    return this.reminderService.sendManualForAppointment(id, organizationId);
  }
}
