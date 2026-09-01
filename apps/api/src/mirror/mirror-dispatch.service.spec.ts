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
    // Modelos que consulta la hidratación (bloque D).
    scheduleSlot: { findMany: jest.Mock };
    patientProfile: { findMany: jest.Mock };
    eps: { findMany: jest.Mock };
    mirrorEntityMap: { findMany: jest.Mock };
    syncAudit: { create: jest.Mock };
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
      // Modelos que consulta la hidratación (bloque D).
      scheduleSlot: { findMany: jest.fn(() => Promise.resolve([])) },
      patientProfile: { findMany: jest.fn(() => Promise.resolve([])) },
      eps: { findMany: jest.fn(() => Promise.resolve([])) },
      mirrorEntityMap: { findMany: jest.fn(() => Promise.resolve([])) },
      syncAudit: { create: jest.fn(() => Promise.resolve({})) },
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

  // ══════════════════════════════════════════════════════════════════════
  // "El agente respira" y "el agente alcanza su HIS" son cosas distintas: el
  // agente puede latir puntual mientras falla el 100 % de sus escrituras. Esa
  // diferencia solo existía en el log del servidor, así que la única forma de
  // enterarse era que alguien estuviera mirando en ese instante. Ahora se
  // guarda, y el panel del hospital la muestra.
  // ══════════════════════════════════════════════════════════════════════
  describe('heartbeat', () => {
    const datosDelUpdate = () =>
      prisma.hospitalMirrorConfig.update.mock.calls[0][0].data;

    it('registra el latido', async () => {
      await service.heartbeat('org1', 'driver-x', {});

      expect(datosDelUpdate().lastHeartbeatAt).toEqual(expect.any(Date));
    });

    it('guarda que el HIS NO respondía, no solo lo loguea', async () => {
      await service.heartbeat('org1', 'driver-x', {
        hisReachable: false,
        hisDetail: 'Failed to connect to 192.168.1.16:1433',
      });

      expect(datosDelUpdate()).toMatchObject({
        lastHisReachable: false,
        lastHisDetail: 'Failed to connect to 192.168.1.16:1433',
      });
    });

    it('guarda también el caso bueno: sin él no se distingue de "nunca reportó"', async () => {
      await service.heartbeat('org1', 'driver-x', { hisReachable: true });

      expect(datosDelUpdate().lastHisReachable).toBe(true);
    });

    it('un agente viejo que no reporta salud del HIS deja el campo en nulo', async () => {
      // Nulo significa "no lo sé", que es distinto de "no alcanza".
      await service.heartbeat('org1', 'driver-x', {});

      expect(datosDelUpdate().lastHisReachable).toBeNull();
    });

    it('un detalle largo se recorta: no se rompe el insert por un stack trace', async () => {
      await service.heartbeat('org1', 'driver-x', {
        hisReachable: false,
        hisDetail: 'x'.repeat(2000),
      });

      expect(datosDelUpdate().lastHisDetail).toHaveLength(500);
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

    // ══════════════════════════════════════════════════════════════════════
    // Cada reserva de cita genera además un evento SLOT (el cupo pasa a
    // ocupado) que este driver no espeja. Tratarlo como fallo lo mandaba a
    // dead-letter tras diez intentos y dejaba el monitor en DOWN permanente:
    // a la décima cita, una alerta rota para siempre por diseño.
    // ══════════════════════════════════════════════════════════════════════
    describe('skippedSeqs — el driver no espeja ese tipo de entidad', () => {
      const eventoSlot = {
        eventId: 'e-slot',
        entityType: 'SLOT',
        entityId: 'slot-1',
        op: 'UPDATE',
      };

      it('se cierra como entregado: no se reintenta nunca más', async () => {
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(eventoSlot);

        await service.ack('org1', { seqs: [], skippedSeqs: ['7'] });

        expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
          where: { seq: BigInt(7), organizationId: 'org1' },
          data: { deliveredAt: expect.any(Date), nextAttemptAt: null },
        });
      });

      it('NO sube attempts: no es un fallo', async () => {
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(eventoSlot);

        await service.ack('org1', { seqs: [], skippedSeqs: ['7'] });

        const incrementos = prisma.syncOutbox.updateMany.mock.calls.filter(
          (c: any[]) => c[0]?.data?.attempts,
        );
        expect(incrementos).toHaveLength(0);
      });

      it('no es un descarte silencioso: queda en SyncAudit como SKIPPED', async () => {
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(eventoSlot);

        await service.ack('org1', { seqs: [], skippedSeqs: ['7'] });

        expect(prisma.syncAudit.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            organizationId: 'org1',
            outcome: 'SKIPPED',
            entityType: 'SLOT',
            eventId: 'e-slot',
          }),
        });
      });

      it('un agente no puede cerrar el evento de otra clínica', async () => {
        // Mismo aislamiento de tenant que markAttemptFailed: `seq` es una
        // secuencia global, no por organización.
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(null);

        await service.ack('org2', { seqs: [], skippedSeqs: ['7'] });

        expect(prisma.syncAudit.create).not.toHaveBeenCalled();
        const cierres = prisma.syncOutbox.updateMany.mock.calls.filter(
          (c: any[]) => c[0]?.where?.seq === BigInt(7),
        );
        expect(cierres).toHaveLength(0);
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
      // Modelos que consulta la hidratación (bloque D).
      scheduleSlot: { findMany: jest.fn(() => Promise.resolve([])) },
      patientProfile: { findMany: jest.fn(() => Promise.resolve([])) },
      eps: { findMany: jest.fn(() => Promise.resolve([])) },
      mirrorEntityMap: { findMany: jest.fn(() => Promise.resolve([])) },
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

// ═════════════════════════════════════════════════════════════════════════
// Hidratación del evento (bloque D).
//
// El trigger serializa la fila de Appointment tal cual, y esa fila NO tiene
// hora, ni médico, ni servicio: eso vive en ScheduleSlot. El driver recibía
// cuatro UUIDs de AgenIA y nada con qué construir el INSERT del HIS.
// ═════════════════════════════════════════════════════════════════════════
describe('MirrorDispatchService — hidratación del evento', () => {
  let service: MirrorDispatchService;
  let prisma: any;
  let avisos: string[];

  const SLOT = {
    id: 'slot-1',
    startTime: new Date('2026-09-03T12:20:00.000Z'),
    endTime: new Date('2026-09-03T12:40:00.000Z'),
    doctorId: 'doc-1',
    serviceId: 'svc-1',
  };
  const PACIENTE = {
    id: 'pat-1',
    cedula: '9696544',
    fullName: 'PACIENTE DE PRUEBA UNO',
    dateOfBirth: new Date('1980-05-12T00:00:00.000Z'),
    gender: 'M',
  };
  const EPS = { id: 'eps-1', nit: '800088702', name: 'Nueva EPS' };

  const eventoCrudo = (payload: Record<string, unknown> = {}) => ({
    seq: BigInt(1),
    eventId: 'e1',
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    payload: {
      id: 'apt-1',
      patientId: 'pat-1',
      scheduleSlotId: 'slot-1',
      epsId: 'eps-1',
      ...payload,
    },
    createdAt: new Date('2026-08-31T03:48:16.919Z'),
    deliveredAt: null,
    attempts: 0,
    deadLettered: false,
    nextAttemptAt: null,
  });

  /** Configura las cuatro consultas de la hidratación. */
  const conCatalogo = (opts: {
    slot?: boolean;
    paciente?: boolean;
    eps?: boolean;
    mapas?: { entityType: string; agenIAId: string; externalKey: string }[];
  }) => {
    prisma.scheduleSlot.findMany.mockResolvedValue(
      opts.slot === false ? [] : [SLOT],
    );
    prisma.patientProfile.findMany.mockResolvedValue(
      opts.paciente === false ? [] : [PACIENTE],
    );
    prisma.eps.findMany.mockResolvedValue(opts.eps === false ? [] : [EPS]);
    prisma.mirrorEntityMap.findMany.mockResolvedValue(
      opts.mapas ?? [
        { entityType: 'DOCTOR', agenIAId: 'doc-1', externalKey: '76' },
        { entityType: 'SERVICE', agenIAId: 'svc-1', externalKey: 'S39141-1' },
      ],
    );
  };

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
      scheduleSlot: { findMany: jest.fn(() => Promise.resolve([])) },
      patientProfile: { findMany: jest.fn(() => Promise.resolve([])) },
      eps: { findMany: jest.fn(() => Promise.resolve([])) },
      mirrorEntityMap: { findMany: jest.fn(() => Promise.resolve([])) },
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
    avisos = [];
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation((m: string) => avisos.push(m));
  });

  it('completa hora, médico, servicio, paciente y EPS', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context).toEqual({
      startTimeIso: '2026-09-03T12:20:00.000Z',
      endTimeIso: '2026-09-03T12:40:00.000Z',
      doctorExternalKey: '76',
      serviceExternalKey: 'S39141-1',
      patientDocument: '9696544',
      patientFullName: 'PACIENTE DE PRUEBA UNO',
      patientBirthDateIso: '1980-05-12T00:00:00.000Z',
      patientGender: 'M',
      epsNit: '800088702',
      epsName: 'Nueva EPS',
    });
  });

  it('conserva intacta la fila cruda del trigger junto al contexto', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.payload).toMatchObject({ id: 'apt-1', patientId: 'pat-1' });
  });

  it('sin homologación del médico, marca missingMappings y avisa', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({
      mapas: [
        { entityType: 'SERVICE', agenIAId: 'svc-1', externalKey: 'S39141-1' },
      ],
    });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toEqual(['DOCTOR doc-1']);
    expect(evento.context?.doctorExternalKey).toBeUndefined();
    expect(avisos[0]).toContain('SIN homologar');
  });

  it('acumula TODAS las homologaciones que faltan, no solo la primera', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({ mapas: [] });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toEqual([
      'DOCTOR doc-1',
      'SERVICE svc-1',
    ]);
  });

  it('un cupo que ya no existe se reporta, no se entrega a medias', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({ slot: false });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toContain('SLOT slot-1');
    expect(evento.context?.startTimeIso).toBeUndefined();
  });

  it('una cita particular (sin EPS) es válida: no falta nada', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([
      eventoCrudo({ epsId: null }),
    ]);
    conCatalogo({ eps: false });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toBeUndefined();
    expect(evento.context?.epsNit).toBeUndefined();
  });

  it('una cita que declara EPS pero no se encuentra SÍ es un problema', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({ eps: false });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toContain('EPS eps-1');
  });

  it('hidrata en LOTE: cuatro consultas, no cuatro por evento', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([
      eventoCrudo(),
      { ...eventoCrudo(), seq: BigInt(2), eventId: 'e2', entityId: 'apt-2' },
      { ...eventoCrudo(), seq: BigInt(3), eventId: 'e3', entityId: 'apt-3' },
    ]);
    conCatalogo({});

    await service.getPendingEvents('org1', BigInt(0));

    // Un lote de 100 citas producía 400 consultas sueltas antes de agrupar.
    expect(prisma.scheduleSlot.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.patientProfile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.eps.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mirrorEntityMap.findMany).toHaveBeenCalledTimes(1);
  });

  it('las consultas de hidratación filtran por organización', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});

    await service.getPendingEvents('org1', BigInt(0));

    for (const modelo of ['scheduleSlot', 'patientProfile', 'eps', 'mirrorEntityMap']) {
      expect(prisma[modelo].findMany.mock.calls[0][0].where.organizationId).toBe(
        'org1',
      );
    }
  });

  it('un evento que no es de cita no se hidrata ni consulta nada', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([
      { ...eventoCrudo(), entityType: 'SLOT' },
    ]);

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context).toBeUndefined();
    expect(prisma.scheduleSlot.findMany).not.toHaveBeenCalled();
  });

  it('un paciente sin nacimiento ni sexo no rompe la hidratación', async () => {
    // Pacientes creados antes de que el chatbot pidiera esos datos (bloque F).
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});
    prisma.patientProfile.findMany.mockResolvedValue([
      { ...PACIENTE, dateOfBirth: null, gender: null },
    ]);

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.patientDocument).toBe('9696544');
    expect(evento.context?.patientBirthDateIso).toBeUndefined();
    expect(evento.context?.missingMappings).toBeUndefined();
  });
});
