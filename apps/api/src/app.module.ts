// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { RedisModule } from './redis/redis.module';
import { join } from 'path';
import { AppointmentsModule } from './appointments/appointments.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ClinicalRecordsModule } from './clinical-records/clinical-records.module';
import { Hl7FhirModule } from './hl7-fhir/hl7-fhir.module';
import { ClinicalAiModule } from './clinical-ai/clinical-ai.module';
import { SystemLogModule } from './system-log/system-log.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { LlmModule } from './llm/llm.module';
import { WhatsappConfigModule } from './whatsapp-config/whatsapp-config.module';
import { AppointmentReminderModule } from './appointment-reminder/appointment-reminder.module';
import { GlobalStatsModule } from './global-stats/global-stats.module';
import { OrganizationsModule } from './organizations/organizations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'), // <-- Forzamos la ruta exacta
    }),
    ScheduleModule.forRoot(),
    // Cargamos las variables de entorno (.env) globalmente
    //ConfigModule.forRoot({ isGlobal: true }),
    // Módulo de base de datos (Global)
    PrismaModule,
    // 🩻 Auditoría / logging global (Global) — debe ir temprano para que
    // el GlobalExceptionFilter ya esté disponible cuando se registre en main.ts
    SystemLogModule,
    // 🔐 Cifrado simétrico AES-256-GCM (Global) — usado por LlmModule y otros.
    CryptoModule,
    // 🧠 Multi-LLM dinámico por clínica (Gemini / ChatGPT / Claude).
    LlmModule,
    // 📱 Canal WhatsApp Business (credenciales encriptadas por clínica).
    WhatsappConfigModule,
    // Nuestro módulo de IA / Webhooks
    ChatbotModule,
    // ⏰ Cron de recordatorios de citas por WhatsApp (horas hábiles).
    // Va DESPUÉS de ChatbotModule porque consume ChatbotService.
    AppointmentReminderModule,
    RedisModule,
    AppointmentsModule,
    AnalyticsModule,
    GlobalStatsModule,
    // 🏢 Acciones críticas del Super Admin sobre tenants (purge + quick-stats).
    OrganizationsModule,
    ClinicalRecordsModule,
    ClinicalAiModule,
    Hl7FhirModule,
  ],
})
export class AppModule { }
