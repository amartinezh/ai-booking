import { InboundQueueService } from './inbound-queue.service';

// Fake Redis con semántica SET ... NX (suficiente para el dedup).
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(
      (k: string, v: string, _ex: string, _ttl: number, nx?: string) => {
        if (nx === 'NX' && store.has(k)) return null;
        store.set(k, String(v));
        return 'OK';
      },
    ),
    del: jest.fn((...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('InboundQueueService', () => {
  afterEach(() => {
    delete process.env.INBOUND_MAX_QUEUE;
    delete process.env.INBOUND_MAX_CONCURRENCY;
    delete process.env.INBOUND_DEDUP_TTL_SECONDS;
  });

  describe('deduplicación (admit / releaseAdmission)', () => {
    it('admite la primera vez y rechaza el duplicado', async () => {
      const q = new InboundQueueService(fakeRedis() as any);
      expect(await q.admit('w1')).toBe(true);
      expect(await q.admit('w1')).toBe(false);
    });

    it('sin wamid siempre admite (no se puede deduplicar)', async () => {
      const q = new InboundQueueService(fakeRedis() as any);
      expect(await q.admit(undefined)).toBe(true);
      expect(await q.admit(undefined)).toBe(true);
    });

    it('releaseAdmission permite volver a admitir el mismo wamid', async () => {
      const q = new InboundQueueService(fakeRedis() as any);
      expect(await q.admit('w1')).toBe(true);
      await q.releaseAdmission('w1');
      expect(await q.admit('w1')).toBe(true);
    });

    it('fail-open: si Redis falla, admite el mensaje (no lo pierde)', async () => {
      const redis = fakeRedis();
      redis.set.mockRejectedValueOnce(new Error('redis down') as never);
      const q = new InboundQueueService(redis as any);
      expect(await q.admit('w1')).toBe(true);
    });
  });

  describe('serialización por remitente (#3)', () => {
    it('procesa los mensajes de un mismo remitente uno a uno y en orden', async () => {
      const q = new InboundQueueService(fakeRedis() as any);
      const order: string[] = [];
      let concurrent = 0;
      let maxConcurrent = 0;
      const mk = (label: string) => async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(10);
        order.push(label);
        concurrent--;
      };

      expect(q.enqueue('sender', mk('a'))).toBe(true);
      expect(q.enqueue('sender', mk('b'))).toBe(true);
      expect(q.enqueue('sender', mk('c'))).toBe(true);

      await delay(80);
      expect(order).toEqual(['a', 'b', 'c']);
      expect(maxConcurrent).toBe(1);
    });
  });

  describe('backpressure (#6)', () => {
    it('rechaza cuando se supera INBOUND_MAX_QUEUE y vuelve a aceptar al drenar', async () => {
      process.env.INBOUND_MAX_QUEUE = '2';
      process.env.INBOUND_MAX_CONCURRENCY = '1';
      const q = new InboundQueueService(fakeRedis() as any);
      const task = () => delay(40);

      expect(q.enqueue('s1', task)).toBe(true);
      expect(q.enqueue('s2', task)).toBe(true);
      expect(q.enqueue('s3', task)).toBe(false); // cola llena
      expect(q.inFlight).toBe(2);

      await delay(140);
      expect(q.inFlight).toBe(0);
      expect(q.enqueue('s4', task)).toBe(true); // ya drenó
      await delay(80);
    });

    it('respeta INBOUND_MAX_CONCURRENCY entre remitentes distintos', async () => {
      process.env.INBOUND_MAX_CONCURRENCY = '2';
      process.env.INBOUND_MAX_QUEUE = '100';
      const q = new InboundQueueService(fakeRedis() as any);
      let concurrent = 0;
      let maxConcurrent = 0;
      const mk = () => async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(20);
        concurrent--;
      };

      for (let i = 0; i < 6; i++) q.enqueue('s' + i, mk());
      await delay(150);
      expect(maxConcurrent).toBe(2);
    });
  });
});
