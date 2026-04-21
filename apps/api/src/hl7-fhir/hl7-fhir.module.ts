import { Module } from '@nestjs/common';
import { Hl7FhirService } from './hl7-fhir.service';
import { Hl7FhirController } from './hl7-fhir.controller';

@Module({
  controllers: [Hl7FhirController],
  providers: [Hl7FhirService],
  exports: [Hl7FhirService],
})
export class Hl7FhirModule {}
