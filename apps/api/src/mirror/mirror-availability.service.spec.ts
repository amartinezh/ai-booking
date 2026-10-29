import { Test, TestingModule } from '@nestjs/testing';
import { MirrorAvailabilityService } from './mirror-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';

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
    endTimeIso: new Date(
      new Date(startTimeIso).getTime() + 1_200_000,
    ).toISOString(),
    occupied,
  });

  const cupoAgenIA = (
    startIso: string,
    opts: {
      isAvailable?: boolean;
      conCita?: boolean;
      conCitaCancelada?: boolean;
      id?: string;
      /** De dónde vino la cita (por defecto una de WhatsApp, agendada en AgenIA). */
      origen?: string;
      minutos?: number;
    } = {},
  ) => ({
    id: opts.id ?? `slot-${startIso}`,
    doctorId: 'doc-1',
    startTime: new Date(startIso),
    endTime: new Date(
      new Date(startIso).getTime() + (opts.minutos ?? 20) * 60_000,
    ),
    isAvailable: opts.isAvailable ?? true,
    appointments: opts.conCita
      ? [
          {
            id: 'apt-1',
            status: 'SCHEDULED',
            origin: opts.origen ?? 'WHATSAPP',
          },
        ]
      : opts.conCitaCancelada
        ? [
            {
              id: 'apt-1',
              status: 'CANCELLED',
              origin: opts.origen ?? 'WHATSAPP',
            },
          ]
        : [],
  });

  const conModo = (mode: 'OFF' | 'SHADOW' | 'ON') =>
    prisma.hospitalMirrorConfig.findUniqueOrThrow.mockResolvedValue({
      availabilityMode: mode,
    });

  beforeEach(async () => {
    tx = {
      $executeRawUnsafe: jest.fn(),
      scheduleSlot: {
        createMany: jest.fn(() => ({ count: 0 })),
        updateMany: jest.fn(() => ({ count: 0 })),
        deleteMany: jest.fn(() => ({ count: 0 })),
      },
    };
    prisma = {
      hospitalMirrorConfig: { findUniqueOrThrow: jest.fn() },
      mirrorEntityMap: {
        findMany: jest.fn(() => [{ agenIAId: 'doc-1', externalKey: '91-1' }]),
      },
      doctorProfile: {
        findMany: jest.fn(() => [{ id: 'doc-1', serviceId: 'srv-1' }]),
      },
      scheduleSlot: { findMany: jest.fn(() => []) },
      syncAudit: { create: jest.fn(() => ({})) },
      $transaction: jest.fn((fn: any) => fn(tx)),
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
        cupoAgenIA('2026-09-03T12:00:00.000Z', {
          isAvailable: false,
          id: 's1',
        }),
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

    // ══════════════════════════════════════════════════════════════════════
    // 🏥 Cupos a la medida de citas del HOSPITAL (fuera de la rejilla). La
    // agenda la define el hospital: AgenIA se acomoda a sus citas.
    // ══════════════════════════════════════════════════════════════════════
    describe('citas del hospital fuera de la rejilla', () => {
      it('un cupo a la medida con cita viva del hospital no se borra NI se reporta como conflicto', async () => {
        prisma.scheduleSlot.findMany.mockResolvedValue([
          cupoAgenIA('2026-09-03T15:00:00.000Z', {
            conCita: true,
            origen: 'MIRROR',
            isAvailable: false,
            id: 'a-la-medida',
            minutos: 30,
          }),
        ]);

        const r = await aplicar([cupoHis('2026-09-03T14:50:00.000Z')]);

        expect(r.conflicts).toEqual([]);
        expect(tx.scheduleSlot.deleteMany).not.toHaveBeenCalled();
        const tocados = tx.scheduleSlot.updateMany.mock.calls.flatMap(
          (c: any[]) => c[0].where.id.in,
        );
        expect(tocados).not.toContain('a-la-medida');
      });

      it('los cupos NUEVOS de la rejilla que se cruzan con esa cita nacen ocupados; los que no, libres', async () => {
        prisma.scheduleSlot.findMany.mockResolvedValue([
          cupoAgenIA('2026-09-03T15:00:00.000Z', {
            conCita: true,
            origen: 'MIRROR',
            isAvailable: false,
            minutos: 30,
          }),
        ]);

        await aplicar([
          cupoHis('2026-09-03T14:30:00.000Z'), // 14:30-14:50: no se cruza
          cupoHis('2026-09-03T14:50:00.000Z'), // 14:50-15:10: se cruza
          cupoHis('2026-09-03T15:10:00.000Z'), // 15:10-15:30: se cruza
          cupoHis('2026-09-03T15:30:00.000Z'), // 15:30-15:50: no (borde exacto)
        ]);

        const creados = tx.scheduleSlot.createMany.mock.calls[0][0].data;
        const libre = (iso: string) =>
          creados.find((c: any) => c.startTime.toISOString() === iso)
            .isAvailable;
        expect(libre('2026-09-03T14:30:00.000Z')).toBe(true);
        expect(libre('2026-09-03T14:50:00.000Z')).toBe(false);
        expect(libre('2026-09-03T15:10:00.000Z')).toBe(false);
        expect(libre('2026-09-03T15:30:00.000Z')).toBe(true);
      });

      it('un cupo EXISTENTE de la rejilla que se cruza con esa cita no se vuelve a liberar', async () => {
        // El HIS lo da por libre (no hay cita a ESA hora exacta), pero la cita
        // de 15:00 a 15:30 lo tapa: liberarlo sería vender encima.
        prisma.scheduleSlot.findMany.mockResolvedValue([
          cupoAgenIA('2026-09-03T15:00:00.000Z', {
            conCita: true,
            origen: 'MIRROR',
            isAvailable: false,
            minutos: 30,
          }),
          cupoAgenIA('2026-09-03T15:10:00.000Z', {
            isAvailable: true,
            id: 'vecino',
          }),
        ]);

        await aplicar([cupoHis('2026-09-03T15:10:00.000Z', false)]);

        expect(tx.scheduleSlot.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['vecino'] } },
          data: { isAvailable: false },
        });
      });

      it('una cita CANCELADA no tapa a nadie', async () => {
        prisma.scheduleSlot.findMany.mockResolvedValue([
          cupoAgenIA('2026-09-03T15:00:00.000Z', {
            conCitaCancelada: true,
            origen: 'MIRROR',
            minutos: 30,
          }),
        ]);

        await aplicar([cupoHis('2026-09-03T15:10:00.000Z')]);

        expect(
          tx.scheduleSlot.createMany.mock.calls[0][0].data[0].isAvailable,
        ).toBe(true);
      });

      it('una cita viva de OTRO médico no tapa los cupos de este', async () => {
        prisma.scheduleSlot.findMany.mockResolvedValue([
          {
            ...cupoAgenIA('2026-09-03T15:00:00.000Z', {
              conCita: true,
              origen: 'MIRROR',
              minutos: 30,
            }),
            doctorId: 'doc-otro',
          },
        ]);

        await aplicar([cupoHis('2026-09-03T15:10:00.000Z')]);

        expect(
          tx.scheduleSlot.createMany.mock.calls[0][0].data[0].isAvailable,
        ).toBe(true);
      });
    });

    it('🚨 un cupo que desaparece PERO tiene cita no se borra: se reporta', async () => {
      // Es un paciente con cita a una hora en la que su médico ya no atiende.
      // Eso no es un cupo sobrante, es un problema para una persona.
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', {
          conCita: true,
          id: 'con-cita',
        }),
      ]);

      const r = await aplicar([]);

      expect(tx.scheduleSlot.deleteMany).not.toHaveBeenCalled();
      expect(r.conflicts).toEqual(['doc-1|2026-09-03T15:00:00.000Z']);
    });

    // ══════════════════════════════════════════════════════════════════════
    // 🚨 Una cita CANCELADA sigue apuntando al cupo por llave foránea: es
    // historia clínica. Borrar el cupo reventaba la transacción entera con un
    // error de FK — y como el error subía, se llevaba por delante el resto del
    // barrido: los otros 399 días no se sincronizaban. La agenda se quedó
    // media hora desalineada sin que nada lo dijera.
    // ══════════════════════════════════════════════════════════════════════
    it('un cupo con cita CANCELADA no se borra: se cierra', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', {
          conCitaCancelada: true,
          id: 'con-historia',
        }),
      ]);

      const r = await aplicar([]);

      expect(tx.scheduleSlot.deleteMany).not.toHaveBeenCalled();
      expect(tx.scheduleSlot.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['con-historia'] } },
        data: { isAvailable: false },
      });
      expect(r.retired).toBe(1);
      expect(r.removed).toBe(0);
    });

    it('cerrarlo consigue lo que importa: dejar de ofrecer esa hora', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', { conCitaCancelada: true }),
      ]);

      await aplicar([]);

      const cierres = tx.scheduleSlot.updateMany.mock.calls.filter(
        (c: any[]) => c[0].data.isAvailable === false,
      );
      expect(cierres).toHaveLength(1);
    });

    it('un cupo con cita cancelada YA cerrado no se toca dos veces', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', {
          conCitaCancelada: true,
          isAvailable: false,
        }),
      ]);

      const r = await aplicar([]);

      expect(tx.scheduleSlot.updateMany).not.toHaveBeenCalled();
      expect(r.retired).toBe(0);
    });

    it('un cupo SIN ninguna cita sí se borra', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T15:00:00.000Z', { id: 'limpio' }),
      ]);

      const r = await aplicar([]);

      expect(tx.scheduleSlot.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['limpio'] } },
      });
      expect(r.retired).toBe(0);
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

  // ══════════════════════════════════════════════════════════════════════
  // 🕒 El cupo se empareja por hora de INICIO: cuando una agenda cambió de
  // duración (20 → 30 min el 2026-10-06), los cupos cuyo inicio coincidía en
  // las dos rejillas se quedaron con el fin viejo. El barrido lo corrige.
  // ══════════════════════════════════════════════════════════════════════
  describe('hora de fin desactualizada', () => {
    const cupoHis30 = (startTimeIso: string, occupied = false) => ({
      ...cupoHis(startTimeIso, occupied),
      endTimeIso: new Date(
        new Date(startTimeIso).getTime() + 30 * 60_000,
      ).toISOString(),
    });

    beforeEach(() => {
      tx.scheduleSlot.update = jest.fn(() => ({}));
    });

    it('un cupo libre de 20 min que el hospital tiene de 30 toma el fin del hospital', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', { id: 's1', minutos: 20 }),
      ]);

      const r = await aplicar([cupoHis30('2026-09-03T12:00:00.000Z')]);

      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { endTime: new Date('2026-09-03T12:30:00.000Z') },
      });
      expect(r.resized).toBe(1);
      // No es un cambio de disponibilidad.
      expect(r.updated).toBe(0);
    });

    it('también un cupo cerrado (sin cita): ocupado por el hospital, pero con su duración real', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', {
          id: 's1',
          isAvailable: false,
          conCitaCancelada: true,
        }),
      ]);

      const r = await aplicar([cupoHis30('2026-09-03T12:00:00.000Z', true)]);

      expect(r.resized).toBe(1);
    });

    it('🚨 un cupo con cita VIVA no se toca: la duración de esa cita es la suya', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', {
          id: 's1',
          isAvailable: false,
          conCita: true,
        }),
      ]);

      const r = await aplicar([cupoHis30('2026-09-03T12:00:00.000Z')]);

      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
      expect(r.resized).toBe(0);
    });

    it('con el fin correcto no hay nada que corregir (ni una consulta de más)', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', { id: 's1', minutos: 30 }),
      ]);

      const r = await aplicar([cupoHis30('2026-09-03T12:00:00.000Z')]);

      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
      expect(r.resized).toBe(0);
    });

    it('en modo sombra solo lo cuenta', async () => {
      conModo('SHADOW');
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', { id: 's1', minutos: 20 }),
      ]);

      const r = await aplicar([cupoHis30('2026-09-03T12:00:00.000Z')]);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(r.resized).toBe(1);
    });

    it('la corrección va con origen MIRROR, en la misma transacción del barrido', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoAgenIA('2026-09-03T12:00:00.000Z', { id: 's1', minutos: 20 }),
      ]);

      await aplicar([cupoHis30('2026-09-03T12:00:00.000Z')]);

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
        tx.scheduleSlot.update.mock.invocationCallOrder[0],
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

  // ══════════════════════════════════════════════════════════════════════════
  // 🗓️ Un caso por cita fuera de la agenda del hospital (2026-10-29). El 30-oct
  // el hospital borró el turno de dos médicos con 20 citas vivas y quitó horas
  // con pacientes del chat; AgenIA solo dejaba un caso general sin nombres.
  // ══════════════════════════════════════════════════════════════════════════
  describe('🗓️ citas fuera de la agenda del hospital: un caso por cita', () => {
    // Una ventana FUTURA: las citas que ya pasaron no abren caso.
    const FUT = {
      fromIso: '2030-01-08T00:00:00.000Z',
      toIso: '2030-01-09T00:00:00.000Z',
    };
    let exceptions: { registrar: jest.Mock; autoResolver: jest.Mock };
    let conCasos: MirrorAvailabilityService;

    const cita = (origin: string, id = 'apt-1') => ({
      id,
      status: 'SCHEDULED',
      origin,
      patientId: 'pac-1',
      epsId: 'eps-1',
    });
    const cupoConCita = (startIso: string, origin: string) => ({
      ...cupoAgenIA(startIso, { isAvailable: false }),
      appointments: [cita(origin)],
    });

    beforeEach(async () => {
      exceptions = {
        registrar: jest.fn().mockResolvedValue('CREADA'),
        autoResolver: jest.fn().mockResolvedValue(true),
      };
      prisma.syncException = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.doctorProfile.findMany = jest.fn(() => [
        { id: 'doc-1', serviceId: 'srv-1', whatsappBookingEnabled: true },
      ]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MirrorAvailabilityService,
          { provide: PrismaService, useValue: prisma },
          { provide: MirrorExceptionsService, useValue: exceptions },
        ],
      }).compile();
      conCasos = module.get(MirrorAvailabilityService);
      jest
        .spyOn((conCasos as any).logger, 'error')
        .mockImplementation(() => {});
      jest.spyOn((conCasos as any).logger, 'warn').mockImplementation(() => {});
    });

    const aplicarFut = (slots: any[]) =>
      conCasos.apply('org1', { ...FUT, slots });
    const casos = () => exceptions.registrar.mock.calls.map((c) => c[1]);

    it('cita del chat en una hora que el hospital quitó (el médico sigue atendiendo ese día): HORA_QUITADA', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T17:10:00.000Z', 'WHATSAPP'),
      ]);

      const r = await aplicarFut([cupoHis('2030-01-08T13:00:00.000Z')]);

      expect(r.conflicts).toEqual(['doc-1|2030-01-08T17:10:00.000Z']);
      expect(casos()).toEqual([
        expect.objectContaining({
          kind: 'CITA_EN_AGENDA_QUITADA',
          dedupeKey: 'agenda-quitada:apt-1',
          appointmentId: 'apt-1',
          patientId: 'pac-1',
          epsId: 'eps-1',
          doctorId: 'doc-1',
          appointmentStartAt: new Date('2030-01-08T17:10:00.000Z'),
          meta: { motivo: 'HORA_QUITADA', origen: 'WHATSAPP' },
        }),
      ]);
    });

    it('el médico sin ningún turno en el día: DIA_SIN_TURNO', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T17:00:00.000Z', 'WHATSAPP'),
      ]);

      await aplicarFut([]);

      expect(casos()[0]).toMatchObject({
        meta: { motivo: 'DIA_SIN_TURNO', origen: 'WHATSAPP' },
      });
    });

    it('una cita DEL HOSPITAL en un día sin turno, de un médico del asistente: también', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T15:00:00.000Z', 'MIRROR'),
      ]);

      const r = await aplicarFut([]);

      expect(r.conflicts).toEqual([]);
      expect(casos()[0]).toMatchObject({
        meta: { motivo: 'DIA_SIN_TURNO', origen: 'MIRROR' },
      });
    });

    it('una cita del hospital fuera de la rejilla en un día CON turno: sin caso (cupo a la medida)', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T15:05:00.000Z', 'MIRROR'),
      ]);

      await aplicarFut([cupoHis('2030-01-08T13:00:00.000Z')]);

      expect(exceptions.registrar).not.toHaveBeenCalled();
    });

    it('una cita del hospital de un médico SIN WhatsApp en un día sin turno: sin caso', async () => {
      prisma.doctorProfile.findMany = jest.fn(() => [
        { id: 'doc-1', serviceId: 'srv-1', whatsappBookingEnabled: false },
      ]);
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T15:00:00.000Z', 'MIRROR'),
      ]);

      await aplicarFut([]);

      expect(exceptions.registrar).not.toHaveBeenCalled();
    });

    it('una cita que ya pasó no abre caso', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        { ...cupoConCita('2026-09-03T15:00:00.000Z', 'WHATSAPP') },
      ]);

      await service.apply('org1', { ...VENTANA, slots: [] });
      await conCasos.apply('org1', { ...VENTANA, slots: [] });

      expect(exceptions.registrar).not.toHaveBeenCalled();
    });

    it('la gravedad sube con la cercanía de la cita', async () => {
      const pronto = new Date(Date.now() + 2 * 3_600_000);
      pronto.setUTCSeconds(0, 0);
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita(pronto.toISOString(), 'WHATSAPP'),
      ]);

      await conCasos.apply('org1', {
        fromIso: new Date(pronto.getTime() - 3_600_000).toISOString(),
        toIso: new Date(pronto.getTime() + 3_600_000).toISOString(),
        slots: [],
      });

      expect(casos()[0].severity).toBe('CRITICA');
    });

    it('los casos de la ventana que ya no aparecen se cierran solos; los vigentes no', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T17:10:00.000Z', 'WHATSAPP'),
      ]);
      prisma.syncException.findMany.mockResolvedValue([
        { id: 'caso-vigente', dedupeKey: 'agenda-quitada:apt-1' },
        { id: 'caso-viejo', dedupeKey: 'agenda-quitada:apt-otra' },
      ]);

      await aplicarFut([cupoHis('2030-01-08T13:00:00.000Z')]);

      expect(prisma.syncException.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org1',
          kind: 'CITA_EN_AGENDA_QUITADA',
          status: { in: ['ABIERTA', 'EN_REVISION'] },
          appointmentStartAt: {
            gte: new Date(FUT.fromIso),
            lt: new Date(FUT.toIso),
          },
        },
        select: { id: true, dedupeKey: true },
      });
      expect(exceptions.autoResolver).toHaveBeenCalledTimes(1);
      expect(exceptions.autoResolver).toHaveBeenCalledWith(
        'org1',
        'caso-viejo',
        expect.stringContaining('volvió a la agenda'),
        expect.any(Date),
      );
    });

    it('en SHADOW no abre casos (no cambia nada)', async () => {
      conModo('SHADOW');
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T17:10:00.000Z', 'WHATSAPP'),
      ]);

      await aplicarFut([cupoHis('2030-01-08T13:00:00.000Z')]);

      expect(exceptions.registrar).not.toHaveBeenCalled();
    });

    it('si abrir el caso falla, la agenda igual queda aplicada', async () => {
      exceptions.registrar.mockRejectedValue(new Error('base caída'));
      prisma.scheduleSlot.findMany.mockResolvedValue([
        cupoConCita('2030-01-08T17:10:00.000Z', 'WHATSAPP'),
      ]);

      const r = await aplicarFut([cupoHis('2030-01-08T13:00:00.000Z')]);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(r.conflicts).toHaveLength(1);
      expect(prisma.syncAudit.create).toHaveBeenCalled();
    });
  });
});
