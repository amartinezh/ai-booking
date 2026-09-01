import { Test, TestingModule } from '@nestjs/testing';
import { MirrorAvailabilityService } from './mirror-availability.service';
import { PrismaService } from '../prisma/prisma.service';

// ══════════════════════════════════════════════════════════════════════════
// Fase 2: la agenda de AgenIA pasa a ser la del hospital.
//
// Hasta aquí los cupos se creaban a mano y no tenían por qué parecerse a la
// agenda real: se podía vender por WhatsApp una hora en la que el médico no
// atiende, y una jornada cancelada por el hospital seguía ofreciéndose. El
// espejo de CITAS funcionaba; el de AGENDA no existía.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorAvailabilityService', () => {
  let service: MirrorAvailabilityService;
  let prisma: any;
  let tx: any;

  const VENTANA = {
    fromIso: '2026-09-03T00:00:00.000Z',
    toIso: '2026-09-04T00:00:00.000Z',
  };

  const cupoHis = (startTimeIso: string, occupied = false) => ({
    doctorExternalKey: '91-1',
    startTimeIso,
    endTimeIso: new Date(new Date(startTimeIso).getTime() + 1_200_000).toISOString(),
    occupied,
  });

  const cupoAgenIA = (
    startIso: string,
    opts: { isAvailable?: boolean; conCita?: boolean; id?: string } = {},
  ) => ({
    id: opts.id ?? `slot-${startIso}`,
    doctorId: 'doc-1',
    startTime: new Date(startIso),
    isAvailable: opts.isAvailable ?? true,
    appointments: opts.conCita ? [{ id: 'apt-1' }] : [],
  });

  const conModo = (mode: 'OFF' | 'SHADOW' | 'ON') =>
    prisma.hospitalMirrorConfig.findUniqueOrThrow.mockResolvedValue({
      availabilityMode: mode,
    });

  beforeEach(async () => {
    tx = {
      $executeRawUnsafe: jest.fn(),
      scheduleSlot: {
        createMany: jest.fn(async () => ({ count: 0 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    prisma = {
      hospitalMirrorConfig: { findUniqueOrThrow: jest.fn() },
      mirrorEntityMap: {
        findMany: jest.fn(async () => [
          { agenIAId: 'doc-1', externalKey: '91-1' },
        ]),
      },
      doctorProfile: {
        findMany: jest.fn(async () => [{ id: 'doc-1', serviceId: 'srv-1' }]),
      },
      scheduleSlot: { findMany: jest.fn(async () => []) },
      syncAudit: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    conModo('ON');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorAvailabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(MirrorAvailabilityService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  const aplicar = (slots: any[]) =>
    service.apply('org1', { ...VENTANA, slots });

  describe('OFF — el hospital todavía no cedió su agenda', () => {
    it('no toca nada', async () => {
      conModo('OFF');

      const r = await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(r.mode).toBe('OFF');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.scheduleSlot.findMany).not.toHaveBeenCalled();
    });
  });

  describe('ON — la agenda de AgenIA es la del hospital', () => {
    it('crea los cupos que faltan, con el servicio del médico', async () => {
      await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(tx.scheduleSlot.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              organizationId: 'org1',
              doctorId: 'doc-1',
              serviceId: 'srv-1',
              isAvailable: true,
            }),
          ],
        }),
      );
    });

    it('un cupo que el HIS tiene vendido nace ocupado', async () => {
      await aplicar([cupoHis('2026-09-03T12:00:00.000Z', true)]);

      const creado = tx.scheduleSlot.createMany.mock.calls[0][0].data[0];
      expect(creado.isAvailable).toBe(false);
    });

    it('ocupa en AgenIA lo que el hospital acaba de vender', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', { isAvailable: true, id: 's1' }),
      ]);

      await aplicar([cupoHis('2026-09-03T12:00:00.000Z', true)]);

      expect(tx.scheduleSlot.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] } },
        data: { isAvailable: false },
      });
    });

    it('libera lo que el hospital canceló por su lado', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', { isAvailable: false, id: 's1' }),
      ]);

      await aplicar([cupoHis('2026-09-03T12:00:00.000Z', false)]);

      expect(tx.scheduleSlot.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] } },
        data: { isAvailable: true },
      });
    });

    it('🚨 NUNCA libera un cupo con cita viva en AgenIA', async () => {
      // El HIS podría no conocer todavía esa cita (viaja por el outbox).
      // Liberarla sería revender una hora ya vendida.
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', {
          isAvailable: false,
          conCita: true,
          id: 's1',
        }),
      ]);

      await aplicar([cupoHis('2026-09-03T12:00:00.000Z', false)]);

      const liberaciones = tx.scheduleSlot.updateMany.mock.calls.filter(
        (c: any[]) => c[0].data.isAvailable === true,
      );
      expect(liberaciones).toHaveLength(0);
    });

    it('borra los cupos que el hospital ya no tiene', async () => {
      // Una jornada que el hospital canceló: si no se borran, AgenIA sigue
      // vendiendo horas en las que el médico no atiende.
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', { id: 'sobrante' }),
      ]);

      const r = await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(tx.scheduleSlot.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['sobrante'] } },
      });
      expect(r.removed).toBe(1);
    });

    it('🚨 un cupo que desaparece PERO tiene cita no se borra: se reporta', async () => {
      // Es un paciente con cita a una hora en la que su médico ya no atiende.
      // Eso no es un cupo sobrante, es un problema para una persona.
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', { conCita: true, id: 'con-cita' }),
      ]);

      const r = await aplicar([]);

      expect(tx.scheduleSlot.deleteMany).not.toHaveBeenCalled();
      expect(r.conflicts).toEqual(['doc-1|2026-09-03T15:00:00.000Z']);
    });

    it('marca el cambio como MIRROR para que no rebote al hospital', async () => {
      await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("agenia.sync_origin = 'MIRROR'"),
      );
    });

    it('🛡️ un cupo de FUERA de la ventana declarada se ignora', async () => {
      // El servidor borra, dentro de la ventana, todo lo que no venga en el
      // envío: aceptar uno de fuera crearía un cupo que la vuelta siguiente
      // borraría. Pasó de verdad — el driver filtraba turnos por instante UTC
      // contra una columna de fecha local y se desplazaba un día entero.
      const r = await aplicar([cupoHis('2026-09-05T12:00:00.000Z')]);

      expect(r.skipped).toEqual(['91-1|2026-09-05T12:00:00.000Z']);
      expect(tx.scheduleSlot.createMany).not.toHaveBeenCalled();
    });

    it('el borde de la ventana se respeta: el instante final ya es de mañana', async () => {
      const r = await aplicar([
        cupoHis(VENTANA.fromIso), // dentro
        cupoHis(VENTANA.toIso), // fuera: `to` es exclusivo
      ]);

      expect(r.skipped).toEqual([`91-1|${VENTANA.toIso}`]);
      expect(r.created).toBe(1);
    });

    it('un médico sin homologar se salta, no se inventa', async () => {
      const r = await aplicar([
        { ...cupoHis('2026-09-03T12:00:00.000Z'), doctorExternalKey: '99' },
      ]);

      expect(r.skipped).toEqual(['99|2026-09-03T12:00:00.000Z']);
      expect(tx.scheduleSlot.createMany).not.toHaveBeenCalled();
    });

    it('un médico homologado pero sin servicio también se salta', async () => {
      // `ScheduleSlot.serviceId` es obligatorio y `TURNOS_MEDICOS` no lleva
      // servicio: sale del médico. Sin él no hay cupo que crear.
      prisma.doctorProfile.findMany.mockResolvedValue([
        { id: 'doc-1', serviceId: null },
      ]);

      const r = await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(r.skipped).toHaveLength(1);
      expect(tx.scheduleSlot.createMany).not.toHaveBeenCalled();
    });

    it('deja rastro en SyncAudit de cada pasada', async () => {
      await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'SLOT',
            op: 'AVAILABILITY',
            outcome: 'OK',
          }),
        }),
      );
    });
  });

  describe('SHADOW — la semana de observación que exige el plan', () => {
    beforeEach(() => conModo('SHADOW'));

    it('calcula todo y no escribe nada', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', { id: 'sobrante' }),
      ]);

      const r = await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(r.created).toBe(1);
      expect(r.removed).toBe(1);
    });

    it('igual deja rastro: sin él no se sabe si corrió', async () => {
      await aplicar([cupoHis('2026-09-03T12:00:00.000Z')]);

      expect(prisma.syncAudit.create).toHaveBeenCalled();
    });
  });
});
