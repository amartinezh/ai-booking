import { RetentionService } from './retention.service';

/**
 * La purga de retención (§12 #4). Lo que se fija:
 *  · borra SOLO lo anterior al plazo, en cada tabla con SU plazo;
 *  · un plazo mal escrito en el entorno no puede acortarlo por debajo del mínimo;
 *  · borra por lotes y se detiene a tiempo (lo que falte sigue la noche siguiente);
 *  · deja constancia sin datos personales, y no escribe nada si no borró nada.
 */
describe('RetentionService', () => {
  const AHORA = new Date('2026-09-23T08:30:00.000Z');
  const DIA = 86_400_000;
  const haceDias = (d: number) => new Date(AHORA.getTime() - d * DIA);

  const build = (
    opts: {
      env?: Record<string, string>;
      /** Tamaños de los lotes que devuelve cada búsqueda, en orden. */
      conversaciones?: number[];
      consultas?: number[];
    } = {},
  ) => {
    const lotes = (tamanos: number[]) => {
      let i = 0;
      return jest.fn(async (..._a: unknown[]) => {
        const n = tamanos[i] ?? 0;
        i++;
        return Array.from({ length: n }, (_x, k) => ({ id: `id-${i}-${k}` }));
      });
    };
    const prisma = {
      interactionLog: {
        findMany: lotes(opts.conversaciones ?? []),
        deleteMany: jest.fn(
          async (arg: { where: { id: { in: string[] } } }) => ({
            count: arg.where.id.in.length,
          }),
        ),
      },
      patientLookupLog: {
        findMany: lotes(opts.consultas ?? []),
        deleteMany: jest.fn(
          async (arg: { where: { id: { in: string[] } } }) => ({
            count: arg.where.id.in.length,
          }),
        ),
      },
    };
    const config = { get: jest.fn((k: string) => opts.env?.[k]) };
    const systemLog = { event: jest.fn(async (..._a: unknown[]) => undefined) };
    const service = new RetentionService(
      prisma as never,
      config as never,
      systemLog as never,
    );
    return { service, prisma, systemLog };
  };

  const corte = (m: jest.Mock) =>
    (m.mock.calls[0][0] as { where: { createdAt: { lt: Date } } }).where
      .createdAt.lt;

  it('conversaciones: borra lo de hace más de 180 días; bitácora del rastreo: más de 365', async () => {
    const { service, prisma } = build({ conversaciones: [3], consultas: [2] });

    const r = await service.purgar(AHORA);

    expect(corte(prisma.interactionLog.findMany)).toEqual(haceDias(180));
    expect(corte(prisma.patientLookupLog.findMany)).toEqual(haceDias(365));
    expect(r).toEqual({
      conversaciones: { dias: 180, borradas: 3, completa: true },
      consultasRastreo: { dias: 365, borradas: 2, completa: true },
    });
    // Borra exactamente las filas que encontró, por id.
    expect(prisma.interactionLog.deleteMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['id-1-0', 'id-1-1', 'id-1-2'] } },
    });
  });

  it('el plazo se puede ajustar por entorno', async () => {
    const { service, prisma } = build({
      env: {
        RETENCION_CONVERSACIONES_DIAS: '90',
        RETENCION_BITACORA_RASTREO_DIAS: '730',
      },
    });
    const r = await service.purgar(AHORA);
    expect(corte(prisma.interactionLog.findMany)).toEqual(haceDias(90));
    expect(corte(prisma.patientLookupLog.findMany)).toEqual(haceDias(730));
    expect(r.conversaciones.dias).toBe(90);
  });

  it('🛡️ un plazo por debajo del mínimo o ilegible NO se aplica: se usa el de por defecto', async () => {
    const { service, prisma } = build({
      env: {
        RETENCION_CONVERSACIONES_DIAS: '1',
        RETENCION_BITACORA_RASTREO_DIAS: 'un año',
      },
    });
    await service.purgar(AHORA);
    expect(corte(prisma.interactionLog.findMany)).toEqual(haceDias(180));
    expect(corte(prisma.patientLookupLog.findMany)).toEqual(haceDias(365));
  });

  it('borra por lotes hasta que un lote sale incompleto', async () => {
    const { service, prisma } = build({ conversaciones: [5000, 5000, 12] });
    const r = await service.purgar(AHORA);
    expect(prisma.interactionLog.deleteMany).toHaveBeenCalledTimes(3);
    expect(r.conversaciones).toEqual({
      dias: 180,
      borradas: 10_012,
      completa: true,
    });
  });

  it('se detiene tras el tope de lotes por noche y dice que quedó pendiente', async () => {
    const { service, prisma, systemLog } = build({
      conversaciones: Array.from({ length: 250 }, () => 5000),
    });
    const r = await service.purgar(AHORA);
    expect(prisma.interactionLog.deleteMany).toHaveBeenCalledTimes(200);
    expect(r.conversaciones.completa).toBe(false);
    expect(systemLog.event).toHaveBeenCalledTimes(1);
  });

  it('deja constancia de cuánto borró, sin ningún dato de las filas', async () => {
    const { service, systemLog } = build({ conversaciones: [3] });
    await service.purgar(AHORA);
    const arg = systemLog.event.mock.calls[0][0] as {
      action: string;
      metadata: unknown;
    };
    expect(arg.action).toBe('DATA_RETENTION_PURGE');
    expect(JSON.stringify(arg)).not.toMatch(/id-1-/);
  });

  it('sin nada que borrar no escribe nada en la bitácora del sistema', async () => {
    const { service, systemLog, prisma } = build();
    await service.purgar(AHORA);
    expect(prisma.interactionLog.deleteMany).not.toHaveBeenCalled();
    expect(systemLog.event).not.toHaveBeenCalled();
  });

  it('el cron no se monta sobre sí mismo ni deja escapar un error', async () => {
    const { service, prisma } = build();
    prisma.interactionLog.findMany.mockRejectedValueOnce(new Error('db caída'));
    await expect(service.purgarCron()).resolves.toBeUndefined();
    // Tras el error se puede volver a correr (el candado se suelta).
    await expect(service.purgarCron()).resolves.toBeUndefined();
    expect(prisma.interactionLog.findMany).toHaveBeenCalledTimes(2);
  });
});
