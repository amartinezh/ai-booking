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
