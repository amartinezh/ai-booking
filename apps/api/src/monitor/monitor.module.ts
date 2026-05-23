import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { MonitorCheckers } from './monitor.checkers';
import { MonitorCron } from './monitor.cron';

/**
 * 📡 Monitor de Servicios externos (Google / Meta) — arquitectura dual.
 *
 *  - MODO A (MonitorCron): centinela en background, persiste incidentes.
 *  - MODO B (MonitorController#liveCheck): diagnóstico en vivo, efímero.
 *
 * Reutiliza `IntegrationsModule` (IntegrationsService) para los checks de
 * Gemini y Meta. `PrismaModule` es global, no se importa aquí.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [MonitorController],
  providers: [MonitorService, MonitorCheckers, MonitorCron],
})
export class MonitorModule {}
