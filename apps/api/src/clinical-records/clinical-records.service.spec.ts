import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClinicalRecordService } from './clinical-records.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════════
// 🏢 AISLAMIENTO MULTI-TENANT DE HISTORIAS CLÍNICAS (PHI)
// Toda operación debe filtrar por el organizationId del token; un
// paciente solo puede leer SU propia historia; y el body jamás
// puede reasignar tenant/paciente/médico/estado (mass-assignment).
// ═══════════════════════════════════════════════════════════════
describe('ClinicalRecordService — aislamiento de tenant', () => {
  const ORG_A = 'org-a';

  let service: ClinicalRecordService;
  let prisma: any;

  beforeEach(async () => {
    const extendedClinicalRecord = {
      findFirst: jest.fn(() => null),
      create: jest.fn((args: any) => ({ id: 'hc-1', ...args.data })),
      update: jest.fn((args: any) => ({ id: args.where.id })),
    };
    prisma = {
      appointment: { findFirst: jest.fn(() => null) },
      doctorProfile: { findFirst: jest.fn(() => null) },
      extended: {
        clinicalRecord: extendedClinicalRecord,
        $transaction: jest.fn((fn: any) =>
          fn({
            digitalSignature: { create: jest.fn(() => ({})) },
            clinicalRecord: {
              update: jest.fn(() => ({ id: 'hc-1', status: 'SIGNED' })),
            },
            addendum: {
              create: jest.fn(() => ({ id: 'ad-1' })),
              findUnique: jest.fn(() => ({ id: 'ad-1' })),
            },
          }),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClinicalRecordService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ClinicalRecordService>(ClinicalRecordService);
  });

  describe('createClinicalRecord', () => {
    it('rechaza citas de otra organización (lookup scoped devuelve null)', async () => {
      await expect(
        service.createClinicalRecord(
          { appointmentId: 'apt-de-org-b', doctorId: 'doc-1' },
          ORG_A,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-de-org-b', organizationId: ORG_A },
        }),
      );
      expect(prisma.extended.clinicalRecord.create).not.toHaveBeenCalled();
    });

    it('rechaza médicos de otra organización', async () => {
      prisma.appointment.findFirst.mockResolvedValueOnce({
        id: 'apt-1',
        patientId: 'pat-1',
      });

      await expect(
        service.createClinicalRecord(
          { appointmentId: 'apt-1', doctorId: 'doc-de-org-b' },
          ORG_A,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.extended.clinicalRecord.create).not.toHaveBeenCalled();
    });

    it('fuerza organizationId del token y patientId de la cita (ignora el body)', async () => {
      prisma.appointment.findFirst.mockResolvedValueOnce({
        id: 'apt-1',
        patientId: 'pat-real',
      });
      prisma.doctorProfile.findFirst.mockResolvedValueOnce({ id: 'doc-1' });

      await service.createClinicalRecord(
        {
          appointmentId: 'apt-1',
          doctorId: 'doc-1',
          // Intento de inyección: el body trae otro tenant y otro paciente.
          organizationId: 'org-b',
          patientId: 'pat-ajeno',
          chiefComplaint: 'Dolor',
          currentIllness: 'Actual',
        },
        ORG_A,
      );

      const created = prisma.extended.clinicalRecord.create.mock.calls[0][0];
      expect(created.data.organizationId).toBe(ORG_A);
      expect(created.data.patientId).toBe('pat-real');
    });
  });

  describe('updateClinicalRecord', () => {
    it('NotFound si la historia pertenece a otra organización', async () => {
      await expect(
        service.updateClinicalRecord('hc-de-org-b', {}, ORG_A),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.extended.clinicalRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hc-de-org-b', organizationId: ORG_A },
        }),
      );
    });

    it('whitelist: el body no puede reasignar tenant, médico ni estado', async () => {
      prisma.extended.clinicalRecord.findFirst.mockResolvedValueOnce({
        id: 'hc-1',
        status: 'DRAFT',
      });

      await service.updateClinicalRecord(
        'hc-1',
        {
          chiefComplaint: 'Actualizado',
          // Campos maliciosos que antes se colaban vía spread:
          organizationId: 'org-b',
          doctorId: 'doc-intruso',
          patientId: 'pat-intruso',
          status: 'SIGNED',
        },
        ORG_A,
      );

      const updated = prisma.extended.clinicalRecord.update.mock.calls[0][0];
      expect(updated.data.chiefComplaint).toBe('Actualizado');
      expect(updated.data).not.toHaveProperty('organizationId');
      expect(updated.data).not.toHaveProperty('doctorId');
      expect(updated.data).not.toHaveProperty('patientId');
      expect(updated.data).not.toHaveProperty('status');
    });

    it('mantiene el candado legal: no edita historias firmadas', async () => {
      prisma.extended.clinicalRecord.findFirst.mockResolvedValueOnce({
        id: 'hc-1',
        status: 'SIGNED',
      });

      await expect(
        service.updateClinicalRecord('hc-1', { chiefComplaint: 'x' }, ORG_A),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('signClinicalRecord', () => {
    it('NotFound si la historia es de otra organización', async () => {
      await expect(
        service.signClinicalRecord('hc-de-org-b', 'user-1', ORG_A),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.extended.clinicalRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hc-de-org-b', organizationId: ORG_A },
        }),
      );
    });
  });

  describe('createAddendum', () => {
    it('NotFound si la historia es de otra organización', async () => {
      await expect(
        service.createAddendum('hc-de-org-b', 'doc-1', 'nota', ORG_A, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza doctorId de otra organización', async () => {
      prisma.extended.clinicalRecord.findFirst.mockResolvedValueOnce({
        id: 'hc-1',
        status: 'SIGNED',
      });

      await expect(
        service.createAddendum('hc-1', 'doc-de-org-b', 'nota', ORG_A, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getClinicalRecordByAppointment', () => {
    it('filtra por organización del token', async () => {
      await service.getClinicalRecordByAppointment('apt-1', ORG_A, {
        userId: 'user-1',
        role: 'DOCTOR',
      });

      expect(prisma.extended.clinicalRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { appointmentId: 'apt-1', organizationId: ORG_A },
        }),
      );
    });

    it('un PACIENTE no puede leer la historia de otro paciente', async () => {
      prisma.extended.clinicalRecord.findFirst.mockResolvedValueOnce({
        id: 'hc-1',
        patient: { userId: 'user-dueño' },
      });

      await expect(
        service.getClinicalRecordByAppointment('apt-1', ORG_A, {
          userId: 'user-intruso',
          role: 'PATIENT',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('el dueño sí puede leer su historia (y no se expone la relación auxiliar)', async () => {
      prisma.extended.clinicalRecord.findFirst.mockResolvedValueOnce({
        id: 'hc-1',
        chiefComplaint: 'Dolor',
        patient: { userId: 'user-dueño' },
      });

      const result = await service.getClinicalRecordByAppointment(
        'apt-1',
        ORG_A,
        { userId: 'user-dueño', role: 'PATIENT' },
      );

      expect(result.id).toBe('hc-1');
      expect(result).not.toHaveProperty('patient');
    });
  });
});
