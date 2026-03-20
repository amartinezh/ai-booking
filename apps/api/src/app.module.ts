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
    // Nuestro módulo de IA / Webhooks
    ChatbotModule,
    RedisModule,
    AppointmentsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
