import { Test, TestingModule } from '@nestjs/testing';
import { MirrorApplyService } from './mirror-apply.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CanonicalChangeEvent } from './dto/mirror.types';

describe('MirrorApplyService', () => {
  let service: MirrorApplyService;
  let prisma: {
    syncInbox: { findUnique: jest.Mock; create: jest.Mock };
    syncAudit: { create: jest.Mock };
    appointment: { findFirst: jest.Mock; update: jest.Mock };
    scheduleSlot: { update: jest.Mock; findFirst: jest.Mock };
    mirrorEntityMap: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let appointmentsService: {
    bookAppointment: jest.Mock;
    updateAttendance: jest.Mock;
  };

  const insertEvent = (
    overrides: Partial<CanonicalChangeEvent> = {},
  ): CanonicalChangeEvent => ({
    eventId: 'evt-1',
    entityType: 'APPOINTMENT',
    op: 'INSERT',
    occurredAtIso: new Date().toISOString(),
    payload: {
      agenIAPatientId: 'p1',
      agenIAScheduleSlotId: 's1',
    },
    ...overrides,
  });

  beforeEach(async () => {
    const tx = {
      appointment: { findFirst: jest.fn(), update: jest.fn() },
      scheduleSlot: { update: jest.fn(), findFirst: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    prisma = {
      syncInbox: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(),
      },
      syncAudit: { create: jest.fn() },
      appointment: tx.appointment,
      scheduleSlot: tx.scheduleSlot,
      mirrorEntityMap: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    appointmentsService = {
      bookAppointment: jest.fn(() =>
        Promise.resolve({ success: true, appointmentId: 'apt1' }),
      ),
      updateAttendance: jest.fn(() => Promise.resolve({ success: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorApplyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppointmentsService, useValue: appointmentsService },
      ],
    }).compile();

    service = module.get<MirrorApplyService>(MirrorApplyService);
  });

  describe('idempotencia', () => {
    it('event_id ya visto (en SyncInbox) → SKIPPED, nunca vuelve a llamar bookAppointment', async () => {
      prisma.syncInbox.findUnique.mockResolvedValueOnce({
        id: 'x',
        eventId: 'evt-1',
      });

      const result = await service.applyBatch('org1', [insertEvent()]);

      expect(result).toEqual({
        applied: 0,
        skipped: 1,
        conflicts: 0,
        errors: 0,
      });
      expect(appointmentsService.bookAppointment).not.toHaveBeenCalled();
    });

    it('event_id nuevo → se aplica UNA vez y se registra en SyncInbox', async () => {
      const result = await service.applyBatch('org1', [insertEvent()]);

      expect(result).toEqual({
        applied: 1,
        skipped: 0,
        conflicts: 0,
        errors: 0,
      });
      expect(appointmentsService.bookAppointment).toHaveBeenCalledTimes(1);
      expect(prisma.syncInbox.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org1',
          eventId: 'evt-1',
          entityType: 'APPOINTMENT',
        },
      });
    });
  });

  describe('orden — un evento fallido no bloquea el resto del lote', () => {
    it('procesa TODOS los eventos aunque el primero falle', async () => {
      appointmentsService.bookAppointment
        .mockImplementationOnce(() => Promise.reject(new Error('boom')))
        .mockImplementationOnce(() =>
          Promise.resolve({ success: true, appointmentId: 'apt2' }),
        );

      const result = await service.applyBatch('org1', [
        insertEvent({ eventId: 'evt-1' }),
        insertEvent({ eventId: 'evt-2' }),
      ]);

      expect(appointmentsService.bookAppointment).toHaveBeenCalledTimes(2);
      expect(result.applied).toBe(1);
      // El evento fallido queda auditado como ERROR, no silenciado.
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'ERROR', eventId: 'evt-1' }),
        }),
      );
    });
  });

  describe('conflicto de cupo', () => {
    it('bookAppointment success:false → CONFLICT auditado, no se pierde en silencio', async () => {
      appointmentsService.bookAppointment.mockResolvedValueOnce({
        success: false,
        message: 'Lo sentimos, el horario acaba de ser reservado.',
      });

      const result = await service.applyBatch('org1', [insertEvent()]);

      expect(result).toEqual({
        applied: 0,
        skipped: 0,
        conflicts: 1,
        errors: 0,
      });
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'CONFLICT' }),
        }),
      );
      // El conflicto SÍ se registra en SyncInbox (ya "vimos" este evento;
      // no se reintenta indefinidamente el mismo conflicto detectado).
      expect(prisma.syncInbox.create).toHaveBeenCalled();
    });
  });

  describe('cancelación', () => {
    it('CANCEL sin agenIAAppointmentId → error auditado, nunca intenta cancelar a ciegas', async () => {
      const event = insertEvent({
        op: 'CANCEL',
        payload: {},
      });

      const result = await service.applyBatch('org1', [event]);

      expect(result.applied).toBe(0);
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'ERROR' }),
        }),
      );
    });
  });

  describe('entidades no implementadas en Fase 1 (SLOT/DOCTOR/PATIENT/SERVICE/EPS)', () => {
    it.each(['SLOT', 'DOCTOR', 'PATIENT', 'SERVICE', 'EPS'] as const)(
      '%s → se registra pero NO se aplica todavía (Fase 2+), sin reventar el lote',
      async (entityType) => {
        const result = await service.applyBatch('org1', [
          insertEvent({ entityType, eventId: `evt-${entityType}` }),
        ]);

        expect(result.skipped).toBe(1);
        // No debe haber quedado marcado como idempotente-aplicado: sigue
        // pendiente de una implementación futura, no "ya resuelto".
        expect(prisma.syncInbox.create).not.toHaveBeenCalled();
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // Desenlace de atención entrante.
  //
  // Esto NUNCA se aplicó. El driver reporta la cita por médico y hora —no
  // conoce los ids de AgenIA— así que `agenIAAppointmentId` venía siempre
  // vacío y el método lanzaba. `applyBatch` se tragaba el error y el agente
  // recibía 200: ~235 eventos al día perdidos en silencio, y
  // `attendanceStatus` en PENDING para siempre.
  // ════════════════════════════════════════════════════════════════════════
  describe('desenlace de atención entrante', () => {
    const attendanceEvent = (
      payload: Record<string, unknown> = {},
    ): CanonicalChangeEvent => ({
      eventId: 'evt-att',
      entityType: 'APPOINTMENT',
      op: 'ATTENDANCE',
      occurredAtIso: new Date().toISOString(),
      payload: {
        doctorExternalKey: '76',
        startTimeIso: '2026-09-03T12:00:00.000Z',
        attendanceStatus: 'ATTENDED',
        ...payload,
      },
    });

    it('sin id de AgenIA, resuelve la cita por el cupo y la aplica', async () => {
      prisma.mirrorEntityMap.findFirst.mockResolvedValue({ agenIAId: 'doc-1' });
      prisma.scheduleSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
      prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-9' });

      const r = await service.applyBatch('org-1', [attendanceEvent()]);

      expect(appointmentsService.updateAttendance).toHaveBeenCalledWith(
        'apt-9',
        'ATTENDED',
        'org-1',
      );
      expect(r).toMatchObject({ applied: 1, errors: 0 });
    });

    it('un desenlace de una cita que AgenIA no tiene se omite, no falla', async () => {
      // La agendó el hospital por ventanilla. No hay nada que actualizar.
      prisma.mirrorEntityMap.findFirst.mockResolvedValue({ agenIAId: 'doc-1' });
      prisma.scheduleSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
      prisma.appointment.findFirst.mockResolvedValue(null);

      const r = await service.applyBatch('org-1', [attendanceEvent()]);

      expect(appointmentsService.updateAttendance).not.toHaveBeenCalled();
      expect(r).toMatchObject({ skipped: 1, errors: 0 });
    });

    it('un desenlace que el modelo no conoce se rechaza, no se escribe', async () => {
      // El código crudo del HIS ('1') es justo lo que el driver mandaba antes.
      // `Appointment.attendanceStatus` es un enum: escribirlo reventaría.
      const r = await service.applyBatch('org-1', [
        attendanceEvent({ attendanceStatus: '1' }),
      ]);

      expect(appointmentsService.updateAttendance).not.toHaveBeenCalled();
      expect(r.errors).toBe(1);
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'ERROR' }),
        }),
      );
    });
  });

  // Sin este contador, un lote entero podía fracasar y el agente lo leía como
  // éxito: 200, `applied+skipped+conflicts` y ni rastro del fallo.
  describe('los fallos se cuentan, no solo se auditan', () => {
    it('un evento que revienta suma en `errors`', async () => {
      appointmentsService.bookAppointment.mockRejectedValue(new Error('boom'));

      const r = await service.applyBatch('org-1', [insertEvent()]);

      expect(r.errors).toBe(1);
      expect(r.applied).toBe(0);
    });

    it('un lote sano deja `errors` en cero', async () => {
      const r = await service.applyBatch('org-1', [insertEvent()]);

      expect(r).toMatchObject({ applied: 1, errors: 0 });
    });
  });
});
