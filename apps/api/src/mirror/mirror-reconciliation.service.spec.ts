import { Test, TestingModule } from '@nestjs/testing';
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { MirrorWatchdogService } from './mirror-watchdog.service';

// ══════════════════════════════════════════════════════════════════════════
// Capa 5 de las seis defensas del plan (§6) y la ÚNICA que detecta deriva
// silenciosa: el caso en que todo pareció ir bien y aun así los dos sistemas
// no coinciden. Las otras cinco protegen cada evento por separado.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorReconciliationService', () => {
  let service: MirrorReconciliationService;
  let prisma: any;
  let watchdog: { registrarDeriva: jest.Mock };
  let errores: string[];
  let avisos: string[];

  const VENTANA = {
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-12-01T00:00:00.000Z'),
  };

  const citaAgenIA = (doctorId: string, startIso: string) => ({
    id: `apt-${startIso}`,
    patientId: 'pac-1',
    epsId: 'eps-1',
    scheduleSlot: { startTime: new Date(startIso), doctorId },
  });

  const cupo = (doctorId: string, startIso: string, isAvailable: boolean) => ({
    id: `slot-${doctorId}-${startIso}`,
    doctorId,
    startTime: new Date(startIso),
    isAvailable,
  });

  beforeEach(async () => {
    prisma = {
      appointment: { findMany: jest.fn(() => []) },
      mirrorEntityMap: {
        findMany: jest.fn(() => [
          { agenIAId: 'doc-1', externalKey: '76' },
          { agenIAId: 'doc-2', externalKey: '91-1' },
        ]),
      },
      // Ocupación de cupos: la comparación HIS→AgenIA se mide aquí, no en
      // `Appointment` (ver el comentario del servicio).
      scheduleSlot: {
        findMany: jest.fn(() => []),
        update: jest.fn(() => ({})),
      },
      $transaction: jest.fn((fn: any) =>
        fn({ $executeRawUnsafe: jest.fn(), scheduleSlot: prisma.scheduleSlot }),
      ),
      syncAudit: { create: jest.fn(() => ({})) },
    };
    watchdog = { registrarDeriva: jest.fn(async () => undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MirrorWatchdogService, useValue: watchdog },
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

  it('una cita del HIS sobre un cupo que AgenIA sigue ofreciendo: lo revendería', async () => {
    prisma.scheduleSlot.findMany.mockResolvedValue([
      cupo('doc-2', '2026-09-03T13:00:00.000Z', true),
    ]);

    const r = await service.reconcile(
      'org1',
      [{ doctorExternalKey: '91-1', startTimeIso: '2026-09-03T13:00:00.000Z' }],
      VENTANA,
    );

    expect(r.missingInAgenIA).toEqual(['91-1|2026-09-03T13:00:00.000Z']);
  });

  // ════════════════════════════════════════════════════════════════════════
  // La deriva HACIA el hospital pasa a la bandeja de excepciones (Fase 3 del
  // rastreo): la reconciliación no la repara sola, así que se la da a una persona.
  // ════════════════════════════════════════════════════════════════════════
  describe('la deriva pasa a la bandeja de excepciones', () => {
    it('cada cita que el hospital no tiene se entrega CON su cita, su paciente y su alcance', async () => {
      prisma.appointment.findMany.mockResolvedValue([
        citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
        citaAgenIA('doc-1', '2026-09-04T12:00:00.000Z'),
      ]);

      await service.reconcile(
        'org1',
        [{ doctorExternalKey: '76', startTimeIso: '2026-09-04T12:00:00.000Z' }],
        VENTANA,
      );

      expect(watchdog.registrarDeriva).toHaveBeenCalledTimes(1);
      const [org, ventana, items, inHis] =
        watchdog.registrarDeriva.mock.calls[0];
      expect(org).toBe('org1');
      expect(ventana).toBe(VENTANA);
      // Solo la que falta, no la que sí está.
      expect(items).toEqual([
        {
          appointmentId: 'apt-2026-09-03T12:00:00.000Z',
          patientId: 'pac-1',
          epsId: 'eps-1',
          doctorId: 'doc-1',
          startTime: new Date('2026-09-03T12:00:00.000Z'),
          clave: '76|2026-09-03T12:00:00.000Z',
        },
      ]);
      expect(inHis).toBe(1);
    });

    it('la lectura de las citas trae el paciente y la EPS (con eso se arma el alcance)', async () => {
      await service.reconcile('org1', [], VENTANA);

      const select = prisma.appointment.findMany.mock.calls[0][0].select;
      expect(select.patientId).toBe(true);
      expect(select.epsId).toBe(true);
    });

    it('cuando todo coincide igual se avisa (con cero citas): así se cierran solas las que ya llegaron', async () => {
      prisma.appointment.findMany.mockResolvedValue([
        citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
      ]);

      await service.reconcile(
        'org1',
        [{ doctorExternalKey: '76', startTimeIso: '2026-09-03T12:00:00.000Z' }],
        VENTANA,
      );

      expect(watchdog.registrarDeriva.mock.calls[0][2]).toEqual([]);
    });

    it('una cita de un médico SIN homologar no se entrega: no se puede comparar', async () => {
      prisma.mirrorEntityMap.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([
        citaAgenIA('doc-9', '2026-09-03T12:00:00.000Z'),
      ]);

      await service.reconcile('org1', [], VENTANA);

      expect(watchdog.registrarDeriva.mock.calls[0][2]).toEqual([]);
    });

    it('🛡️ si la bandeja falla, la reconciliación NO: el informe ya quedó en la auditoría', async () => {
      watchdog.registrarDeriva.mockRejectedValueOnce(new Error('db caída'));
      prisma.appointment.findMany.mockResolvedValue([
        citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
      ]);

      const r = await service.reconcile('org1', [], VENTANA);

      expect(r.missingInHis).toEqual(['76|2026-09-03T12:00:00.000Z']);
      expect(prisma.syncAudit.create).toHaveBeenCalledTimes(1);
      expect(errores.join(' ')).toMatch(
        /No se pudo pasar la deriva a la bandeja.*db caída/,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Una cita agendada en la ventanilla del hospital NO crea un `Appointment`
  // en AgenIA (el alta en caliente del paciente es Fase 2+): lo que AgenIA
  // hace, y es lo que importa, es dejar de ofrecer ese cupo. Compararlo contra
  // `Appointment` marcaba como deriva TODAS las citas de ventanilla — cinco en
  // la prueba contra la VM, cientos en producción. Una alerta siempre en rojo
  // se deja de mirar, y con ella se pierde la deriva de verdad.
  // ════════════════════════════════════════════════════════════════════════
  it('una cita de ventanilla con su cupo ya ocupado NO es deriva', async () => {
    prisma.scheduleSlot.findMany.mockResolvedValue([
      cupo('doc-2', '2026-09-03T13:00:00.000Z', false),
    ]);

    const r = await service.reconcile(
      'org1',
      [{ doctorExternalKey: '91-1', startTimeIso: '2026-09-03T13:00:00.000Z' }],
      VENTANA,
    );

    expect(r.missingInAgenIA).toEqual([]);
    expect(r.inSync).toBe(true);
  });

  it('una cita del HIS sin cupo equivalente en AgenIA sí es deriva', async () => {
    // El médico está homologado pero ese horario no existe como cupo: AgenIA
    // no puede reflejar la ocupación y el hospital tiene una cita huérfana.
    prisma.scheduleSlot.findMany.mockResolvedValue([]);

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
    prisma.scheduleSlot.findMany.mockResolvedValue([
      cupo('doc-2', '2026-09-03T13:00:00.000Z', true),
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

  // ════════════════════════════════════════════════════════════════════════
  // Detectar no basta: cada diferencia de esta dirección es una hora que el
  // hospital YA vendió y que AgenIA sigue ofreciendo por WhatsApp. Dejarla
  // marcada en un informe es esperar a que dos pacientes se presenten a la
  // misma cita.
  // ════════════════════════════════════════════════════════════════════════
  describe('reparación automática', () => {
    beforeEach(() => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupo('doc-2', '2026-09-03T13:00:00.000Z', true),
      ]);
    });

    const conCitaSoloEnHis = () =>
      service.reconcile(
        'org1',
        [
          {
            doctorExternalKey: '91-1',
            startTimeIso: '2026-09-03T13:00:00.000Z',
          },
        ],
        VENTANA,
      );

    it('cierra el cupo que el hospital ya vendió', async () => {
      await conCitaSoloEnHis();

      expect(prisma.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-doc-2-2026-09-03T13:00:00.000Z' },
        data: { isAvailable: false },
      });
    });

    it('lo reporta como reparado, no solo como diferencia', async () => {
      const r = await conCitaSoloEnHis();

      expect(r.repaired).toEqual(['91-1|2026-09-03T13:00:00.000Z']);
    });

    it('marca el cambio como MIRROR para que no rebote al hospital', async () => {
      const tx = {
        $executeRawUnsafe: jest.fn(),
        scheduleSlot: prisma.scheduleSlot,
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await conCitaSoloEnHis();

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("agenia.sync_origin = 'MIRROR'"),
      );
    });

    it('NO toca la dirección contraria: eso lo decide una persona', async () => {
      // Una cita que AgenIA tiene y el hospital no significaría escribir o
      // borrar en la base del hospital a partir de una comparación.
      prisma.appointment.findMany.mockResolvedValue([
        citaAgenIA('doc-1', '2026-09-03T12:00:00.000Z'),
      ]);
      prisma.scheduleSlot.findMany.mockResolvedValue([]);

      const r = await service.reconcile('org1', [], VENTANA);

      expect(r.missingInHis).toHaveLength(1);
      expect(r.repaired).toEqual([]);
      expect(prisma.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('un cupo que no existe no se puede reparar: solo se reporta', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([]);

      const r = await conCitaSoloEnHis();

      expect(r.missingInAgenIA).toHaveLength(1);
      expect(r.repaired).toEqual([]);
    });
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
