import { Module, forwardRef } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotCron } from './chatbot.cron';
import { HttpModule } from '@nestjs/axios';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { WaitlistModule } from 'src/waitlist/waitlist.module';

@Module({
  imports: [
    HttpModule,
    AppointmentsModule,
    forwardRef(() => WaitlistModule),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotCron],
  exports: [ChatbotService],
})
export class ChatbotModule { }