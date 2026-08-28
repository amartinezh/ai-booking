import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn(async () => []);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: {
            scheduleSlot: {
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany,
            },
            appointment: {
              create: jest.fn(),
              update: jest.fn(),
              findFirst: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bookAppointment — colisión de cupo', () => {
    // Construye un servicio cuyo $transaction ejecuta el callback contra un tx
    // en el que el slot indicado ya NO está disponible (o no existe / es de otro
    // tenant), reproduciendo la carrera real entre dos pacientes.
    const serviceWithSlot = async (slot: any) => {
      const tx = {
        scheduleSlot: {
          findUnique: jest.fn(async () => slot),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(async () => ({ id: 'apt1' })) },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest.fn(async (cb: any) => cb(tx)),
            },
          },
        ],
      }).compile();
      return {
        svc: module.get<AppointmentsService>(AppointmentsService),
        tx,
      };
    };

    it('slot ya tomado (isAvailable=false) → success:false, NO relanza (bug SLOT_TAKEN_OR_INVALID)', async () => {
      const { svc, tx } = await serviceWithSlot({
        id: 's1',
        isAvailable: false,
        organizationId: 'org1',
      });

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'WHATSAPP',
        'org1',
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/acaba de ser reservado/i);
      // No debió intentar crear la cita ni ocupar el slot.
      expect(tx.appointment.create).not.toHaveBeenCalled();
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('slot inexistente → success:false (misma rama del catch)', async () => {
      const { svc } = await serviceWithSlot(null);

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'WHATSAPP',
        'org1',
      );

      expect(result.success).toBe(false);
    });

    it('slot de otro tenant → success:false (aislamiento)', async () => {
      const { svc } = await serviceWithSlot({
        id: 's1',
        isAvailable: true,
        organizationId: 'OTRA_ORG',
      });

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'WHATSAPP',
        'org1',
      );

      expect(result.success).toBe(false);
    });
  });

  describe('bookAppointment — anti-eco espejo (origin=MIRROR)', () => {
    const serviceWithSlot = async (slot: any) => {
      const tx = {
        scheduleSlot: {
          findUnique: jest.fn(async () => slot),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(async () => ({ id: 'apt1' })) },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest.fn(async (cb: any) => cb(tx)),
            },
          },
        ],
      }).compile();
      return {
        svc: module.get<AppointmentsService>(AppointmentsService),
        tx,
      };
    };

    it('origin=MIRROR → marca SET LOCAL agenia.sync_origin ANTES de tocar el slot', async () => {
      const { svc, tx } = await serviceWithSlot({
        id: 's1',
        isAvailable: true,
        organizationId: 'org1',
      });

      await svc.bookAppointment('p1', 's1', null, 'MIRROR', 'org1');

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      // Orden: el anti-eco debe fijarse ANTES del INSERT que el trigger va a
      // capturar — si se marcara después, la fila ya habría entrado sin el
      // origin correcto y el evento se reenviaría de vuelta al HIS que lo originó.
      const rawCallOrder = tx.$executeRawUnsafe.mock.invocationCallOrder[0];
      const createCallOrder = tx.appointment.create.mock.invocationCallOrder[0];
      expect(rawCallOrder).toBeLessThan(createCallOrder);
    });

    it.each(['WHATSAPP', 'MANUAL'] as const)(
      'origin=%s → NUNCA marca el anti-eco (solo aplica a MIRROR)',
      async (origin) => {
        const { svc, tx } = await serviceWithSlot({
          id: 's1',
          isAvailable: true,
          organizationId: 'org1',
        });

        await svc.bookAppointment('p1', 's1', null, origin, 'org1');

        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
      },
    );
  });

  describe('getAvailableSlots — filtro de fecha', () => {
    const whereOf = () => findMany.mock.calls[0][0].where;

    it('sin dateWindow → startTime { gt: now } (regresión: conducta histórica)', async () => {
      await service.getAvailableSlots('Medicina', null, 'org1');
      const startTime = whereOf().startTime;
      expect(startTime).toHaveProperty('gt');
      expect(startTime).not.toHaveProperty('lte');
    });

    it('con dateWindow futuro → gte: desde, lte: hasta', async () => {
      const desde = new Date(Date.now() + 24 * 3600 * 1000);
      const hasta = new Date(Date.now() + 48 * 3600 * 1000);
      await service.getAvailableSlots('Medicina', null, 'org1', {
        desde,
        hasta,
      });
      const startTime = whereOf().startTime;
      expect(startTime.gte).toEqual(desde);
      expect(startTime.lte).toEqual(hasta);
    });

    it('con dateWindow cuyo desde es pasado → usa now como gte (no ofrece horas pasadas)', async () => {
      const desde = new Date(Date.now() - 6 * 3600 * 1000); // "hoy" 00:00 ya pasó
      const hasta = new Date(Date.now() + 6 * 3600 * 1000);
      const before = Date.now();
      await service.getAvailableSlots('Medicina', null, 'org1', {
        desde,
        hasta,
      });
      const startTime = whereOf().startTime;
      expect(startTime.gte.getTime()).toBeGreaterThanOrEqual(before);
      expect(startTime.lte).toEqual(hasta);
    });
  });
});
