import { Test, TestingModule } from '@nestjs/testing';
import { SystemLogService } from './system-log.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El diario del sistema. Como el `InteractionLog`, es fire-and-forget: si
 * escribirlo falla, el flujo que lo invocó (un cron de recordatorios, el
 * filtro global de excepciones) tiene que seguir. Y sus textos van acotados,
 * porque quien más lo llama es un manejador de errores con stacks enormes.
 */
describe('SystemLogService', () => {
  let service: SystemLogService;
  let prisma: {
    systemLog: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const datos = () => prisma.systemLog.create.mock.calls[0][0].data;

  beforeEach(async () => {
    prisma = {
      systemLog: {
        create: jest.fn(async () => ({})),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (ops: unknown[]) =>
        Promise.all(ops as never),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemLogService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(SystemLogService);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('escritura', () => {
    it.each([
      ['event', 'EVENT'],
      ['warning', 'WARNING'],
      ['error', 'ERROR'],
    ])('%s escribe con nivel %s', async (metodo, nivel) => {
      await (
        service as unknown as Record<string, (i: unknown) => Promise<void>>
      )[metodo]({ action: 'X', message: 'y' });

      expect(datos().level).toBe(nivel);
    });

    it('los opcionales ausentes se guardan como null', async () => {
      await service.event({ action: 'X', message: 'y' });

      expect(datos()).toMatchObject({
        metadata: null,
        userId: null,
        organizationId: null,
      });
    });

    it('conserva metadata, usuario y clínica cuando vienen', async () => {
      await service.error({
        action: 'X',
        message: 'y',
        metadata: { a: 1 },
        userId: 'u-1',
        organizationId: 'org-1',
      });

      expect(datos()).toMatchObject({
        metadata: { a: 1 },
        userId: 'u-1',
        organizationId: 'org-1',
      });
    });

    it('la acción se recorta a 120 caracteres (cabe en el índice)', async () => {
      await service.event({ action: 'A'.repeat(300), message: 'y' });

      expect(datos().action).toHaveLength(120);
      expect(datos().action.endsWith('...')).toBe(true);
    });

    it('el mensaje se recorta a 8000: un stack entero no puede reventar el INSERT', async () => {
      await service.error({ action: 'X', message: 'M'.repeat(20000) });

      expect(datos().message).toHaveLength(8000);
    });

    it('un texto justo en el límite no se toca', async () => {
      await service.event({ action: 'A'.repeat(120), message: 'y' });
      expect(datos().action).toBe('A'.repeat(120));
    });

    it('🛡️ si la BD falla, NO propaga: quien llamó era un manejador de errores', async () => {
      prisma.systemLog.create.mockRejectedValue(new Error('BD caída'));

      await expect(
        service.error({ action: 'X', message: 'y' }),
      ).resolves.toBeUndefined();
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('No se pudo persistir'),
      );
    });
  });

  describe('list', () => {
    const consulta = () => prisma.systemLog.findMany.mock.calls[0][0];

    it('sin filtros trae la primera página, de lo más nuevo a lo más viejo', async () => {
      const r = await service.list({});

      expect(consulta()).toMatchObject({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 25,
      });
      expect(r).toMatchObject({ page: 1, pageSize: 25, totalPages: 1 });
    });

    it('filtra por nivel, pero «ALL» no filtra', async () => {
      await service.list({ level: 'ERROR' });
      expect(consulta().where.level).toBe('ERROR');

      prisma.systemLog.findMany.mockClear();
      await service.list({ level: 'ALL' });
      expect(consulta().where.level).toBeUndefined();
    });

    it('la búsqueda libre mira acción y mensaje sin distinguir mayúsculas', async () => {
      await service.list({ search: '  REMINDER  ' });

      expect(consulta().where.OR).toEqual([
        { action: { contains: 'REMINDER', mode: 'insensitive' } },
        { message: { contains: 'REMINDER', mode: 'insensitive' } },
      ]);
    });

    it('una búsqueda en blanco no genera cláusula', async () => {
      await service.list({ search: '   ' });
      expect(consulta().where.OR).toBeUndefined();
    });

    it.each([
      ['página 0 → 1', { page: 0 }, { skip: 0 }],
      ['página 3 de 10', { page: 3, pageSize: 10 }, { skip: 20 }],
    ])('%s', async (_e, params, esperado) => {
      await service.list(params);
      expect(consulta().skip).toBe(esperado.skip);
    });

    it.each([
      ['tamaño 1 sube al mínimo de 5', 1, 5],
      ['tamaño 500 baja al tope de 100', 500, 100],
    ])('%s', async (_e, pageSize, esperado) => {
      const r = await service.list({ pageSize });
      expect(r.pageSize).toBe(esperado);
      expect(consulta().take).toBe(esperado);
    });

    it('count y findMany comparten el MISMO where, en una transacción', async () => {
      await service.list({ level: 'ERROR', search: 'x' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.systemLog.count.mock.calls[0][0].where).toEqual(
        consulta().where,
      );
    });

    it('el total de páginas redondea hacia arriba y nunca es 0', async () => {
      prisma.systemLog.count.mockResolvedValue(26);
      await expect(service.list({ pageSize: 25 })).resolves.toMatchObject({
        totalPages: 2,
      });

      prisma.systemLog.count.mockResolvedValue(0);
      await expect(service.list({})).resolves.toMatchObject({ totalPages: 1 });
    });
  });

  describe('recentErrors — la alerta roja del panel', () => {
    const consulta = () => prisma.systemLog.findMany.mock.calls[0][0];

    it('solo errores, solo de las últimas 24 h, los más recientes primero', async () => {
      const antes = Date.now();
      await service.recentErrors();

      expect(consulta().where.level).toBe('ERROR');
      const desde = consulta().where.createdAt.gte as Date;
      const horas = (antes - desde.getTime()) / 3_600_000;
      expect(horas).toBeCloseTo(24, 1);
      expect(consulta().orderBy).toEqual({ createdAt: 'desc' });
    });

    it.each([
      ['por defecto', undefined, 5],
      ['límite 0 sube a 1', 0, 1],
      ['límite negativo sube a 1', -3, 1],
      ['límite 100 baja a 20', 100, 20],
      ['límite 10 se respeta', 10, 10],
    ])('%s', async (_e, limit, esperado) => {
      await service.recentErrors(limit as number);
      expect(consulta().take).toBe(esperado);
    });
  });

  it('getById busca por id', async () => {
    await service.getById('l-1');
    expect(prisma.systemLog.findUnique).toHaveBeenCalledWith({
      where: { id: 'l-1' },
    });
  });
});
