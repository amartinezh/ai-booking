import { CuposLibresListaService } from './cupos-libres-lista.service';

/**
 * 🔔 La lista de espera recibe primero los cupos libres (2026-10-31): el 31-oct
 * había 20 personas esperando y 10 personas nuevas tomaron por el chat los cupos
 * del martes sin que a ninguna de la lista se le ofreciera uno.
 */
describe('CuposLibresListaService', () => {
  const ORG = 'org-1';
  // Martes 3-nov-2026, 10:00 en Bogotá (15:00 UTC): de día.
  const DE_DIA = new Date('2026-11-03T15:00:00Z');

  let prisma: {
    waitlistEntry: {
      groupBy: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    organization: { findUnique: jest.Mock };
    medicalService: { findFirst: jest.Mock };
    scheduleSlot: { findMany: jest.Mock };
  };
  let appointments: { getAvailableSlots: jest.Mock };
  let waitlist: {
    notifyWaitlist: jest.Mock;
    cerrarLosQueYaTienenCita: jest.Mock;
  };
  let service: CuposLibresListaService;

  const cupo = (
    id: string,
    iso: string,
    allowedEpsId: string | null = null,
  ) => ({
    id,
    serviceId: 'svc-1',
    allowedEpsId,
    startTime: new Date(iso),
    doctor: { fullName: `Médico de ${id}` },
  });

  beforeEach(() => {
    prisma = {
      waitlistEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ organizationId: ORG, serviceId: 'svc-1' }]),
        findMany: jest
          .fn()
          .mockResolvedValue([{ epsId: 'sura' }, { epsId: 'salud-total' }]),
        // Siempre queda alguien esperando.
        count: jest.fn().mockResolvedValue(5),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: 'America/Bogota',
          settings: { bookingEnabled: true },
        }),
      },
      medicalService: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'Consulta ambulatoria de medicina general',
          isActive: true,
        }),
      },
      scheduleSlot: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            cupo('slot-a', '2026-11-03T20:00:00Z'),
            cupo('slot-b', '2026-11-03T20:20:00Z'),
          ]),
      },
    };
    appointments = {
      getAvailableSlots: jest
        .fn()
        .mockResolvedValueOnce([{ slotId: 'slot-a' }, { slotId: 'slot-b' }])
        .mockResolvedValueOnce([{ slotId: 'slot-b' }]),
    };
    waitlist = {
      notifyWaitlist: jest.fn().mockResolvedValue(true),
      cerrarLosQueYaTienenCita: jest.fn().mockResolvedValue(0),
    };
    service = new CuposLibresListaService(
      prisma as never,
      appointments as never,
      waitlist as never,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('ofrece a la lista, en orden, cada cupo libre que el chat ofrecería', async () => {
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(2);

    // Los cupos del chat para cada EPS de la lista, todos (no solo los del menú).
    expect(appointments.getAvailableSlots).toHaveBeenCalledWith(
      'Consulta ambulatoria de medicina general',
      'sura',
      ORG,
      null,
      { todos: true },
    );
    expect(appointments.getAvailableSlots).toHaveBeenCalledWith(
      'Consulta ambulatoria de medicina general',
      'salud-total',
      ORG,
      null,
      { todos: true },
    );
    expect(prisma.scheduleSlot.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['slot-a', 'slot-b'] },
        organizationId: ORG,
        serviceId: 'svc-1',
        isAvailable: true,
      },
      include: { doctor: true },
      orderBy: { startTime: 'asc' },
    });
    expect(waitlist.notifyWaitlist.mock.calls.map((c) => c[0])).toEqual([
      {
        slotId: 'slot-a',
        serviceId: 'svc-1',
        epsId: null,
        organizationId: ORG,
        doctorName: 'Médico de slot-a',
        slotDate: new Date('2026-11-03T20:00:00Z'),
      },
      expect.objectContaining({ slotId: 'slot-b' }),
    ]);
  });

  it('antes saca de la lista a quien ya consiguió cita', async () => {
    await service.ofrecerCuposLibres(DE_DIA);
    expect(waitlist.cerrarLosQueYaTienenCita).toHaveBeenCalledWith(
      ORG,
      'svc-1',
    );
    expect(
      waitlist.cerrarLosQueYaTienenCita.mock.invocationCallOrder[0],
    ).toBeLessThan(waitlist.notifyWaitlist.mock.invocationCallOrder[0]);
  });

  it('cuando ya no queda nadie esperando, para', async () => {
    prisma.waitlistEntry.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(1);
    expect(waitlist.notifyWaitlist).toHaveBeenCalledTimes(1);
  });

  it('tras 3 cupos seguidos que no se pudieron ofrecer, deja el servicio para el siguiente barrido', async () => {
    prisma.scheduleSlot.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map((x, i) =>
        cupo(`slot-${x}`, `2026-11-03T2${i}:00:00Z`),
      ),
    );
    appointments.getAvailableSlots
      .mockReset()
      .mockResolvedValue([{ slotId: 'slot-a' }]);
    waitlist.notifyWaitlist.mockResolvedValue(false);
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(0);
    expect(waitlist.notifyWaitlist).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['de madrugada (5:00 en Bogotá)', '2026-11-03T10:00:00Z'],
    ['de noche (19:30 en Bogotá)', '2026-11-04T00:30:00Z'],
  ])('%s no ofrece nada', async (_d, iso) => {
    await expect(service.ofrecerCuposLibres(new Date(iso))).resolves.toBe(0);
    expect(appointments.getAvailableSlots).not.toHaveBeenCalled();
    expect(waitlist.notifyWaitlist).not.toHaveBeenCalled();
  });

  it('con «Agendar citas» apagado no ofrece nada', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      timezone: null,
      settings: { bookingEnabled: false },
    });
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(0);
    expect(waitlist.notifyWaitlist).not.toHaveBeenCalled();
  });

  it('un servicio inactivo no ofrece nada', async () => {
    prisma.medicalService.findFirst.mockResolvedValue({
      name: 'X',
      isActive: false,
    });
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(0);
    expect(waitlist.notifyWaitlist).not.toHaveBeenCalled();
  });

  it('sin cupos libres no ofrece nada', async () => {
    appointments.getAvailableSlots.mockReset().mockResolvedValue([]);
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(0);
    expect(prisma.scheduleSlot.findMany).not.toHaveBeenCalled();
  });

  it('nunca lanza: un servicio que falla no frena a los demás', async () => {
    prisma.waitlistEntry.groupBy.mockResolvedValue([
      { organizationId: ORG, serviceId: 'svc-roto' },
      { organizationId: ORG, serviceId: 'svc-1' },
    ]);
    prisma.medicalService.findFirst
      .mockRejectedValueOnce(new Error('caída'))
      .mockResolvedValue({ name: 'Medicina general', isActive: true });
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(2);

    prisma.waitlistEntry.groupBy.mockRejectedValue(new Error('sin base'));
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(0);
  });

  it('un barrido a la vez', async () => {
    let soltar!: () => void;
    prisma.waitlistEntry.groupBy.mockReturnValueOnce(
      new Promise((r) => {
        soltar = () => r([]);
      }),
    );
    const primero = service.ofrecerCuposLibres(DE_DIA);
    await expect(service.ofrecerCuposLibres(DE_DIA)).resolves.toBe(0);
    soltar();
    await primero;
    expect(prisma.waitlistEntry.groupBy).toHaveBeenCalledTimes(1);
  });
});
