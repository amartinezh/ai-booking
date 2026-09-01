import { Test, TestingModule } from '@nestjs/testing';
import { MirrorDispatchService, backoffMs } from './mirror-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MirrorDispatchService', () => {
  let service: MirrorDispatchService;
  let prisma: {
    hospitalMirrorConfig: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    syncOutbox: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
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
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
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
        data: { deliveredAt: expect.any(Date), nextAttemptAt: null },
      });
    });

    it('failedSeqs → incrementa attempts, NO marca delivered (queda pendiente)', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 2 })
        .mockResolvedValueOnce({
          seq: BigInt(9),
          eventId: 'e9',
          attempts: 3,
          deadLettered: false,
          nextAttemptAt: new Date(),
        });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(9), organizationId: 'org1' },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: expect.any(Date), // backoff: no antes de esa hora
        },
      });
      // no se marcó deadLettered: solo hubo el updateMany del incremento
      const marcasDeadLetter = prisma.syncOutbox.updateMany.mock.calls.filter(
        (c: any[]) => c[0]?.data?.deadLettered === true,
      );
      expect(marcasDeadLetter).toHaveLength(0);
    });

    it('failedSeqs que alcanza el máximo de intentos → se marca dead-letter', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 9 }) // lectura previa (para el backoff)
        .mockResolvedValueOnce({
          seq: BigInt(9),
          eventId: 'e9',
          attempts: 10,
          deadLettered: false,
          nextAttemptAt: new Date(),
        });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(9), organizationId: 'org1' },
        data: { deadLettered: true },
      });
    });

    it('un evento ya en dead-letter no se vuelve a marcar (ni a re-alertar)', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 13 })
        .mockResolvedValueOnce({
          seq: BigInt(9),
          eventId: 'e9',
          attempts: 14,
          deadLettered: true,
          nextAttemptAt: new Date(),
        });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      const marcas = prisma.syncOutbox.updateMany.mock.calls.filter(
        (c: any[]) => c[0]?.data?.deadLettered === true,
      );
      expect(marcas).toHaveLength(0);
    });
  });

  // 🔒 El `seq` de SyncOutbox es una secuencia GLOBAL, compartida entre todas
  // las clínicas. Hasta que markAttemptFailed filtró por organización, un
  // agente podía reportar como fallido el seq de OTRO tenant y subirle los
  // intentos hasta mandarle el evento a dead-letter.
  describe('aislamiento entre organizaciones', () => {
    it('un seq que no es de la organización que lo reporta NO se toca', async () => {
      // updateMany no afecta ninguna fila: el seq existe, pero es de otra org.
      prisma.syncOutbox.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.markAttemptFailed('org-atacante', '9');

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(9), organizationId: 'org-atacante' },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: expect.any(Date),
        },
      });
      // y se corta ahí: no vuelve a leer la fila ajena ni la manda a
      // dead-letter. La lectura previa del backoff ya filtró por organización
      // y devolvió null, así que tampoco filtró datos de otro tenant.
      expect(prisma.syncOutbox.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledTimes(1);
    });

    it('el filtro por organización viaja en TODAS las escrituras del camino', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 9 })
        .mockResolvedValueOnce({
          seq: BigInt(4),
          eventId: 'e4',
          attempts: 10,
          deadLettered: false,
          nextAttemptAt: new Date(),
        });

      await service.markAttemptFailed('org-duena', '4');

      for (const [args] of prisma.syncOutbox.updateMany.mock.calls) {
        expect(args.where.organizationId).toBe('org-duena');
      }
      expect(prisma.syncOutbox.findFirst.mock.calls[0][0].where.organizationId).toBe(
        'org-duena',
      );
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Reintentos con backoff (opción C).
//
// Antes de esto el dispatcher filtraba `seq > cursor` y el agente avanzaba su
// cursor local aunque el evento fallara: un evento fallido NO se volvía a
// servir nunca mientras el agente siguiera vivo. Comprobado en vivo el
// 2026-08-31 — `attempts` subía una vez por reinicio del agente, así que el
// dead-letter de 10 intentos no llegaba jamás.
// ═════════════════════════════════════════════════════════════════════════
describe('MirrorDispatchService — entrega con backoff', () => {
  let service: MirrorDispatchService;
  let prisma: any;

  const fila = (over: Partial<Record<string, any>> = {}) => ({
    seq: BigInt(1),
    eventId: 'e1',
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    payload: {},
    createdAt: new Date('2026-08-31T12:00:00Z'),
    deliveredAt: null,
    attempts: 0,
    deadLettered: false,
    nextAttemptAt: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve({})),
        update: jest.fn(() => Promise.resolve({})),
      },
      syncOutbox: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorDispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(MirrorDispatchService);
    (service as any).longPollMs = 5;
    (service as any).longPollIntervalMs = 1;
  });

  describe('backoffMs', () => {
    it('crece exponencialmente y se detiene en el techo de 5 minutos', () => {
      expect(backoffMs(1)).toBe(2_000);
      expect(backoffMs(2)).toBe(4_000);
      expect(backoffMs(5)).toBe(32_000);
      expect(backoffMs(8)).toBe(256_000);
      expect(backoffMs(9)).toBe(300_000); // techo
      expect(backoffMs(50)).toBe(300_000); // no desborda con exponentes grandes
    });

    it('los 10 intentos se agotan en menos de media hora', () => {
      let total = 0;
      for (let i = 1; i <= 10; i++) total += backoffMs(i);
      expect(total).toBeLessThan(30 * 60_000);
      // ...pero no en segundos: el HIS debe tener margen para reiniciarse.
      expect(total).toBeGreaterThan(10 * 60_000);
    });
  });

  describe('el cursor ya NO filtra: un evento fallido vuelve a entregarse', () => {
    it('la consulta no menciona el seq del cursor, solo "pendiente"', async () => {
      await service.getPendingEvents('org1', BigInt(999));

      const where = prisma.syncOutbox.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        organizationId: 'org1',
        deliveredAt: null,
        deadLettered: false,
      });
      expect(JSON.stringify(where)).not.toContain('gt');
    });

    it('un evento con seq POR DEBAJO del cursor se sigue entregando', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(2), eventId: 'viejo-fallido', attempts: 3 }),
      ]);

      // El agente ya avanzó su cursor a 50 — antes esto devolvía vacío.
      const eventos = await service.getPendingEvents('org1', BigInt(50));

      expect(eventos.map((e) => e.eventId)).toEqual(['viejo-fallido']);
    });
  });

  describe('backoff: no se reintenta antes de tiempo', () => {
    it('un evento cuyo nextAttemptAt aún no llega NO se entrega', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        fila({ nextAttemptAt: new Date(Date.now() + 60_000) }),
      ]);

      expect(await service.getPendingEvents('org1', BigInt(0))).toEqual([]);
    });

    it('cuando su nextAttemptAt ya pasó, se entrega', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ nextAttemptAt: new Date(Date.now() - 1_000) }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));
      expect(eventos).toHaveLength(1);
    });

    it('nextAttemptAt nulo (nunca intentado) se entrega de inmediato', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ nextAttemptAt: null }),
      ]);

      expect(await service.getPendingEvents('org1', BigInt(0))).toHaveLength(1);
    });

    it('cada fallo empuja el siguiente intento más lejos', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 2 }) // lectura previa
        .mockResolvedValueOnce(fila({ attempts: 3 })); // relectura post-update

      const antes = Date.now();
      await service.markAttemptFailed('org1', '1');

      const data = prisma.syncOutbox.updateMany.mock.calls[0][0].data;
      expect(data.attempts).toEqual({ increment: 1 });
      // 3er intento -> 8 segundos
      const delta = data.nextAttemptAt.getTime() - antes;
      expect(delta).toBeGreaterThanOrEqual(8_000);
      expect(delta).toBeLessThan(9_000);
    });

    it('un ack exitoso limpia el backoff que hubiera quedado', async () => {
      await service.ack('org1', { seqs: ['1'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', seq: { in: [BigInt(1)] } },
        data: { deliveredAt: expect.any(Date), nextAttemptAt: null },
      });
    });
  });

  // ⭐ Sin el cursor global se pierde el orden estricto por seq. Lo que hay que
  // conservar es el orden POR ENTIDAD: si el INSERT de una cita falla y su
  // DELETE se aplica igual, el HIS recibe la cancelación de una cita que no
  // existe.
  describe('orden por entidad', () => {
    it('entrega como mucho UN evento por entidad en cada lote', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(1), eventId: 'insert', entityId: 'apt-1' }),
        fila({ seq: BigInt(2), eventId: 'delete', entityId: 'apt-1', op: 'DELETE' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));

      expect(eventos.map((e) => e.eventId)).toEqual(['insert']);
    });

    it('entidades distintas SÍ viajan juntas: el rendimiento no se resiente', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(1), eventId: 'a', entityId: 'apt-1' }),
        fila({ seq: BigInt(2), eventId: 'b', entityId: 'apt-2' }),
        fila({ seq: BigInt(3), eventId: 'c', entityId: 'apt-3' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));

      expect(eventos.map((e) => e.eventId)).toEqual(['a', 'b', 'c']);
    });

    it('si el primer evento de una entidad espera backoff, los suyos también esperan', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({
          seq: BigInt(1),
          eventId: 'insert-fallido',
          entityId: 'apt-1',
          nextAttemptAt: new Date(Date.now() + 60_000),
        }),
        fila({ seq: BigInt(2), eventId: 'delete', entityId: 'apt-1', op: 'DELETE' }),
        fila({ seq: BigInt(3), eventId: 'otra-cita', entityId: 'apt-9' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));

      // El DELETE de apt-1 NO puede adelantarse a su INSERT atascado...
      expect(eventos.map((e) => e.eventId)).toEqual(['otra-cita']);
    });

    it('la misma entityId de tipos distintos son entidades distintas', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(1), eventId: 'slot', entityType: 'SLOT', entityId: 'x' }),
        fila({ seq: BigInt(2), eventId: 'cita', entityType: 'APPOINTMENT', entityId: 'x' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));
      expect(eventos).toHaveLength(2);
    });

    it('respeta el límite del lote', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) =>
          fila({ seq: BigInt(i + 1), eventId: `e${i}`, entityId: `apt-${i}` }),
        ),
      );

      const eventos = await service.getPendingEvents('org1', BigInt(0), 3);
      expect(eventos).toHaveLength(3);
    });

    it('lee una ventana mayor que el límite, porque el filtro por entidad descarta filas', async () => {
      await service.getPendingEvents('org1', BigInt(0), 10);

      expect(prisma.syncOutbox.findMany.mock.calls[0][0].take).toBeGreaterThan(10);
    });
  });

  describe('sin pérdidas', () => {
    it('un ack perdido no deja el evento varado: vuelve a entregarse', async () => {
      // El agente aplicó el evento pero su ack se perdió en la red, así que
      // deliveredAt sigue en null. Antes, con el cursor ya avanzado, el evento
      // quedaba invisible para siempre.
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(7), eventId: 'ack-perdido' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(100));

      expect(eventos.map((e) => e.eventId)).toEqual(['ack-perdido']);
    });

    it('lo entregado y lo dead-letter nunca se reentregan', async () => {
      await service.getPendingEvents('org1', BigInt(0));

      const where = prisma.syncOutbox.findMany.mock.calls[0][0].where;
      expect(where.deliveredAt).toBeNull();
      expect(where.deadLettered).toBe(false);
    });

    it('el dead-letter ya es alcanzable: 10 fallos reales lo disparan', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 9 })
        .mockResolvedValueOnce(fila({ attempts: 10, deadLettered: false }));

      await service.markAttemptFailed('org1', '1');

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(1), organizationId: 'org1' },
        data: { deadLettered: true },
      });
    });
  });
});
