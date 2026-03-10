// apps/api/src/chatbot/chatbot.module.ts
import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { HttpModule } from '@nestjs/axios';
import { AppointmentsModule } from 'src/appointments/appointments.module';

@Module({
  imports: [
    HttpModule, // <-- 2. Lo registramos en los imports del módulo
    AppointmentsModule,
  ],
  // Registramos el controlador que recibe los webhooks
  controllers: [ChatbotController],
  // Registramos el servicio que contiene la lógica de negocio
  providers: [ChatbotService],
  // Exportamos por si en el futuro otro módulo necesita enviar mensajes
  exports: [ChatbotService],
})
export class ChatbotModule {}
