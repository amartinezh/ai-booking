import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { MirrorController } from './mirror.controller';
import { MirrorAgentGuard } from './mirror-agent.guard';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorApplyService } from './mirror-apply.service';
import { MirrorSchemaCheckService } from './mirror-schema-check.service';
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { MirrorAvailabilityService } from './mirror-availability.service';
import { MirrorCatalogService } from './mirror-catalog.service';
import { MirrorNoticeService } from './mirror-notice.service';

/**
 * Motor genérico de espejo de citas con HIS externos (patrón de drivers).
 * Ver docs/PLAN_ESPEJO_HOSPITAL.md. Este módulo es 100% agnóstico al driver:
 * nunca debe importar ni mencionar nada específico de un HIS (nombre de
 * tabla, formato de fecha de un proveedor) — eso vive exclusivamente en
 * apps/mirror-agent/src/drivers/<driverKey>/.
 */
@Module({
  // WaitlistModule: una cancelación nacida en el HIS libera el cupo y hay que
  // avisarle a quien lleva días esperando — ver `avisarListaDeEspera` en
  // mirror-apply.service.ts. No necesita `forwardRef`: la cadena es
  // Mirror → Waitlist → Chatbot y el chatbot no conoce al espejo.
  imports: [AppointmentsModule, WaitlistModule],
  controllers: [MirrorController],
  providers: [
    MirrorAgentGuard,
    MirrorDispatchService,
    MirrorApplyService,
    // Grita al arrancar si el DDL del espejo no llegó a la base. Ver la nota
    // larga en mirror-schema-check.service.ts.
    MirrorSchemaCheckService,
    MirrorReconciliationService,
    MirrorAvailabilityService,
    MirrorCatalogService,
    // 📣 Avisos masivos, Fase 2 (fuente espejo) — EXCLUSIVO del driver
    // cnt-sanvicente-anserma. Ver mirror-notice.service.ts para por qué vive
    // aquí y no en mass-notice/.
    MirrorNoticeService,
  ],
  exports: [
    MirrorApplyService,
    MirrorReconciliationService,
    MirrorNoticeService,
  ],
})
export class MirrorModule {}
