import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { MirrorController } from './mirror.controller';
import { MirrorAgentGuard } from './mirror-agent.guard';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorApplyService } from './mirror-apply.service';
import { MirrorSchemaCheckService } from './mirror-schema-check.service';

/**
 * Motor genérico de espejo de citas con HIS externos (patrón de drivers).
 * Ver docs/PLAN_ESPEJO_HOSPITAL.md. Este módulo es 100% agnóstico al driver:
 * nunca debe importar ni mencionar nada específico de un HIS (nombre de
 * tabla, formato de fecha de un proveedor) — eso vive exclusivamente en
 * apps/mirror-agent/src/drivers/<driverKey>/.
 */
@Module({
  imports: [AppointmentsModule],
  controllers: [MirrorController],
  providers: [
    MirrorAgentGuard,
    MirrorDispatchService,
    MirrorApplyService,
    // Grita al arrancar si el DDL del espejo no llegó a la base. Ver la nota
    // larga en mirror-schema-check.service.ts.
    MirrorSchemaCheckService,
  ],
  exports: [MirrorApplyService],
})
export class MirrorModule {}
