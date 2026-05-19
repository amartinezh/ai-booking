import { Module, forwardRef } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotCron } from './chatbot.cron';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { HttpModule } from '@nestjs/axios';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { WaitlistModule } from 'src/waitlist/waitlist.module';
import { InteractionLogModule } from 'src/interaction-log/interaction-log.module';
import { LlmModule } from '../llm/llm.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';

@Module({
  imports: [
    HttpModule,
    AppointmentsModule,
    forwardRef(() => WaitlistModule),
    InteractionLogModule,
    LlmModule,
    WhatsappConfigModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotCron, KnowledgeBaseService, OrganizationSettingsService],
  exports: [ChatbotService, KnowledgeBaseService, OrganizationSettingsService],
})
export class ChatbotModule { }