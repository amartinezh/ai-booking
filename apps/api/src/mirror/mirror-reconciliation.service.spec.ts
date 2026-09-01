import { Test, TestingModule } from '@nestjs/testing';
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';

// ══════════════════════════════════════════════════════════════════════════
// Capa 5 de las seis defensas del plan (§6) y la ÚNICA que detecta deriva
// silenciosa: el caso en que todo pareció ir bien y aun así los dos sistemas
// no coinciden. Las otras cinco protegen cada evento por separado.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorReconciliationService', () => {
  let service: MirrorReconciliationService;
  let prisma: any;
  let errores: string[];
  let avisos: string[];

  const VENTANA = {
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-12-01T00:00:00.000Z'),
  };

  const citaAgenIA = (doctorId: string, startIso: string) => ({
    id: `apt-${startIso}`,
    scheduleSlot: { startTime: new Date(startIso), doctorId },
  });

  beforeEach(async () => {
    prisma = {
      appointment: { findMany: jest.fn(async () => []) },
      mirrorEntityMap: {
        findMany: jest.fn(async () => [
          { agenIAId: 'doc-1', externalKey: '76' },
          { agenIAId: 'doc-2', externalKey: '91-1' },
        ]),
      },
      syncAudit: { create: jest.fn(async () => ({})) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorReconciliationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(MirrorReconciliationService);

    errores = [];
    avisos = [];
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation((m: string) => errores.push(m));
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation((m: string) => avisos.push(m));
  });

  it('dos sistemas idénticos → inSync', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
    ]);

    const r = await service.reconcile(
      'org1',
      [{ doctorExternalKey: '76', startTimeIso: '2026-09-03T12:00:00.000Z' }],
      VENTANA,
    );

    expect(r.inSync).toBe(true);
    expect(r.missingInHis).toEqual([]);
    expect(r.missingInAgenIA).toEqual([]);
  });

  it('una cita de AgenIA que el hospital NO tiene: el paciente cree que sí', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
    ]);

    const r = await service.reconcile('org1', [], VENTANA);

    expect(r.inSync).toBe(false);
    expect(r.missingInHis).toEqual(['76|2026-09-03T12:00:00.000Z']);
  });

  it('una cita del HIS que AgenIA desconoce: podría revender ese cupo', async () => {
    const r = await service.reconcile(
      'org1',
      [{ doctorExternalKey: '91-1', startTimeIso: '2026-09-03T13:00:00.000Z' }],
      VENTANA,
    );

    expect(r.missingInAgenIA).toEqual(['91-1|2026-09-03T13:00:00.000Z']);
  });

  it('detecta deriva en las DOS direcciones a la vez', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
    ]);

    const r = await service.reconcile(
      'org1',
      [{ doctorExternalKey: '91-1', startTimeIso: '2026-09-03T13:00:00.000Z' }],
      VENTANA,
    );

    expect(r.missingInHis).toHaveLength(1);
    expect(r.missingInAgenIA).toHaveLength(1);
    expect(r.inAgenIA).toBe(1);
    expect(r.inHis).toBe(1);
  });

  it('un médico sin homologar no cuenta como diferencia', async () => {
    // Su cita nunca llegó al HIS y el dispatcher ya lo reporta: contarla aquí
    // sería ruido que tapa las diferencias de verdad.
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-sin-mapear', '2026-09-03T12:00:00.000Z'),
    ]);

    const r = await service.reconcile('org1', [], VENTANA);

    expect(r.inSync).toBe(true);
    expect(r.inAgenIA).toBe(0);
  });

  it('compara solo citas VIGENTES dentro de la ventana', async () => {
    await service.reconcile('org1', [], VENTANA);

    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('SCHEDULED');
    expect(where.scheduleSlot.startTime).toEqual({
      gte: VENTANA.from,
      lt: VENTANA.to,
    });
    expect(where.organizationId).toBe('org1');
  });

  it('el mensaje de deriva dice qué duele en cada dirección', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
    ]);

    await service.reconcile('org1', [], VENTANA);

    expect(errores[0]).toContain('el paciente cree que sí');
    expect(errores[0]).toContain('podría revender ese cupo');
  });

  it('registra en SyncAudit TAMBIÉN cuando coincide', async () => {
    // Sin el registro del día bueno no hay forma de distinguir "reconcilió sin
    // diferencias" de "la reconciliación no corrió".
    await service.reconcile('org1', [], VENTANA);

    expect(prisma.syncAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'RECONCILE',
          outcome: 'OK',
        }),
      }),
    );
  });

  it('marca CONFLICT en la auditoría cuando hay deriva', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
    ]);

    await service.reconcile('org1', [], VENTANA);

    expect(prisma.syncAudit.create.mock.calls[0][0].data.outcome).toBe(
      'CONFLICT',
    );
  });

  it('normaliza las horas antes de comparar', async () => {
    // El agente puede mandar la hora con otro formato ISO equivalente; una
    // diferencia de formato no es una diferencia de datos.
    prisma.appointment.findMany.mockResolvedValue([
      citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
    ]);

    const r = await service.reconcile(
      'org1',
      [{ doctorExternalKey: '76', startTimeIso: '2026-09-03T07:00:00-05:00' }],
      VENTANA,
    );

    expect(r.inSync).toBe(true);
  });
});
