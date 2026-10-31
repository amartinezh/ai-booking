import { Module, forwardRef } from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { CuposLibresListaService } from './cupos-libres-lista.service';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [forwardRef(() => ChatbotModule), AppointmentsModule],
  providers: [WaitlistService, CuposLibresListaService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
