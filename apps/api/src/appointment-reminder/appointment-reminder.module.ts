import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { InteractionLogModule } from '../interaction-log/interaction-log.module';
import { AppointmentReminderCronService } from './appointment-reminder.cron';

/**
 * Módulo independiente para el cron de recordatorios.
 *
 * Vive separado de AppointmentsModule a propósito: ese módulo es de
 * dominio (CRUD de citas), y los recordatorios son un job operativo
 * que cruza Chatbot + InteractionLog + SystemLog. Aislarlo aquí evita
 * dependencias circulares con ChatbotModule (que ya importa
 * AppointmentsModule) y mantiene el árbol de módulos limpio.
 */
@Module({
  imports: [ChatbotModule, InteractionLogModule],
  providers: [AppointmentReminderCronService],
})
export class AppointmentReminderModule {}
