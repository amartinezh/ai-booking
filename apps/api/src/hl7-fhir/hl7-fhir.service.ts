import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class Hl7FhirService {
  constructor(private prisma: PrismaService) {}

  /**
   * Genera la Historia Clínica Electrónica Interoperable (HCEI)
   * transformando el formato Prisma local a HL7 FHIR V4 Bundle.
   */
  async getPatientSummaryBundle(patientId: string): Promise<any> {
    // Usamos el cliente extendido para que los campos clínicos viajen descifrados
    const patientConfig = await this.prisma.extended.patientProfile.findUnique({
      where: { id: patientId },
      include: {
        eps: true,
        clinicalRecords: {
          where: { status: 'SIGNED' }, // Solo compartimos historiales ya sellados legalmente
          include: { doctor: true, appointment: true, vitalSigns: true, diagnoses: true }
        }
      }
    });

    if (!patientConfig) throw new NotFoundException('Patient not found');

    const fhirPatient = {
      resourceType: 'Patient',
      id: patientConfig.id,
      identifier: [{ system: 'urn:oid:2.16.170.1.3.1.2.1.1', value: patientConfig.cedula }],
      name: [{ text: patientConfig.fullName }],
      gender: patientConfig.gender?.toLowerCase() || 'unknown',
      birthDate: patientConfig.dateOfBirth?.toISOString().split('T')[0],
      managingOrganization: patientConfig.eps ? { display: patientConfig.eps.name } : undefined
    };

    const entries: any[] = [{ fullUrl: `Patient/${fhirPatient.id}`, resource: fhirPatient }];

    for (const record of patientConfig.clinicalRecords) {
      // Encounter resource (Appointment / Cita Médica)
      const encounterId = record.appointmentId;
      const fhirEncounter = {
        resourceType: 'Encounter',
        id: encounterId,
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: `Patient/${fhirPatient.id}` },
        period: { start: record.createdAt.toISOString() },
        reasonCode: [{ text: record.chiefComplaint }] // Desencriptado en vuelo por Prisma $extends
      };
      entries.push({ fullUrl: `Encounter/${encounterId}`, resource: fhirEncounter });

      // Composition resource (Historia Clínica Textual)
      const fhirComposition = {
        resourceType: 'Composition',
        id: record.id,
        status: 'final',
        type: { coding: [{ system: 'http://loinc.org', code: '11488-4', display: 'Consultation note' }] },
        subject: { reference: `Patient/${fhirPatient.id}` },
        encounter: { reference: `Encounter/${encounterId}` },
        date: record.updatedAt.toISOString(),
        author: [{ display: record.doctor?.fullName || 'Physician' }],
        title: 'Historia Clínica Ambulatoria',
        section: [
          { title: 'Motivo de Consulta', text: { status: 'generated', div: `<div>${record.chiefComplaint}</div>` } },
          { title: 'Enfermedad Actual', text: { status: 'generated', div: `<div>${record.currentIllness}</div>` } },
          { title: 'Notas de Evolución', text: { status: 'generated', div: `<div>${record.evolutionNotes}</div>` } }
        ]
      };
      entries.push({ fullUrl: `Composition/${record.id}`, resource: fhirComposition });

      // Observation Resource (Signos Vitales)
      if (record.vitalSigns) {
        if (record.vitalSigns.heartRate) {
           entries.push({ fullUrl: `Observation/${record.vitalSigns.id}-hr`, resource: {
             resourceType: 'Observation',
             status: 'final',
             category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
             code: { coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }] },
             subject: { reference: `Patient/${fhirPatient.id}` },
             valueQuantity: { value: record.vitalSigns.heartRate, unit: 'beats/minute', system: 'http://unitsofmeasure.org' }
           }});
        }
      }
    }

    // Regresar el objeto envuelto en la norma Bundle
    return {
      resourceType: 'Bundle',
      type: 'document',
      timestamp: new Date().toISOString(),
      entry: entries
    };
  }
}
