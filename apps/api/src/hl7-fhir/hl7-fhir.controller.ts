import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Hl7FhirService } from './hl7-fhir.service';
import { TenantRbacGuard } from '../common/guards/tenant-rbac.guard';

@Controller('fhir/v4')
export class Hl7FhirController {
  constructor(private readonly hl7FhirService: Hl7FhirService) {}

  @Get('Patient/:patientId/$document')
  @UseGuards(TenantRbacGuard)
  async getPatientDocument(@Param('patientId') patientId: string) {
    // Genera y devuelve el 'FHIR Document Bundle' del paciente
    return this.hl7FhirService.getPatientSummaryBundle(patientId);
  }
}
