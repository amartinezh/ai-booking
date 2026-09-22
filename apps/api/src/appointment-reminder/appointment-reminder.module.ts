import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { InteractionLogModule } from '../interaction-log/interaction-log.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { AppointmentReminderCronService } from './appointment-reminder.cron';
import { AppointmentReminderController } from './appointment-reminder.controller';
import { HisConfirmationService } from './his-confirmation.service';

/**
 * Módulo independiente para el cron de recordatorios.
 *
 * Vive separado de AppointmentsModule a propósito: ese módulo es de
 * dominio (CRUD de citas), y los recordatorios son un job operativo
 * que cruza Chatbot + InteractionLog + SystemLog. Aislarlo aquí evita
 * dependencias circulares con ChatbotModule (que ya importa
 * AppointmentsModule) y mantiene el árbol de módulos limpio.
 *
 * También expone los envíos manuales:
 *   POST /appointments/:id/send-manual-reminder
 *   POST /appointments/his-confirmation   (rastreo de paciente, escenario B)
 */
@Module({
  imports: [ChatbotModule, InteractionLogModule, WhatsappConfigModule],
  controllers: [AppointmentReminderController],
  providers: [AppointmentReminderCronService, HisConfirmationService],
})
export class AppointmentReminderModule {}
