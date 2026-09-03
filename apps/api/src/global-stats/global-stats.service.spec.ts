import { Test, TestingModule } from '@nestjs/testing';
import { GlobalStatsService } from './global-stats.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Los dos tableros de métricas. Comparten dos reglas duras del producto:
 *
 *  - **Nunca registros crudos.** Solo `_count`, `groupBy` y agregados en SQL.
 *    Un `findMany` sin límite sobre citas es un volcado de datos de salud.
 *  - **La fecha correcta por modelo.** Una cita se cuenta por
 *    `scheduleSlot.startTime` (cuándo se atiende), no por `createdAt` (cuándo
 *    se reservó): con `createdAt`, un tablero de "citas de mayo" mostraría las
 *    que se agendaron en mayo para junio.
 */
describe('GlobalStatsService', () => {
  let service: GlobalStatsService;
  let prisma: any;

  const ORG = 'org-1';

  beforeEach(async () => {
    prisma = {
      systemLog: { count: jest.fn(async () => 1) },
      appointment: {
        count: jest.fn(async () => 2),
        groupBy: jest.fn(async () => [
          { organizationId: 'a' },
          { organizationId: 'b' },
        ]),
      },
      patientProfile: { count: jest.fn(async () => 3) },
      clinicalRecord: {
        count: jest.fn(async () => 4),
        groupBy: jest.fn(async () => [{ organizationId: 'b' }]),
      },
      addendum: { count: jest.fn(async () => 5) },
      organization: { findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async () => [
        { day: new Date('2026-05-10T00:00:00Z'), count: 7n },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlobalStatsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(GlobalStatsService);
  });

  describe('resolución del rango temporal', () => {
    const rango = async (
      filtros: Parameters<typeof service.getGlobalStats>[0],
    ) => {
      const r = await service.getGlobalStats(filtros);
      return {
        gte: new Date(r.filters.startDate),
        lte: new Date(r.filters.endDate),
      };
    };

    it('CUSTOM respeta las fechas dadas, de medianoche a fin del día', async () => {
      const { gte, lte } = await rango({
        range: 'CUSTOM',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      });

      expect(gte.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      expect(lte.toISOString()).toBe('2026-05-31T23:59:59.999Z');
    });

    it('CUSTOM sin fechas cae al mes actual, no a un rango vacío', async () => {
      const { gte, lte } = await rango({ range: 'CUSTOM' });
      const ahora = new Date();
      expect(gte.getUTCMonth()).toBe(ahora.getUTCMonth());
      expect(lte.getTime()).toBeGreaterThan(gte.getTime());
    });

    it('TODAY cubre exactamente el día en curso', async () => {
      const { gte, lte } = await rango({ range: 'TODAY' });
      expect(gte.getUTCHours()).toBe(0);
      expect(lte.getUTCHours()).toBe(23);
      expect(gte.toISOString().slice(0, 10)).toBe(
        lte.toISOString().slice(0, 10),
      );
    });

    it('WEEK va de lunes a domingo, siete días completos', async () => {
      const { gte, lte } = await rango({ range: 'WEEK' });
      expect(gte.getUTCDay()).toBe(1); // lunes
      expect(lte.getUTCDay()).toBe(0); // domingo
      const dias = (lte.getTime() - gte.getTime()) / 86_400_000;
      expect(dias).toBeCloseTo(7, 0);
    });

    it('YEAR va del 1 de enero al 31 de diciembre', async () => {
      const { gte, lte } = await rango({ range: 'YEAR' });
      expect(gte.getUTCMonth()).toBe(0);
      expect(gte.getUTCDate()).toBe(1);
      expect(lte.getUTCMonth()).toBe(11);
      expect(lte.getUTCDate()).toBe(31);
    });

    it.each([
      ['MONTH explícito', 'MONTH'],
      ['sin rango', undefined],
    ])('%s cubre el mes en curso completo', async (_e, range) => {
      const { gte, lte } = await rango({ range: range as never });
      expect(gte.getUTCDate()).toBe(1);
      expect(lte.getUTCMonth()).toBe(gte.getUTCMonth());
      // El último día del mes, sea cual sea su longitud.
      const finDeMes = new Date(
        Date.UTC(lte.getUTCFullYear(), lte.getUTCMonth() + 1, 0),
      ).getUTCDate();
      expect(lte.getUTCDate()).toBe(finDeMes);
    });
  });

  describe('filtro por clínica', () => {
    it('con clínica, TODOS los contadores la llevan', async () => {
      await service.getGlobalStats({ organizationId: ORG, range: 'MONTH' });

      for (const llamada of prisma.systemLog.count.mock.calls) {
        expect(llamada[0].where.organizationId).toBe(ORG);
      }
      for (const llamada of prisma.appointment.count.mock.calls) {
        expect(llamada[0].where.organizationId).toBe(ORG);
      }
      expect(
        prisma.patientProfile.count.mock.calls[0][0].where.organizationId,
      ).toBe(ORG);
    });

    it('sin clínica (vista global) no se filtra por ninguna', async () => {
      await service.getGlobalStats({ range: 'MONTH' });

      expect(
        prisma.patientProfile.count.mock.calls[0][0].where.organizationId,
      ).toBeUndefined();
    });

    it('una clínica en blanco cuenta como global, no como clínica ""', async () => {
      const r = await service.getGlobalStats({ organizationId: '   ' });
      expect(r.filters.organizationId).toBeNull();
    });
  });

  describe('las citas se cuentan por la fecha de ATENCIÓN, no la de reserva', () => {
    it('el filtro va sobre scheduleSlot.startTime', async () => {
      await service.getGlobalStats({ range: 'MONTH' });

      const where = prisma.appointment.count.mock.calls[0][0].where;
      expect(where.scheduleSlot.startTime).toEqual({
        gte: expect.any(Date),
        lte: expect.any(Date),
      });
      expect(where.createdAt).toBeUndefined();
    });

    it('«fallidas» incluye canceladas Y las que el paciente no atendió', async () => {
      await service.getGlobalStats({ range: 'MONTH' });

      const wheres = prisma.appointment.count.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      );
      expect(wheres).toContainEqual(
        expect.objectContaining({
          OR: [{ status: 'CANCELLED' }, { attendanceStatus: 'NO_SHOW' }],
        }),
      );
    });
  });

  describe('logueos por rol', () => {
    it.each(['ORG_ADMIN', 'DOCTOR', 'BOOKING_AGENT'])(
      'el rol %s se filtra dentro del JSON de metadata, sin traer el blob',
      async (rol) => {
        await service.getGlobalStats({ range: 'MONTH' });

        const wheres = prisma.systemLog.count.mock.calls.map(
          (c: [{ where: Record<string, unknown> }]) => c[0].where,
        );
        expect(wheres).toContainEqual(
          expect.objectContaining({
            action: 'USER_LOGIN',
            metadata: { path: ['role'], equals: rol },
          }),
        );
      },
    );
  });

  describe('addendums (no tienen organizationId propio)', () => {
    it('se filtran a través de su historia clínica', async () => {
      await service.getGlobalStats({ organizationId: ORG });

      expect(prisma.addendum.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          clinicalRecord: { organizationId: ORG },
        }),
      });
    });

    it('en la vista global no se filtran por clínica', async () => {
      await service.getGlobalStats({});
      expect(
        prisma.addendum.count.mock.calls[0][0].where.clinicalRecord,
      ).toBeUndefined();
    });
  });

  describe('clínicas activas', () => {
    it('en la vista global se cuentan las ÚNICAS con citas o historias', async () => {
      // 'a' y 'b' por citas, 'b' por historias → dos únicas.
      const r = await service.getGlobalStats({});
      expect(r.metrics.activeOrganizations).toBe(2);
    });

    it('filtrando por una clínica, es 1 si tuvo actividad', async () => {
      const r = await service.getGlobalStats({ organizationId: ORG });
      expect(r.metrics.activeOrganizations).toBe(1);
      expect(prisma.appointment.groupBy).not.toHaveBeenCalled();
    });

    it('y 0 si no tuvo ninguna', async () => {
      prisma.appointment.count.mockResolvedValue(0);
      prisma.clinicalRecord.count.mockResolvedValue(0);

      const r = await service.getGlobalStats({ organizationId: ORG });
      expect(r.metrics.activeOrganizations).toBe(0);
    });
  });

  describe('tendencias', () => {
    it('los bigint de Postgres se convierten a número y la fecha a yyyy-mm-dd', async () => {
      const r = await service.getGlobalStats({ range: 'MONTH' });

      expect(r.trends.appointmentsScheduled).toEqual([
        { date: '2026-05-10', count: 7 },
      ]);
      expect(typeof r.trends.newPatients[0].count).toBe('number');
    });

    it('son cuatro series, agregadas en SQL (no en memoria)', async () => {
      const r = await service.getGlobalStats({ range: 'MONTH' });

      expect(Object.keys(r.trends)).toEqual([
        'appointmentsScheduled',
        'newPatients',
        'aiMessagesProcessed',
        'signedClinicalRecords',
      ]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    });

    it('sin datos, cada serie es un arreglo vacío, no null', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const r = await service.getGlobalStats({});
      expect(r.trends.newPatients).toEqual([]);
    });
  });

  it('🔒 no se trae ni un solo registro crudo: solo agregados', async () => {
    await service.getGlobalStats({ range: 'MONTH' });

    expect(prisma.appointment.findMany).toBeUndefined();
    expect(prisma.patientProfile.findMany).toBeUndefined();
    expect(prisma.clinicalRecord.findMany).toBeUndefined();
  });

  it('devuelve los once contadores del tablero', async () => {
    const r = await service.getGlobalStats({ range: 'MONTH' });
    expect(Object.keys(r.metrics)).toHaveLength(11);
  });

  it('la lista de clínicas del filtro sale ordenada por nombre', async () => {
    await service.listOrganizationsForFilter();
    expect(prisma.organization.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('AnalyticsService — el tablero de una clínica', () => {
  let service: AnalyticsService;
  let prisma: any;

  const ORG = 'org-1';

  const cita = (
    servicio: string | null,
    eps: string | null,
    fecha?: string,
  ) => ({
    scheduleSlot: {
      service: servicio ? { name: servicio } : null,
      startTime: fecha ? new Date(fecha) : undefined,
    },
    eps: eps ? { name: eps } : null,
  });

  beforeEach(async () => {
    prisma = {
      appointment: {
        count: jest.fn(async () => 10),
        findMany: jest.fn(async () => []),
        groupBy: jest.fn(async () => [
          { origin: 'WHATSAPP', _count: { _all: 8 } },
          { origin: 'MIRROR', _count: { _all: 2 } },
        ]),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  it('🏢 todas las consultas van acotadas a la clínica', async () => {
    await service.getDashboardStats(ORG);

    for (const m of [
      ...prisma.appointment.count.mock.calls,
      ...prisma.appointment.findMany.mock.calls,
      ...prisma.appointment.groupBy.mock.calls,
    ]) {
      expect(m[0].where.organizationId).toBe(ORG);
    }
  });

  it('sin fechas no se filtra por rango', async () => {
    await service.getDashboardStats(ORG);
    expect(
      prisma.appointment.count.mock.calls[0][0].where.scheduleSlot,
    ).toBeUndefined();
  });

  it.each([
    ['solo inicio', '2026-05-01', undefined],
    ['solo fin', undefined, '2026-05-31'],
    ['ambos', '2026-05-01', '2026-05-31'],
  ])('con %s se filtra por la hora del cupo', async (_e, desde, hasta) => {
    await service.getDashboardStats(ORG, desde, hasta);

    const filtro =
      prisma.appointment.count.mock.calls[0][0].where.scheduleSlot.startTime;
    if (desde) expect(filtro.gte.toISOString()).toBe(`${desde}T00:00:00.000Z`);
    if (hasta) expect(filtro.lte.toISOString()).toBe(`${hasta}T23:59:59.999Z`);
  });

  it('los KPI cuentan total, completadas y canceladas por separado', async () => {
    const r = await service.getDashboardStats(ORG);

    expect(r.kpis).toEqual({ total: 10, completed: 10, cancelled: 10 });
    const estados = prisma.appointment.count.mock.calls.map(
      (c: [{ where: { status?: string } }]) => c[0].where.status,
    );
    expect(estados).toEqual([undefined, 'COMPLETED', 'CANCELLED']);
  });

  it('agrupa por especialidad contando cada cita', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      cita('Medicina General', 'Sura'),
      cita('Medicina General', 'Sura'),
      cita('Odontología', null),
    ]);

    const r = await service.getDashboardStats(ORG);

    expect(r.charts.specialtyDistribution).toEqual(
      expect.arrayContaining([
        { name: 'Medicina General', count: 2 },
        { name: 'Odontología', count: 1 },
      ]),
    );
  });

  it('una cita sin servicio no se pierde: cae en «Unknown»', async () => {
    prisma.appointment.findMany.mockResolvedValue([cita(null, null)]);

    const r = await service.getDashboardStats(ORG);
    expect(r.charts.specialtyDistribution).toContainEqual({
      name: 'Unknown',
      count: 1,
    });
  });

  it('una cita sin EPS se cuenta como particular, no se descarta', async () => {
    prisma.appointment.findMany.mockResolvedValue([cita('X', null)]);

    const r = await service.getDashboardStats(ORG);
    expect(r.charts.epsDistribution).toContainEqual({
      name: 'Particular / Sin EPS',
      count: 1,
    });
  });

  it('el origen distingue WhatsApp del espejo con el HIS', async () => {
    const r = await service.getDashboardStats(ORG);

    expect(r.charts.originDistribution).toEqual([
      { name: 'WHATSAPP', count: 8 },
      { name: 'MIRROR', count: 2 },
    ]);
  });

  it('el volumen temporal agrupa por día', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      cita('X', null, '2026-05-10T14:00:00Z'),
      cita('X', null, '2026-05-10T16:00:00Z'),
      cita('X', null, '2026-05-11T09:00:00Z'),
    ]);

    const r = await service.getDashboardStats(ORG);

    expect(r.charts.temporalVolume).toEqual([
      { date: '2026-05-10', count: 2 },
      { date: '2026-05-11', count: 1 },
    ]);
  });

  it('una cita sin hora de cupo no rompe el volumen temporal', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      { scheduleSlot: null, eps: null },
    ]);

    await expect(service.getDashboardStats(ORG)).resolves.toBeDefined();
  });

  it('sin citas devuelve la estructura completa con listas vacías', async () => {
    prisma.appointment.count.mockResolvedValue(0);
    prisma.appointment.groupBy.mockResolvedValue([]);

    const r = await service.getDashboardStats(ORG);

    expect(r.kpis).toEqual({ total: 0, completed: 0, cancelled: 0 });
    expect(r.charts.specialtyDistribution).toEqual([]);
    expect(r.charts.temporalVolume).toEqual([]);
  });
});
