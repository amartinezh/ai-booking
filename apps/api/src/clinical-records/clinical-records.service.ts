import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClinicalRecordService {
  private readonly logger = new Logger(ClinicalRecordService.name);

  constructor(private prisma: PrismaService) {}

  async createClinicalRecord(data: any): Promise<any> {
    try {
      const { 
        appointmentId, patientId, doctorId, chiefComplaint, currentIllness, 
        physicalExam, evolutionNotes, vitalSigns, diagnoses, prescriptions 
      } = data;

      // Usando nested writes de Prisma para crear toda la cabecera e hijas a la vez
      const record = await this.prisma.clinicalRecord.create({
        data: {
          appointmentId,
          patientId,
          doctorId,
          chiefComplaint,
          currentIllness,
          physicalExam,
          evolutionNotes,
          vitalSigns: vitalSigns ? { create: vitalSigns } : undefined,
          diagnoses: diagnoses && diagnoses.length > 0 ? { create: diagnoses } : undefined,
          prescriptions: prescriptions && prescriptions.length > 0 ? { create: prescriptions } : undefined,
        },
        include: {
          vitalSigns: true,
          diagnoses: true,
          prescriptions: true,
        }
      });

      return { success: true, data: record };
    } catch (error) {
      this.logger.error('Error creating clinical record', error);
      throw error;
    }
  }

  async getClinicalRecordByAppointment(appointmentId: string): Promise<any> {
    return this.prisma.clinicalRecord.findUnique({
      where: { appointmentId },
      include: {
        vitalSigns: true,
        diagnoses: true,
        prescriptions: true,
      }
    });
  }
}
