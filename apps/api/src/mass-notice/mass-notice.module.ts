import { Module } from '@nestjs/common';
import { InteractionLogModule } from '../interaction-log/interaction-log.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { MirrorModule } from '../mirror/mirror.module';
import { MassNoticeService } from './mass-notice.service';
import { MassNoticeController } from './mass-notice.controller';

/**
 * Avisos masivos (cancelación pasiva por WhatsApp) — EXCLUSIVO del driver
 * cnt-sanvicente-anserma. Ver docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md.
 *
 * Módulo aislado a propósito, igual que `AppointmentReminderModule`: cruza
 * WhatsappConfig + InteractionLog + SystemLog, pero no es del dominio de
 * citas ni del motor de espejo (ver §4 del plan — nunca toca `Appointment`
 * por FK, ni `SyncOutbox`). `PrismaModule`/`SystemLogModule` son `@Global()`
 * y no se importan aquí.
 *
 * Importa `MirrorModule` (Fase 2, §5) solo para inyectar `MirrorNoticeService`
 * en `MassNoticeController` — los dos endpoints de "pedirle la lista al
 * agente" que llama STAFF (JWT), no el agente mismo. No crea ciclo:
 * `MirrorModule` no conoce este módulo.
 */
@Module({
  imports: [InteractionLogModule, WhatsappConfigModule, MirrorModule],
  controllers: [MassNoticeController],
  providers: [MassNoticeService],
})
export class MassNoticeModule {}
