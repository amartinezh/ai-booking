import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { RecordStatus } from '@antigravity/database';

@Injectable()
export class ClinicalRecordService {
  private readonly logger = new Logger(ClinicalRecordService.name);

  constructor(private prisma: PrismaService) {}

  async createClinicalRecord(data: any): Promise<any> {
    try {
      const { 
        appointmentId, patientId, doctorId, chiefComplaint, currentIllness, 
        physicalExam, evolutionNotes, vitalSigns, diagnoses, prescriptions,
        organizationId
      } = data;

      // El campo status es automáticamente 'DRAFT' y el 'recordNumber' autoincrementa
      const record = await this.prisma.extended.clinicalRecord.create({
        data: {
          appointmentId,
          patientId,
          doctorId,
          organizationId,
          chiefComplaint,
          currentIllness,
          physicalExam,
          evolutionNotes,
          vitalSigns: vitalSigns ? { create: vitalSigns } : undefined,
          diagnoses: diagnoses && diagnoses.length > 0 ? { create: diagnoses } : undefined,
          prescriptions: prescriptions && prescriptions.length > 0 ? { create: prescriptions } : undefined,
        },
        include: { vitalSigns: true, diagnoses: true, prescriptions: true }
      });

      return { success: true, data: record };
    } catch (error) {
      this.logger.error('Error creating clinical record', error);
      throw error;
    }
  }

  // SPRINT 2 - AUTOSAVE CON CANDADO LEGAL
  async updateClinicalRecord(id: string, data: any): Promise<any> {
    const existing = await this.prisma.extended.clinicalRecord.findUnique({ where: { id } });
    
    if (!existing) {
      throw new NotFoundException(`No se encontró la historia clínica con ID: ${id}`);
    }

    // Candado Principal de Inmutabilidad
    if (existing.status !== RecordStatus.DRAFT) {
      this.logger.warn(`Intento bloqueado de editar HC ${id} en estado ${existing.status}`);
      throw new ForbiddenException(
        'El registro ya ha sido firmado y no puede ser modificado. Debe generar un Addendum (Nota aclaratoria).'
      );
    }

    // Si es DRAFT, permitimos actualizar ("Autoguardado")
    
    // Mapeo defensivo de relaciones Prisma para un update
    const { vitalSigns, diagnoses, prescriptions, ...scalarData } = data;
    const prismaUpdateData: any = { ...scalarData };

    if (vitalSigns) {
      prismaUpdateData.vitalSigns = {
        upsert: {
          create: vitalSigns,
          update: vitalSigns
        }
      };
    }

    if (diagnoses && Array.isArray(diagnoses)) {
      prismaUpdateData.diagnoses = {
        deleteMany: {}, // Borrón y cuenta nueva en DRAFT mode
        create: diagnoses
      };
    }

    if (prescriptions && Array.isArray(prescriptions)) {
      prismaUpdateData.prescriptions = {
        deleteMany: {},
        create: prescriptions
      };
    }

    return this.prisma.extended.clinicalRecord.update({
      where: { id },
      data: prismaUpdateData,
    });
  }

  // SPRINT 2 - FLUJO DE FIRMA DIGITAL Y SELLO DE TIEMPO
  async signClinicalRecord(id: string, userId: string, ipAddress?: string): Promise<any> {
    const existing = await this.prisma.extended.clinicalRecord.findUnique({
      where: { id },
      include: { vitalSigns: true, diagnoses: true, prescriptions: true }
    });

    if (!existing) throw new NotFoundException('Clinical record not found');
    if (existing.status !== RecordStatus.DRAFT) {
      throw new ForbiddenException('La historia ya ha sido firmada previamente.');
    }

    // 1. Generar Hash SHA-256 para el "No Repudio"
    const timestamp = new Date();
    const contentToHash = JSON.stringify(existing);
    const hash = crypto.createHash('sha256').update(`${contentToHash}|${timestamp.toISOString()}`).digest('hex');

    // 2. Transacción Atómica: Sellar HC y crear la firma
    return this.prisma.extended.$transaction(async (tx: any) => {
      // Registrar firma digital
      await tx.digitalSignature.create({
        data: {
          userId,
          ipAddress,
          timestamp,
          hashedContent: hash,
          clinicalRecordId: id,
        }
      });

      // Cambiar estado a SIGNED bloqueando ediciones futuras
      return tx.clinicalRecord.update({
        where: { id },
        data: { status: RecordStatus.SIGNED },
        include: { signature: true }
      });
    });
  }

  // SPRINT 2 - CREACIÓN DE ADENDAS PARA HISTORIAS FIRMADAS
  async createAddendum(clinicalRecordId: string, doctorId: string, content: string, ipAddress?: string): Promise<any> {
    const existing = await this.prisma.extended.clinicalRecord.findUnique({ where: { id: clinicalRecordId } });
    if (!existing) throw new NotFoundException('Clinical record not found');

    if (existing.status === RecordStatus.DRAFT) {
      throw new ForbiddenException('No puede crear una adenda si la historia clínica sigue en modo Borrador. Modifíquela directamente.');
    }

    const timestamp = new Date();
    const hash = crypto.createHash('sha256').update(`${content}|${timestamp.toISOString()}`).digest('hex');

    return this.prisma.extended.$transaction(async (tx: any) => {
      const addendum = await tx.addendum.create({
        data: {
          content,
          doctorId,
          clinicalRecordId,
        }
      });

      // Cada adenda debe llevar su propia traza y firma digital
      await tx.digitalSignature.create({
        data: {
          userId: doctorId,
          ipAddress,
          timestamp,
          hashedContent: hash,
          addendumId: addendum.id,
        }
      });

      return tx.addendum.findUnique({
        where: { id: addendum.id },
        include: { signature: true }
      });
    });
  }

  async getClinicalRecordByAppointment(appointmentId: string): Promise<any> {
    return this.prisma.extended.clinicalRecord.findUnique({
      where: { appointmentId },
      include: {
        vitalSigns: true,
        diagnoses: true,
        prescriptions: true,
        signature: true,
        addendums: {
          include: { signature: true }
        }
      }
    });
  }
}
