import { Module, forwardRef } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotCron } from './chatbot.cron';
import { InboundQueueService } from './inbound-queue.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { ConsultaHisBotService } from './consulta-his-bot.service';
import { ConfirmacionHisService } from './confirmacion-his.service';
import { HttpModule } from '@nestjs/axios';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { WaitlistModule } from 'src/waitlist/waitlist.module';
import { InteractionLogModule } from 'src/interaction-log/interaction-log.module';
import { LlmModule } from '../llm/llm.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { AudioConfigModule } from '../audio-config/audio-config.module';
import { SurveyModule } from '../survey/survey.module';
import { TelegramCoreModule } from '../telegram/telegram-core.module';
import { MirrorExceptionsService } from '../mirror/mirror-exceptions.service';

@Module({
  imports: [
    HttpModule,
    AppointmentsModule,
    forwardRef(() => WaitlistModule),
    InteractionLogModule,
    LlmModule,
    WhatsappConfigModule,
    AudioConfigModule,
    SurveyModule,
    // Envío por Telegram (sin rutas: el webhook vive en TelegramModule, que
    // solo se registra con TELEGRAM_ENABLED=true).
    TelegramCoreModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotCron,
    InboundQueueService,
    KnowledgeBaseService,
    OrganizationSettingsService,
    ConsultaHisBotService,
    ConfirmacionHisService,
    // 📝 Los avisos de pacientes («no puedo ir», «número equivocado») van a la
    // misma bandeja que las excepciones del espejo. Solo depende de Prisma: se
    // provee aquí y no se importa MirrorModule, que ya depende de este módulo
    // (Mirror → Waitlist → Chatbot).
    MirrorExceptionsService,
  ],
  exports: [
    ChatbotService,
    KnowledgeBaseService,
    OrganizationSettingsService,
    // El webhook de Telegram encola en la MISMA cola que WhatsApp: un solo
    // tope de concurrencia y de backpressure para todo lo que entra.
    InboundQueueService,
  ],
})
export class ChatbotModule {}
