import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { MirrorController } from './mirror.controller';
import { MirrorAgentGuard } from './mirror-agent.guard';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorApplyService } from './mirror-apply.service';
import { MirrorPatientService } from './mirror-patient.service';
import { MirrorSchemaCheckService } from './mirror-schema-check.service';
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { MirrorAvailabilityService } from './mirror-availability.service';
import { MirrorCatalogService } from './mirror-catalog.service';
import { MirrorNoticeService } from './mirror-notice.service';
import { MirrorLookupService } from './mirror-lookup.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import { MirrorAlertService } from './mirror-alert.service';
import { MirrorWatchdogService } from './mirror-watchdog.service';
import { AvisoCambioHospitalService } from './aviso-cambio-hospital.service';
import { WhatsappConfigModule } from '../whatsapp-config/whatsapp-config.module';
import { MedicosNuevosService } from './medicos-nuevos.service';
import { MedicosNuevosController } from './medicos-nuevos.controller';

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
  // WhatsappConfigModule: el aviso al agendador sale por una plantilla aprobada
  // (`WhatsappTemplateService`). No crea ciclo: no conoce este módulo.
  imports: [AppointmentsModule, WaitlistModule, WhatsappConfigModule],
  controllers: [MirrorController, MedicosNuevosController],
  providers: [
    MirrorAgentGuard,
    MirrorDispatchService,
    MirrorApplyService,
    MirrorPatientService,
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
    // 🔎 Consulta en vivo al HIS (rastreo de paciente, Fase 2): el lado del
    // agente (pendientes / resultado) y el cron que expira y purga.
    MirrorLookupService,
    // 🚨 Vigilante y bandeja de excepciones (Fase 3 del rastreo): el cron que abre
    // y cierra las excepciones, el ciclo de vida en la base y el aviso al agendador.
    MirrorExceptionsService,
    MirrorAlertService,
    MirrorWatchdogService,
    // 🏥 El hospital cancela o cambia una cita del asistente: aviso al paciente y
    // caso en la Bandeja (2026-10-22).
    AvisoCambioHospitalService,
    // 🩺 Médicos del hospital con citas que AgenIA aún no tiene: caso en la Bandeja,
    // botón «Crear y homologar» y homologación automática (2026-10-24).
    MedicosNuevosService,
  ],
  exports: [
    MirrorApplyService,
    MirrorReconciliationService,
    MirrorNoticeService,
  ],
})
export class MirrorModule {}
