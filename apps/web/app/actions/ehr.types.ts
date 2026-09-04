// Tipos "cliente-safe" para las acciones de Historia Clínica Electrónica.
// Espejo de los DTO de `apps/api/src/clinical-records/clinical-records.service.ts`
// (no se importa cruzado entre apps — web y api son despliegues independientes).

export interface VitalSignsInput {
    bloodPressure?: string;
    heartRate?: number;
    temperature?: number;
    weight?: number;
    height?: number;
    oxygenSat?: number;
}

export interface DiagnosisInput {
    code?: string;
    description: string;
    isMain?: boolean;
}

export interface PrescriptionInput {
    medication: string;
    dose: string;
    frequency: string;
    duration: string;
    notes?: string;
}

export interface CreateClinicalRecordDto {
    appointmentId: string;
    doctorId: string;
    chiefComplaint: string;
    currentIllness: string;
    physicalExam?: string;
    evolutionNotes?: string;
    vitalSigns?: VitalSignsInput;
    diagnoses?: DiagnosisInput[];
    prescriptions?: PrescriptionInput[];
}

export type UpdateClinicalRecordDto = Partial<CreateClinicalRecordDto>;
