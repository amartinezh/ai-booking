import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MonitorCron } from './monitor.cron';
import { MonitorCheckers } from './monitor.checkers';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_SERVICES } from './services.config';

/**
 * MODO A — el centinela de fondo. Solo escribe en TRANSICIONES: abrir el
 * incidente cuando algo se cae, cerrarlo cuando vuelve. Persistir estados
 * estacionarios convertiría la tabla en un vertedero y haría inútil el panel.
 *
 * Dos garantías defensivas que ya costaron un incidente:
 *  - Si la tabla no existe todavía, el monitor arranca igual: no puede tumbar
 *    el arranque de TODA la API por su propia migración.
 *  - `runHealthChecks` nunca relanza: el cron tiene que sobrevivir al tick.
 */
describe('MonitorCron', () => {
  let cron: MonitorCron;
  let prisma: {
    serviceIncident: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let checkers: { checkService: jest.Mock };
  let config: { get: jest.Mock };
  let scheduler: { addCronJob: jest.Mock };
  /** Los CronJob reales arrancan temporizadores; hay que pararlos al terminar. */
  let jobs: { stop: () => void }[];

  const UP = { status: 'UP', latencyMs: 10 };
  const DOWN = {
    status: 'DOWN',
    latencyMs: null,
    errorCode: 'TIMEOUT',
    errorMessage: 'no respondió',
    httpStatus: 504,
  };

  /** Ejecuta un ciclo de chequeo sin pasar por el cron real. */
  const tick = () => (cron as any).runHealthChecks();

  beforeEach(async () => {
    prisma = {
      serviceIncident: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => ({ id: 'inc-1', ...data })),
        update: jest.fn(async () => ({
          serviceKey: 'mirror',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          resolvedAt: new Date('2026-01-01T00:05:00Z'),
        })),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    checkers = { checkService: jest.fn(async () => UP) };
    config = { get: jest.fn((_k: string, def?: unknown) => def) };
    jobs = [];
    scheduler = {
      addCronJob: jest.fn((_n: string, job: { stop: () => void }) => {
        jobs.push(job);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorCron,
        { provide: SchedulerRegistry, useValue: scheduler },
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: MonitorCheckers, useValue: checkers },
      ],
    }).compile();

    cron = module.get(MonitorCron);
    jest.spyOn((cron as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((cron as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const job of jobs) job.stop();
  });

  describe('onModuleInit', () => {
    it('registra el chequeo periódico y la limpieza diaria', async () => {
      await cron.onModuleInit();

      const nombres = scheduler.addCronJob.mock.calls.map((c) => c[0]);
      expect(nombres).toEqual(['monitorBgCheck', 'monitorCleanup']);
    });

    it('MONITOR_ENABLED=false lo deja apagado, sin registrar nada', async () => {
      config.get.mockImplementation((k: string, def?: unknown) =>
        k === 'MONITOR_ENABLED' ? 'false' : def,
      );

      await cron.onModuleInit();

      expect(scheduler.addCronJob).not.toHaveBeenCalled();
      expect(checkers.checkService).not.toHaveBeenCalled();
    });

    it('el intervalo del .env llega a la expresión cron', async () => {
      config.get.mockImplementation((k: string, def?: unknown) =>
        k === 'MONITOR_BG_INTERVAL_MINUTES' ? '5' : def,
      );

      await cron.onModuleInit();

      expect((cron as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('*/5 * * * *'),
      );
    });

    it('reconstruye el estado desde los incidentes abiertos: no duplica al reiniciar', async () => {
      prisma.serviceIncident.findMany.mockResolvedValue([
        { id: 'inc-viejo', serviceKey: 'mirror', status: 'DOWN' },
      ]);
      checkers.checkService.mockResolvedValue(DOWN);

      await cron.onModuleInit();

      // Sigue caído: no debe abrirse un segundo incidente para 'mirror'.
      const abiertos = prisma.serviceIncident.create.mock.calls.filter(
        (c) => c[0].data.serviceKey === 'mirror',
      );
      expect(abiertos).toHaveLength(0);
      expect(prisma.serviceIncident.findMany).toHaveBeenCalledWith({
        where: { resolvedAt: null },
      });
    });

    it('🛡️ si la tabla no existe, el monitor arranca igual y NO tumba la API', async () => {
      prisma.serviceIncident.findMany.mockRejectedValue(
        new Error('relation "ServiceIncident" does not exist'),
      );

      await expect(cron.onModuleInit()).resolves.toBeUndefined();
      expect(scheduler.addCronJob).toHaveBeenCalled();
      expect((cron as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('migración'),
      );
    });

    it('hace una verificación inmediata para no esperar al primer tick', async () => {
      await cron.onModuleInit();
      await new Promise((r) => setImmediate(r));
      expect(checkers.checkService).toHaveBeenCalled();
    });
  });

  describe('transiciones de estado', () => {
    it('primera observación en UP no escribe nada', async () => {
      await tick();
      expect(prisma.serviceIncident.create).not.toHaveBeenCalled();
    });

    it('primera observación CAÍDO abre incidente con el detalle del fallo', async () => {
      checkers.checkService.mockResolvedValue(DOWN);

      await tick();

      expect(prisma.serviceIncident.create).toHaveBeenCalledTimes(
        ACTIVE_SERVICES.length,
      );
      expect(prisma.serviceIncident.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'DOWN',
          errorCode: 'TIMEOUT',
          errorMessage: 'no respondió',
          httpStatus: 504,
          latencyMs: null,
        }),
      });
    });

    it('UP → DOWN abre incidente', async () => {
      await tick(); // UP
      checkers.checkService.mockResolvedValue(DOWN);
      await tick(); // DOWN

      expect(prisma.serviceIncident.create).toHaveBeenCalledTimes(
        ACTIVE_SERVICES.length,
      );
    });

    it('DOWN → DOWN no vuelve a escribir: los estados estacionarios no se persisten', async () => {
      checkers.checkService.mockResolvedValue(DOWN);
      await tick();
      prisma.serviceIncident.create.mockClear();

      await tick();
      await tick();

      expect(prisma.serviceIncident.create).not.toHaveBeenCalled();
    });

    it('DOWN → DEGRADED tampoco: sigue caído, es el mismo incidente', async () => {
      checkers.checkService.mockResolvedValue(DOWN);
      await tick();
      prisma.serviceIncident.create.mockClear();

      checkers.checkService.mockResolvedValue({ ...DOWN, status: 'DEGRADED' });
      await tick();

      expect(prisma.serviceIncident.create).not.toHaveBeenCalled();
      expect(prisma.serviceIncident.update).not.toHaveBeenCalled();
    });

    it('DOWN → UP cierra el incidente con su hora de resolución', async () => {
      checkers.checkService.mockResolvedValue(DOWN);
      await tick();

      checkers.checkService.mockResolvedValue(UP);
      await tick();

      expect(prisma.serviceIncident.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: { resolvedAt: expect.any(Date) },
      });
    });

    it('UP → UP no escribe nada', async () => {
      await tick();
      await tick();
      expect(prisma.serviceIncident.create).not.toHaveBeenCalled();
      expect(prisma.serviceIncident.update).not.toHaveBeenCalled();
    });

    it('un servicio marcado `skip` no abre ni cierra nada (no aplica en este ciclo)', async () => {
      checkers.checkService.mockResolvedValue({
        status: 'DOWN',
        latencyMs: null,
        skip: true,
      });

      await tick();

      expect(prisma.serviceIncident.create).not.toHaveBeenCalled();
    });

    it('un checker que revienta cuenta como DOWN, con el motivo real', async () => {
      checkers.checkService.mockRejectedValue(new Error('socket hang up'));

      await tick();

      expect(prisma.serviceIncident.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorCode: 'UNHANDLED',
          errorMessage: 'socket hang up',
        }),
      });
    });

    it('🛡️ runHealthChecks NUNCA relanza: el cron sobrevive al siguiente tick', async () => {
      checkers.checkService.mockResolvedValue(DOWN);
      prisma.serviceIncident.create.mockRejectedValue(
        new Error('BD desconectada'),
      );

      await expect(tick()).resolves.toBeUndefined();
      expect((cron as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('crasheó'),
        expect.anything(),
      );
    });
  });

  describe('limpieza de incidentes viejos', () => {
    it('borra los resueltos anteriores a la retención configurada', async () => {
      config.get.mockImplementation((k: string, def?: unknown) =>
        k === 'MONITOR_RETENTION_DAYS' ? '30' : def,
      );

      await (cron as any).cleanOldIncidents();

      const corte = prisma.serviceIncident.deleteMany.mock.calls[0][0].where
        .resolvedAt.lt as Date;
      const dias = (Date.now() - corte.getTime()) / 86_400_000;
      expect(dias).toBeCloseTo(30, 2);
      expect(
        prisma.serviceIncident.deleteMany.mock.calls[0][0].where.resolvedAt.not,
      ).toBeNull();
    });

    it('por defecto retiene un año', async () => {
      await (cron as any).cleanOldIncidents();

      const corte = prisma.serviceIncident.deleteMany.mock.calls[0][0].where
        .resolvedAt.lt as Date;
      const dias = (Date.now() - corte.getTime()) / 86_400_000;
      expect(dias).toBeCloseTo(365, 1);
    });
  });
});
