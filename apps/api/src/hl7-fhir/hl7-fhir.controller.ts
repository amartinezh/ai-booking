import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Hl7FhirService } from './hl7-fhir.service';
import { TenantRbacGuard } from '../common/guards/tenant-rbac.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtUserPayload } from '../common/current-user.decorator';

@Controller('fhir/v4')
export class Hl7FhirController {
  constructor(private readonly hl7FhirService: Hl7FhirService) {}

  // 🔐 Orden de guards deliberado: `RolesGuard` valida el JWT y deja el payload
  // en `request.user` (sin él, `TenantRbacGuard` no tiene actor y falla cerrado);
  // luego `TenantRbacGuard` exige que el paciente sea del MISMO tenant y, para
  // médicos, que exista relación terapéutica.
  @Get('Patient/:patientId/$document')
  @UseGuards(RolesGuard, TenantRbacGuard)
  @Roles('SUPER_ADMIN', 'ORG_ADMIN', 'DOCTOR')
  async getPatientDocument(
    @Param('patientId') patientId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    // Genera y devuelve el 'FHIR Document Bundle' del paciente.
    // SUPER_ADMIN es el único rol sin tenant: para él el bundle no se acota.
    return this.hl7FhirService.getPatientSummaryBundle(
      patientId,
      user.role === 'SUPER_ADMIN' ? null : (user.organizationId ?? null),
    );
  }
}
