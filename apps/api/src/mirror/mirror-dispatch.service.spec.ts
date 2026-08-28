import { Test, TestingModule } from '@nestjs/testing';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MirrorDispatchService', () => {
  let service: MirrorDispatchService;
  let prisma: {
    hospitalMirrorConfig: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    syncOutbox: { findMany: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: {
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            mappingVersion: 1,
            mappingJson: null,
            pushEnabled: true,
            pullEnabled: true,
          }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
      syncOutbox: {
        findMany: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorDispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MirrorDispatchService>(MirrorDispatchService);
    // Ventanas de long-poll cortas — el default de producción (25s) haría
    // estos tests lentísimos y frágiles. Ver el comentario en el servicio.
    (service as unknown as { longPollMs: number }).longPollMs = 30;
    (service as unknown as { longPollIntervalMs: number }).longPollIntervalMs = 10;
  });

  describe('getPendingEvents — orden', () => {
    it('devuelve inmediatamente si ya hay eventos pendientes, ordenados por seq asc', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        {
          seq: BigInt(5),
          eventId: 'e5',
          entityType: 'SLOT',
          entityId: 'x',
          op: 'INSERT',
          payload: {},
          createdAt: new Date(),
        },
      ]);

      const result = await service.getPendingEvents('org1', BigInt(0));

      expect(result).toHaveLength(1);
      expect(result[0].seq).toBe('5'); // BigInt serializado como string
      expect(prisma.syncOutbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { seq: 'asc' } }),
      );
    });

    it('filtra por deliveredAt=null y deadLettered=false — nunca reentrega lo ya entregado', async () => {
      // mockResolvedValue (no "Once"): el long-poll puede reintentar más de
      // una vez dentro de la ventana corta de 30ms antes de rendirse.
      prisma.syncOutbox.findMany.mockResolvedValue([]);

      await service.getPendingEvents('org1', BigInt(0));

      const where = prisma.syncOutbox.findMany.mock.calls[0][0].where;
      expect(where.deliveredAt).toBeNull();
      expect(where.deadLettered).toBe(false);
      expect(where.organizationId).toBe('org1');
    });
  });

  describe('ack — reintentos y dead-letter', () => {
    it('seqs exitosos → marca deliveredAt, no toca attempts', async () => {
      await service.ack('org1', { seqs: ['1', '2'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', seq: { in: [BigInt(1), BigInt(2)] } },
        data: { deliveredAt: expect.any(Date) },
      });
      expect(prisma.syncOutbox.update).not.toHaveBeenCalled();
    });

    it('failedSeqs → incrementa attempts, NO marca delivered (queda pendiente)', async () => {
      prisma.syncOutbox.update.mockResolvedValueOnce({
        seq: BigInt(9),
        eventId: 'e9',
        attempts: 3,
      });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      expect(prisma.syncOutbox.update).toHaveBeenCalledWith({
        where: { seq: BigInt(9) },
        data: { attempts: { increment: 1 } },
      });
    });

    it('failedSeqs que alcanza el máximo de intentos → se marca dead-letter', async () => {
      prisma.syncOutbox.update
        .mockResolvedValueOnce({ seq: BigInt(9), eventId: 'e9', attempts: 10 })
        .mockResolvedValueOnce({}); // la segunda llamada: marcar deadLettered

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      expect(prisma.syncOutbox.update).toHaveBeenNthCalledWith(2, {
        where: { seq: BigInt(9) },
        data: { deadLettered: true },
      });
    });
  });
});
