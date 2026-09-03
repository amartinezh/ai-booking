import { Test, TestingModule } from '@nestjs/testing';
import {
  FailureReason,
  InteractionLogService,
  InteractionStatus,
} from './interaction-log.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * La "caja negra": lo único que queda cuando un paciente reclama que su cita
 * nunca se agendó. Dos propiedades no negociables:
 *
 *  - Es fire-and-forget: si la auditoría falla, la conversación NO se cae.
 *  - Nada de lo que escribe puede reventar el INSERT (textos acotados).
 */
describe('InteractionLogService', () => {
  let service: InteractionLogService;
  let prisma: { interactionLog: { create: jest.Mock } };

  const datos = () => prisma.interactionLog.create.mock.calls[0][0].data;

  beforeEach(async () => {
    prisma = { interactionLog: { create: jest.fn().mockResolvedValue({}) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InteractionLogService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(InteractionLogService);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('log — el camino base', () => {
    it('escribe la fila con lo que se le pasó', async () => {
      await service.log({
        whatsappId: '57300',
        status: InteractionStatus.SUCCESS,
        userMessage: 'hola',
        botReply: 'buenas',
        organizationId: 'org-1',
        patientUserId: 'p1',
        metadata: { a: 1 },
      });

      expect(datos()).toEqual({
        whatsappId: '57300',
        status: InteractionStatus.SUCCESS,
        failureReason: null,
        userMessage: 'hola',
        botReply: 'buenas',
        organizationId: 'org-1',
        patientId: 'p1',
        metadata: { a: 1 },
      });
    });

    it('los opcionales ausentes se guardan como null, no como undefined', async () => {
      await service.log({
        whatsappId: '57300',
        status: InteractionStatus.SUCCESS,
      });

      const d = datos();
      expect(d.userMessage).toBeNull();
      expect(d.botReply).toBeNull();
      expect(d.organizationId).toBeNull();
      expect(d.patientId).toBeNull();
      expect(d.metadata).toBeNull();
    });

    it('un texto larguísimo se recorta a 4000 con puntos suspensivos: no revienta el INSERT', async () => {
      await service.log({
        whatsappId: '57300',
        status: InteractionStatus.SUCCESS,
        userMessage: 'a'.repeat(5000),
        botReply: 'b'.repeat(9000),
      });

      const d = datos();
      expect(d.userMessage).toHaveLength(4000);
      expect(d.userMessage.endsWith('...')).toBe(true);
      expect(d.botReply).toHaveLength(4000);
    });

    it('un texto justo en el límite no se toca', async () => {
      await service.log({
        whatsappId: '57300',
        status: InteractionStatus.SUCCESS,
        userMessage: 'a'.repeat(4000),
      });

      expect(datos().userMessage).toBe('a'.repeat(4000));
      expect(datos().userMessage.endsWith('...')).toBe(false);
    });

    it('🔒 si la BD falla, NO propaga: la conversación con el paciente sigue', async () => {
      prisma.interactionLog.create.mockRejectedValue(
        new Error('connection refused'),
      );

      await expect(
        service.log({
          whatsappId: '57300',
          status: InteractionStatus.SUCCESS,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('helpers de estado', () => {
    it('logSuccess marca SUCCESS', async () => {
      await service.logSuccess({ whatsappId: 'x' });
      expect(datos().status).toBe(InteractionStatus.SUCCESS);
    });

    it('logFailure marca FAILED y guarda la razón estructurada', async () => {
      await service.logFailure({
        whatsappId: 'x',
        reason: FailureReason.SLOT_TAKEN,
      });
      expect(datos().status).toBe(InteractionStatus.FAILED);
      expect(datos().failureReason).toBe(FailureReason.SLOT_TAKEN);
    });
  });

  describe('logBookingConfirmed — el evento de negocio que de verdad importa', () => {
    it('guarda cita, cédula, servicio, médico y fecha en ISO', async () => {
      await service.logBookingConfirmed({
        whatsappId: 'x',
        organizationId: 'org-1',
        appointmentId: 'apt-1',
        patientCedula: '123',
        serviceName: 'Medicina General',
        doctorName: 'Dra. Ruiz',
        slotDate: new Date('2026-06-01T14:00:00Z'),
        epsName: 'Sura',
      });

      expect(datos().status).toBe(InteractionStatus.BOOKING_CONFIRMED);
      expect(datos().metadata).toEqual({
        appointmentId: 'apt-1',
        patientCedula: '123',
        serviceName: 'Medicina General',
        doctorName: 'Dra. Ruiz',
        slotDate: '2026-06-01T14:00:00.000Z',
        epsName: 'Sura',
      });
    });
  });

  describe('logWaitlistJoined / logWaitlistNotification', () => {
    it('la entrada a la lista guarda la posición', async () => {
      await service.logWaitlistJoined({
        whatsappId: 'x',
        organizationId: 'org-1',
        waitlistEntryId: 'w1',
        patientCedula: '123',
        serviceName: 'Medicina General',
        position: 4,
      });

      expect(datos().status).toBe(InteractionStatus.WAITLIST_JOINED);
      expect(datos().metadata.position).toBe(4);
    });

    it('la notificación de cupo guarda el slot ofrecido', async () => {
      await service.logWaitlistNotification({
        whatsappId: 'x',
        organizationId: 'org-1',
        patientCedula: '123',
        slotId: 'slot-9',
        doctorName: 'Dra. Ruiz',
        slotDate: new Date('2026-06-01T14:00:00Z'),
        botReply: 'Se liberó un cupo',
      });

      expect(datos().status).toBe(InteractionStatus.WAITLIST_NOTIFIED);
      expect(datos().metadata.slotId).toBe('slot-9');
    });
  });

  describe('logOutbound', () => {
    it('un envío bueno es OUTBOUND sin razón de fallo', async () => {
      await service.logOutbound({
        whatsappId: 'x',
        botReply: 'hola',
        success: true,
      });
      expect(datos().status).toBe(InteractionStatus.OUTBOUND);
      expect(datos().failureReason).toBeNull();
      expect(datos().metadata).toEqual({ outbound: true, error: null });
    });

    it('un envío fallido queda como FAILED con la razón de Meta', async () => {
      await service.logOutbound({
        whatsappId: 'x',
        botReply: 'hola',
        success: false,
        error: '401 token expirado',
      });
      expect(datos().status).toBe(InteractionStatus.FAILED);
      expect(datos().failureReason).toBe(FailureReason.META_API_ERROR);
      expect(datos().metadata.error).toBe('401 token expirado');
    });
  });

  describe('logReminderSent', () => {
    const base = {
      whatsappId: 'x',
      organizationId: 'org-1',
      appointmentId: 'apt-1',
      slotDate: new Date('2026-06-01T14:00:00Z'),
      businessHoursBefore: 24,
      botReply: 'Le recordamos su cita',
    };

    it('un recordatorio entregado queda como REMINDER_SENT', async () => {
      await service.logReminderSent({ ...base, success: true });

      expect(datos().status).toBe(InteractionStatus.REMINDER_SENT);
      expect(datos().failureReason).toBeNull();
      expect(datos().metadata).toMatchObject({
        appointmentId: 'apt-1',
        businessHoursBefore: 24,
        reminderAutomatic: true,
        slotDate: '2026-06-01T14:00:00.000Z',
        error: null,
      });
    });

    it('uno fallido queda como FAILED con el error, para poder reclamarle a Meta', async () => {
      await service.logReminderSent({
        ...base,
        success: false,
        error: 'template not approved',
      });

      expect(datos().status).toBe(InteractionStatus.FAILED);
      expect(datos().failureReason).toBe(FailureReason.META_API_ERROR);
      expect(datos().metadata.error).toBe('template not approved');
    });

    it('los datos que el cron no tenga se guardan como null, nunca como undefined', async () => {
      await service.logReminderSent({ ...base, success: true });

      expect(datos().metadata.patientCedula).toBeNull();
      expect(datos().metadata.doctorName).toBeNull();
      expect(datos().metadata.serviceName).toBeNull();
    });
  });
});
