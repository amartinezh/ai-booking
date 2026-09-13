import { Module } from '@nestjs/common';
import { InteractionLogModule } from '../interaction-log/interaction-log.module';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
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
 */
@Module({
  imports: [InteractionLogModule, WhatsappConfigModule],
  controllers: [MassNoticeController],
  providers: [MassNoticeService],
})
export class MassNoticeModule {}
