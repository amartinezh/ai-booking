import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MonitorService } from './monitor.service';
import { MonitorCheckers } from './monitor.checkers';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_SERVICES } from './services.config';

/**
 * El panel de estado. Su trabajo es que nadie tenga que abrir un log para
 * saber si el espejo con el HIS está escribiendo, así que un check que
 * revienta NO puede tumbar la respuesta entera: se reporta como DOWN.
 */
describe('MonitorService', () => {
  let service: MonitorService;
  let prisma: {
    serviceIncident: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let checkers: { checkService: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      serviceIncident: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    checkers = {
      checkService: jest.fn(async () => ({
        status: 'UP',
        latencyMs: 42,
      })),
    };
    config = { get: jest.fn((_k: string, def?: unknown) => def) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: MonitorCheckers, useValue: checkers },
      ],
    }).compile();

    service = module.get(MonitorService);
  });

  describe('runLiveCheck (MODO B — efímero)', () => {
    it('chequea todos los servicios activos y no escribe NADA en la base', async () => {
      const r = await service.runLiveCheck();

      expect(checkers.checkService).toHaveBeenCalledTimes(
        ACTIVE_SERVICES.length,
      );
      expect(r.services).toHaveLength(ACTIVE_SERVICES.length);
      expect(prisma.serviceIncident.deleteMany).not.toHaveBeenCalled();
    });

    it('cada servicio sale con su clave, nombre y grupo', async () => {
      const r = await service.runLiveCheck();

      for (const [i, svc] of ACTIVE_SERVICES.entries()) {
        expect(r.services[i]).toMatchObject({
          key: svc.key,
          displayName: svc.displayName,
          group: svc.group,
          status: 'UP',
          latencyMs: 42,
        });
      }
    });

    it('🛡️ un checker que revienta se reporta DOWN, no tumba la respuesta', async () => {
      checkers.checkService
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ status: 'UP', latencyMs: 1 });

      const r = await service.runLiveCheck();

      expect(r.services[0]).toMatchObject({
        status: 'DOWN',
        errorCode: 'UNHANDLED',
        latencyMs: null,
      });
      expect(r.services[1].status).toBe('UP');
    });

    it('el timestamp viaja en ISO', async () => {
      const r = await service.runLiveCheck();
      expect(new Date(r.timestamp).toISOString()).toBe(r.timestamp);
    });
  });

  describe('listIncidents — filtros del histórico', () => {
    const listar = (f: Parameters<MonitorService['listIncidents']>[0]) =>
      service.listIncidents(f);
    const whereUsado = () =>
      prisma.serviceIncident.findMany.mock.calls[0][0].where;

    it('sin filtros no restringe nada y ordena del más reciente al más viejo', async () => {
      await listar({});

      expect(whereUsado()).toEqual({});
      expect(prisma.serviceIncident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { startedAt: 'desc' } }),
      );
    });

    it('el rango de fechas se traduce a gte/lte', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-02-01T00:00:00Z');
      await listar({ from, to });
      expect(whereUsado().startedAt).toEqual({ gte: from, lte: to });
    });

    it('solo `from` deja el rango abierto por arriba', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      await listar({ from });
      expect(whereUsado().startedAt).toEqual({ gte: from });
    });

    it('la lista de servicios se traduce a un IN', async () => {
      await listar({ services: ['mirror', 'meta'] });
      expect(whereUsado().serviceKey).toEqual({ in: ['mirror', 'meta'] });
    });

    it('una lista de servicios VACÍA no filtra', async () => {
      await listar({ services: [] });
      expect(whereUsado().serviceKey).toBeUndefined();
    });

    it.each([
      ['open', null],
      ['resolved', { not: null }],
    ])('status=%s filtra por resolvedAt', async (status, esperado) => {
      await listar({ status: status as 'open' | 'resolved' });
      expect(whereUsado().resolvedAt).toEqual(esperado);
    });

    it('status=all no filtra', async () => {
      await listar({ status: 'all' });
      expect(whereUsado().resolvedAt).toBeUndefined();
    });

    it('la búsqueda libre mira mensaje, código y servicio, sin distinguir mayúsculas', async () => {
      await listar({ search: '  TIMEOUT  ' });
      expect(whereUsado().OR).toEqual([
        { errorMessage: { contains: 'TIMEOUT', mode: 'insensitive' } },
        { errorCode: { contains: 'TIMEOUT', mode: 'insensitive' } },
        { serviceKey: { contains: 'TIMEOUT', mode: 'insensitive' } },
      ]);
    });

    it('una búsqueda en blanco no genera cláusula', async () => {
      await listar({ search: '   ' });
      expect(whereUsado().OR).toBeUndefined();
    });

    it('el límite se acota entre 1 y 500 y el offset nunca es negativo', async () => {
      const args = () => prisma.serviceIncident.findMany.mock.calls.at(-1)![0];

      await listar({ limit: 9999, offset: -5 });
      expect(args()).toMatchObject({ take: 500, skip: 0 });

      await listar({ limit: 0 });
      expect(args().take).toBe(1);

      await listar({});
      expect(args().take).toBe(50);
    });

    it('devuelve filas y total con el MISMO where', async () => {
      prisma.serviceIncident.findMany.mockResolvedValue([{ id: 'i1' }]);
      prisma.serviceIncident.count.mockResolvedValue(7);

      const r = await listar({ services: ['mirror'] });

      expect(r).toEqual({ rows: [{ id: 'i1' }], total: 7 });
      expect(prisma.serviceIncident.count).toHaveBeenCalledWith({
        where: { serviceKey: { in: ['mirror'] } },
      });
    });
  });

  describe('getIncident', () => {
    it('busca por id', async () => {
      prisma.serviceIncident.findUnique.mockResolvedValue({ id: 'i1' });
      await expect(service.getIncident('i1')).resolves.toEqual({ id: 'i1' });
      expect(prisma.serviceIncident.findUnique).toHaveBeenCalledWith({
        where: { id: 'i1' },
      });
    });
  });

  describe('summary', () => {
    it('sin incidentes, todo en cero y la media en null (no en 0: son cosas distintas)', async () => {
      await expect(service.summary(30)).resolves.toEqual({
        periodDays: 30,
        total: 0,
        open: 0,
        resolved: 0,
        avgDurationMs: null,
      });
    });

    it('separa abiertos de resueltos y promedia solo la duración de los cerrados', async () => {
      prisma.serviceIncident.findMany.mockResolvedValue([
        {
          startedAt: new Date('2026-01-01T00:00:00Z'),
          resolvedAt: new Date('2026-01-01T00:01:00Z'), // 60 s
        },
        {
          startedAt: new Date('2026-01-02T00:00:00Z'),
          resolvedAt: new Date('2026-01-02T00:03:00Z'), // 180 s
        },
        { startedAt: new Date('2026-01-03T00:00:00Z'), resolvedAt: null },
      ]);

      await expect(service.summary(7)).resolves.toEqual({
        periodDays: 7,
        total: 3,
        open: 1,
        resolved: 2,
        avgDurationMs: 120_000,
      });
    });

    it('el periodo se traduce a una ventana desde hace N días', async () => {
      const antes = Date.now();
      await service.summary(10);

      const gte = prisma.serviceIncident.findMany.mock.calls[0][0].where
        .startedAt.gte as Date;
      const dias = (antes - gte.getTime()) / 86_400_000;
      expect(dias).toBeCloseTo(10, 2);
    });
  });

  describe('deleteBefore', () => {
    it('solo borra RESUELTOS anteriores al corte: un incidente abierto nunca se pierde', async () => {
      prisma.serviceIncident.deleteMany.mockResolvedValue({ count: 12 });
      const corte = new Date('2026-01-01T00:00:00Z');

      await expect(service.deleteBefore(corte)).resolves.toBe(12);
      expect(prisma.serviceIncident.deleteMany).toHaveBeenCalledWith({
        where: { resolvedAt: { not: null, lt: corte } },
      });
    });
  });

  describe('meta', () => {
    it('con los valores por defecto', () => {
      const m = service.meta();
      expect(m.bgEnabled).toBe(true);
      expect(m.bgIntervalMinutes).toBe(15);
      expect(m.liveIntervalSeconds).toBe(5);
      expect(m.services.length).toBeGreaterThan(0);
      expect(m.services[0]).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it('respeta lo que diga el .env', () => {
      config.get.mockImplementation((k: string, def?: unknown) => {
        if (k === 'MONITOR_ENABLED') return 'false';
        if (k === 'MONITOR_BG_INTERVAL_MINUTES') return '30';
        if (k === 'MONITOR_LIVE_INTERVAL_SECONDS') return '10';
        return def;
      });

      expect(service.meta()).toMatchObject({
        bgEnabled: false,
        bgIntervalMinutes: 30,
        liveIntervalSeconds: 10,
      });
    });

    it('el catálogo incluye el espejo con el HIS', () => {
      expect(service.meta().services.map((s) => s.key)).toContain('mirror');
    });
  });
});
