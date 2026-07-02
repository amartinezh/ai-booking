import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { RecordStatus } from '@agenia/database';

/**
 * 🏢 AISLAMIENTO MULTI-TENANT (PHI)
 *
 * Toda operación recibe el `organizationId` resuelto DESDE EL TOKEN por el
 * controller (@CurrentTenant) y lo aplica en el `where` de cada consulta.
 * Ninguna historia clínica puede leerse, editarse, firmarse ni adendarse
 * desde otra clínica, aunque se conozca su ID.
 */
@Injectable()
export class ClinicalRecordService {
  private readonly logger = new Logger(ClinicalRecordService.name);

  constructor(private prisma: PrismaService) {}

  async createClinicalRecord(data: any, organizationId: string): Promise<any> {
    try {
      const {
        appointmentId,
        doctorId,
        chiefComplaint,
        currentIllness,
        physicalExam,
        evolutionNotes,
        vitalSigns,
        diagnoses,
        prescriptions,
      } = data;

      // La cita ancla el tenant: debe existir y pertenecer a la clínica del
      // token. El patientId sale de la cita (no del body, que es falsificable).
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, organizationId },
        select: { id: true, patientId: true },
      });
      if (!appointment) {
        throw new NotFoundException(
          'La cita no existe o no pertenece a tu organización.',
        );
      }

      const doctor = await this.prisma.doctorProfile.findFirst({
        where: { id: doctorId, organizationId },
        select: { id: true },
      });
      if (!doctor) {
        throw new ForbiddenException(
          'El médico indicado no pertenece a tu organización.',
        );
      }

      // El campo status es automáticamente 'DRAFT' y el 'recordNumber' autoincrementa
      const record = await this.prisma.extended.clinicalRecord.create({
        data: {
          appointmentId,
          patientId: appointment.patientId,
          doctorId,
          organizationId,
          chiefComplaint,
          currentIllness,
          physicalExam,
          evolutionNotes,
          vitalSigns: vitalSigns ? { create: vitalSigns } : undefined,
          diagnoses:
            diagnoses && diagnoses.length > 0
              ? { create: diagnoses }
              : undefined,
          prescriptions:
            prescriptions && prescriptions.length > 0
              ? { create: prescriptions }
              : undefined,
        },
        include: { vitalSigns: true, diagnoses: true, prescriptions: true },
      });

      return { success: true, data: record };
    } catch (error) {
      this.logger.error('Error creating clinical record', error);
      throw error;
    }
  }

  // SPRINT 2 - AUTOSAVE CON CANDADO LEGAL
  async updateClinicalRecord(
    id: string,
    data: any,
    organizationId: string,
  ): Promise<any> {
    const existing = await this.prisma.extended.clinicalRecord.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(
        `No se encontró la historia clínica con ID: ${id}`,
      );
    }

    // Candado Principal de Inmutabilidad
    if (existing.status !== RecordStatus.DRAFT) {
      this.logger.warn(
        `Intento bloqueado de editar HC ${id} en estado ${existing.status}`,
      );
      throw new ForbiddenException(
        'El registro ya ha sido firmado y no puede ser modificado. Debe generar un Addendum (Nota aclaratoria).',
      );
    }

    // Si es DRAFT, permitimos actualizar ("Autoguardado")

    // Whitelist explícito de campos editables: el body NO puede reasignar
    // tenant, paciente, médico, cita ni estado (mass-assignment).
    const { vitalSigns, diagnoses, prescriptions } = data;
    const prismaUpdateData: any = {
      chiefComplaint: data.chiefComplaint,
      currentIllness: data.currentIllness,
      physicalExam: data.physicalExam,
      evolutionNotes: data.evolutionNotes,
    };

    if (vitalSigns) {
      prismaUpdateData.vitalSigns = {
        upsert: {
          create: vitalSigns,
          update: vitalSigns,
        },
      };
    }

    if (diagnoses && Array.isArray(diagnoses)) {
      prismaUpdateData.diagnoses = {
        deleteMany: {}, // Borrón y cuenta nueva en DRAFT mode
        create: diagnoses,
      };
    }

    if (prescriptions && Array.isArray(prescriptions)) {
      prismaUpdateData.prescriptions = {
        deleteMany: {},
        create: prescriptions,
      };
    }

    return this.prisma.extended.clinicalRecord.update({
      where: { id },
      data: prismaUpdateData,
    });
  }

  // SPRINT 2 - FLUJO DE FIRMA DIGITAL Y SELLO DE TIEMPO
  // `userId` es el usuario AUTENTICADO (token); el controller nunca lo toma
  // del body para que la firma sea de verdad no-repudiable.
  async signClinicalRecord(
    id: string,
    userId: string,
    organizationId: string,
    ipAddress?: string,
  ): Promise<any> {
    const existing = await this.prisma.extended.clinicalRecord.findFirst({
      where: { id, organizationId },
      include: { vitalSigns: true, diagnoses: true, prescriptions: true },
    });

    if (!existing) throw new NotFoundException('Clinical record not found');
    if (existing.status !== RecordStatus.DRAFT) {
      throw new ForbiddenException(
        'La historia ya ha sido firmada previamente.',
      );
    }

    // 1. Generar Hash SHA-256 para el "No Repudio"
    const timestamp = new Date();
    const contentToHash = JSON.stringify(existing);
    const hash = crypto
      .createHash('sha256')
      .update(`${contentToHash}|${timestamp.toISOString()}`)
      .digest('hex');

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
        },
      });

      // Cambiar estado a SIGNED bloqueando ediciones futuras
      return tx.clinicalRecord.update({
        where: { id },
        data: { status: RecordStatus.SIGNED },
        include: { signature: true },
      });
    });
  }

  // SPRINT 2 - CREACIÓN DE ADENDAS PARA HISTORIAS FIRMADAS
  // `signerUserId` viene del token: la firma digital de la adenda registra al
  // usuario autenticado, no al DoctorProfile.id que enviara el body.
  async createAddendum(
    clinicalRecordId: string,
    doctorId: string,
    content: string,
    organizationId: string,
    signerUserId: string,
    ipAddress?: string,
  ): Promise<any> {
    const existing = await this.prisma.extended.clinicalRecord.findFirst({
      where: { id: clinicalRecordId, organizationId },
    });
    if (!existing) throw new NotFoundException('Clinical record not found');

    if (existing.status === RecordStatus.DRAFT) {
      throw new ForbiddenException(
        'No puede crear una adenda si la historia clínica sigue en modo Borrador. Modifíquela directamente.',
      );
    }

    const doctor = await this.prisma.doctorProfile.findFirst({
      where: { id: doctorId, organizationId },
      select: { id: true },
    });
    if (!doctor) {
      throw new ForbiddenException(
        'El médico indicado no pertenece a tu organización.',
      );
    }

    const timestamp = new Date();
    const hash = crypto
      .createHash('sha256')
      .update(`${content}|${timestamp.toISOString()}`)
      .digest('hex');

    return this.prisma.extended.$transaction(async (tx: any) => {
      const addendum = await tx.addendum.create({
        data: {
          content,
          doctorId,
          clinicalRecordId,
        },
      });

      // Cada adenda debe llevar su propia traza y firma digital
      await tx.digitalSignature.create({
        data: {
          userId: signerUserId,
          ipAddress,
          timestamp,
          hashedContent: hash,
          addendumId: addendum.id,
        },
      });

      return tx.addendum.findUnique({
        where: { id: addendum.id },
        include: { signature: true },
      });
    });
  }

  // Lectura scoped al tenant. Si quien consulta es un PACIENTE, además debe
  // ser el dueño de la historia (un paciente jamás lee historias ajenas).
  async getClinicalRecordByAppointment(
    appointmentId: string,
    organizationId: string,
    requester: { userId: string; role: string },
  ): Promise<any> {
    const record = await this.prisma.extended.clinicalRecord.findFirst({
      where: { appointmentId, organizationId },
      include: {
        vitalSigns: true,
        diagnoses: true,
        prescriptions: true,
        signature: true,
        addendums: {
          include: { signature: true },
        },
        patient: { select: { userId: true } },
      },
    });

    if (!record) return null;

    if (requester.role === 'PATIENT' && record.patient?.userId !== requester.userId) {
      throw new ForbiddenException(
        'Solo puedes consultar tu propia historia clínica.',
      );
    }

    // No exponer la relación auxiliar usada para el chequeo de propiedad.
    const result = { ...record };
    delete result.patient;
    return result;
  }
}
