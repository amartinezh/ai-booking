import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WaitlistService } from './waitlist.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { Prisma } from '@agenia/database';

/**
 * Lista de espera: lo que pasa con un paciente al que NO se le pudo dar cupo.
 *
 * Es la única pieza del flujo de citas que le habla al paciente sin que él
 * haya escrito primero, así que sus fallos son silenciosos por naturaleza: un
 * cupo que se libera y no se ofrece a nadie no produce ningún error, solo una
 * agenda con huecos y una cola que no avanza.
 */
describe('WaitlistService', () => {
  let service: WaitlistService;
  let prisma: {
    waitlistEntry: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    organizationSettings: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
  };
  let chatbot: {
    notifyWaitlistCandidate: jest.Mock;
    sendOutboundMessage: jest.Mock;
    isWithinServiceWindow: jest.Mock;
    ofertaDeCupoConPlantilla: jest.Mock;
  };

  const ORG = 'org-1';

  const entrada = (over: Record<string, any> = {}) => ({
    id: 'w1',
    patientId: 'p1',
    serviceId: 'svc-1',
    epsId: 'eps-1',
    whatsappId: '573001112233',
    organizationId: ORG,
    status: 'WAITING',
    createdAt: new Date('2026-05-01T10:00:00Z'),
    metadata: null,
    patient: { fullName: 'Ana Gómez' },
    service: { name: 'Medicina General' },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      waitlistEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      // Sin fila de settings = operaciones prendidas (el default).
      organizationSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      // Sin zona propia: la de Colombia.
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    chatbot = {
      // El mensaje sale.
      notifyWaitlistCandidate: jest.fn().mockResolvedValue(true),
      sendOutboundMessage: jest.fn().mockResolvedValue({ success: true }),
      // Por defecto todos escribieron hace poco (ventana de 24 h abierta).
      isWithinServiceWindow: jest.fn().mockResolvedValue(true),
      // Por defecto la clínica no tiene la plantilla «Oferta de cupo».
      ofertaDeCupoConPlantilla: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaitlistService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: ChatbotService, useValue: chatbot },
      ],
    }).compile();

    service = module.get(WaitlistService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  // ────────────────────────────────────────────────────────────────
  describe('joinWaitlist', () => {
    it('crea la entrada y devuelve la posición', async () => {
      prisma.waitlistEntry.create.mockResolvedValue(entrada());
      prisma.waitlistEntry.findUnique.mockResolvedValue(entrada());
      prisma.waitlistEntry.count.mockResolvedValue(2); // dos por delante

      const r = await service.joinWaitlist({
        patientId: 'p1',
        serviceId: 'svc-1',
        epsId: 'eps-1',
        whatsappId: '573001112233',
        organizationId: ORG,
      });

      expect(r).toEqual({ success: true, position: 3, id: 'w1' });
      expect(prisma.waitlistEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 'p1',
          serviceId: 'svc-1',
          epsId: 'eps-1',
          organizationId: ORG,
          preferredDoctorId: null,
        }),
      });
    });

    it('el médico preferido viaja cuando el paciente lo pidió', async () => {
      prisma.waitlistEntry.create.mockResolvedValue(entrada());
      prisma.waitlistEntry.findUnique.mockResolvedValue(entrada());

      await service.joinWaitlist({
        patientId: 'p1',
        serviceId: 'svc-1',
        epsId: null,
        whatsappId: 'x',
        organizationId: ORG,
        preferredDoctorId: 'doc-9',
      });

      expect(prisma.waitlistEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ preferredDoctorId: 'doc-9' }),
      });
    });

    it('no duplica: si ya esperaba lo mismo devuelve su entrada y posición actuales', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada({ id: 'w-ya' }));
      prisma.waitlistEntry.findUnique.mockResolvedValue(
        entrada({ id: 'w-ya' }),
      );
      prisma.waitlistEntry.count.mockResolvedValue(0);

      const r = await service.joinWaitlist({
        patientId: 'p1',
        serviceId: 'svc-1',
        epsId: 'eps-1',
        whatsappId: 'x',
        organizationId: ORG,
      });

      expect(r).toEqual({ success: true, position: 1, id: 'w-ya' });
      expect(prisma.waitlistEntry.create).not.toHaveBeenCalled();
    });

    it('el duplicado se busca dentro de la organización y solo entre los que esperan', async () => {
      prisma.waitlistEntry.create.mockResolvedValue(entrada());
      prisma.waitlistEntry.findUnique.mockResolvedValue(entrada());

      await service.joinWaitlist({
        patientId: 'p1',
        serviceId: 'svc-1',
        epsId: 'eps-1',
        whatsappId: 'x',
        organizationId: ORG,
      });

      expect(prisma.waitlistEntry.findFirst).toHaveBeenCalledWith({
        where: {
          patientId: 'p1',
          serviceId: 'svc-1',
          organizationId: ORG,
          status: 'WAITING',
        },
      });
    });

    it('la posición cuenta solo a los de delante: mismo servicio y más antiguos, sea cual sea su EPS', async () => {
      prisma.waitlistEntry.create.mockResolvedValue(entrada());
      prisma.waitlistEntry.findUnique.mockResolvedValue(entrada());

      await service.joinWaitlist({
        patientId: 'p1',
        serviceId: 'svc-1',
        epsId: 'eps-1',
        whatsappId: 'x',
        organizationId: ORG,
      });

      expect(prisma.waitlistEntry.count).toHaveBeenCalledWith({
        where: {
          serviceId: 'svc-1',
          organizationId: ORG,
          status: 'WAITING',
          id: { not: 'w1' },
          createdAt: { lt: new Date('2026-05-01T10:00:00Z') },
        },
      });
    });

    it('si la entrada recién creada no se puede releer, la posición cae a 1 en vez de reventar', async () => {
      prisma.waitlistEntry.create.mockResolvedValue(entrada());
      prisma.waitlistEntry.findUnique.mockResolvedValue(null);

      const r = await service.joinWaitlist({
        patientId: 'p1',
        serviceId: 'svc-1',
        epsId: null,
        whatsappId: 'x',
        organizationId: ORG,
      });

      expect(r.position).toBe(1);
      expect(prisma.waitlistEntry.count).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('notifyWaitlist — se liberó un cupo', () => {
    const params = {
      slotId: 'slot-1',
      serviceId: 'svc-1',
      epsId: 'eps-1',
      organizationId: ORG,
      doctorName: 'Dra. Ruiz',
      slotDate: new Date('2030-06-01T14:00:00Z'),
    };

    it('⏱️ un cupo que empieza en menos de 60 minutos no se ofrece a la lista de espera', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      await service.notifyWaitlist({
        ...params,
        slotDate: new Date(Date.now() + 30 * 60_000),
      });
      expect(prisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
    });

    it('elige al primero de la cola (FIFO) compatible con la EPS del cupo', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.findFirst).toHaveBeenCalledWith({
        where: {
          serviceId: 'svc-1',
          organizationId: ORG,
          status: 'WAITING',
          OR: [{ epsId: null }, { epsId: 'eps-1' }],
        },
        include: { patient: true, service: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('marca NOTIFIED con un plazo de 30 minutos y guarda el cupo pendiente', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      const antes = Date.now();

      await service.notifyWaitlist(params);

      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      expect(data.status).toBe('NOTIFIED');
      expect(data.metadata).toEqual({
        pendingSlotId: 'slot-1',
        doctorName: 'Dra. Ruiz',
        slotDate: '2030-06-01T14:00:00.000Z',
        epsDelCupo: 'eps-1',
      });
      const minutos = (data.expiresAt.getTime() - antes) / 60000;
      expect(minutos).toBeGreaterThan(29);
      expect(minutos).toBeLessThanOrEqual(30.5);
    });

    it('el mensaje lo redacta el chatbot, con el nombre del paciente y del servicio', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith({
        whatsappId: '573001112233',
        organizationId: ORG,
        nombre: 'Ana Gómez',
        especialidad: 'Medicina General',
        doctor: 'Dra. Ruiz',
        slotDate: params.slotDate,
        slotId: 'slot-1',
        via: 'TEXTO',
      });
    });

    it('con las operaciones del bot apagadas no ofrece el cupo y la cola queda intacta', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        bookingEnabled: false,
      });
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('📅 un cupo de un día sin citas por el asistente no se ofrece y la cola queda intacta', async () => {
      // 2030-06-01T14:00Z son las 9:00 del 1 de junio en Bogotá: día bloqueado.
      (prisma as any).bookingBlock = {
        findMany: jest.fn().mockResolvedValue([
          {
            date: '2030-06-01',
            repeatWeekly: false,
            startMinute: null,
            endMinute: null,
          },
        ]),
      };
      (prisma as any).organization = {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/Bogota' }),
      };
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('📅 con un bloqueo de OTRO día, el cupo se ofrece como siempre', async () => {
      (prisma as any).bookingBlock = {
        findMany: jest.fn().mockResolvedValue([
          {
            date: '2030-06-02',
            repeatWeekly: false,
            startMinute: null,
            endMinute: null,
          },
        ]),
      };
      (prisma as any).organization = {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/Bogota' }),
      };
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalled();
    });

    it('🗓️ un cupo más allá del plazo máximo para agendar no se ofrece y la cola queda intacta', async () => {
      // El cupo de ejemplo es de 2030: con 30 días queda fuera.
      prisma.organizationSettings.findUnique.mockResolvedValue({
        bookingEnabled: true,
        bookingMaxDaysAhead: 30,
      });
      (prisma as any).organization = {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/Bogota' }),
      };
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('🗓️ un cupo dentro del plazo se ofrece como siempre', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        bookingEnabled: true,
        bookingMaxDaysAhead: 30,
      });
      (prisma as any).organization = {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/Bogota' }),
      };
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist({
        ...params,
        slotDate: new Date(Date.now() + 2 * 24 * 60 * 60_000),
      });

      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalled();
    });

    // 2026-10-26: en Anserma todos los cupos son para cualquier EPS y el asistente
    // siempre anota la EPS del paciente: la búsqueda solo cruzaba «cupo de cualquier
    // EPS» con «paciente sin EPS» y la lista nunca le avisó a nadie (Henry, Sura,
    // esperó desde el 23-oct mientras se liberaban cupos).
    it('un cupo para cualquier EPS se le ofrece al primero de la cola, aunque tenga EPS', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ epsId: 'sura' }),
      );

      await service.notifyWaitlist({ ...params, epsId: null });

      expect(prisma.waitlistEntry.findFirst).toHaveBeenCalledWith({
        where: { serviceId: 'svc-1', organizationId: ORG, status: 'WAITING' },
        include: { patient: true, service: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: '573001112233' }),
      );
      expect(
        prisma.waitlistEntry.update.mock.calls[0][0].data.metadata,
      ).toEqual(expect.objectContaining({ epsDelCupo: null }));
    });

    it('a quien no escribió en las últimas 24 h no se le escribe ni pierde el turno: pasa al siguiente', async () => {
      const viejo = entrada({ id: 'w1', whatsappId: '573000000001' });
      const reciente = entrada({ id: 'w2', whatsappId: '573000000002' });
      prisma.waitlistEntry.findFirst
        .mockResolvedValueOnce(viejo)
        .mockResolvedValueOnce(reciente);
      chatbot.isWithinServiceWindow.mockImplementation(
        async (_org: string, id: string) => id === '573000000002',
      );

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.findFirst.mock.calls[1][0].where.id).toEqual({
        notIn: ['w1'],
      });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledTimes(1);
      expect(prisma.waitlistEntry.update.mock.calls[0][0].where).toEqual({
        id: 'w2',
      });
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledTimes(1);
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: '573000000002' }),
      );
    });

    it('si a nadie de la cola se le puede escribir, el cupo queda en la agenda y nadie cambia de estado', async () => {
      prisma.waitlistEntry.findFirst
        .mockResolvedValueOnce(entrada({ id: 'w1' }))
        .mockResolvedValueOnce(null);
      chatbot.isWithinServiceWindow.mockResolvedValue(false);

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('a Telegram se le ofrece sin mirar la ventana de 24 h (no tiene)', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ whatsappId: 'tg:3001234567' }),
      );
      chatbot.isWithinServiceWindow.mockResolvedValue(false);

      await service.notifyWaitlist(params);

      expect(chatbot.isWithinServiceWindow).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: 'tg:3001234567' }),
      );
    });

    // 📨 2026-10-26: a quien no escribió en 24 h se le ofrece con la plantilla
    // «Oferta de cupo», si la clínica la tiene y es de día en la clínica.
    describe('📨 con la plantilla «Oferta de cupo»', () => {
      // 10:00 en Bogotá (15:00 UTC); el cupo es al día siguiente.
      const DE_DIA = new Date('2030-05-31T15:00:00.000Z');
      // 21:00 en Bogotá.
      const DE_NOCHE = new Date('2030-06-01T02:00:00.000Z');
      const cupo = { ...params, slotDate: new Date('2030-06-02T14:00:00Z') };
      const sinVentana = () =>
        chatbot.isWithinServiceWindow.mockResolvedValue(false);

      afterEach(() => jest.useRealTimers());

      it('de día, al primero de la cola (aunque no haya escrito) le llega la plantilla: el orden se respeta', async () => {
        jest.useFakeTimers({
          now: DE_DIA,
          doNotFake: ['nextTick', 'setImmediate'],
        });
        sinVentana();
        chatbot.ofertaDeCupoConPlantilla.mockResolvedValue(true);
        prisma.waitlistEntry.findFirst.mockResolvedValue(
          entrada({ epsId: 'sura' }),
        );

        await service.notifyWaitlist({ ...cupo, epsId: null });

        expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
          expect.objectContaining({
            whatsappId: '573001112233',
            via: 'PLANTILLA',
          }),
        );
        expect(prisma.waitlistEntry.update.mock.calls[0][0].data.status).toBe(
          'NOTIFIED',
        );
      });

      it('de noche no sale la plantilla: el cupo va al primero que escribió hace poco y el otro conserva su lugar', async () => {
        jest.useFakeTimers({
          now: DE_NOCHE,
          doNotFake: ['nextTick', 'setImmediate'],
        });
        chatbot.ofertaDeCupoConPlantilla.mockResolvedValue(true);
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(
            entrada({ id: 'w1', whatsappId: '573000000001' }),
          )
          .mockResolvedValueOnce(
            entrada({ id: 'w2', whatsappId: '573000000002' }),
          );
        chatbot.isWithinServiceWindow.mockImplementation(
          async (_o: string, id: string) => id === '573000000002',
        );

        await service.notifyWaitlist(cupo);

        expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledTimes(1);
        expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
          expect.objectContaining({ whatsappId: '573000000002', via: 'TEXTO' }),
        );
        // De noche ni se pregunta por la plantilla.
        expect(chatbot.ofertaDeCupoConPlantilla).not.toHaveBeenCalled();
      });

      it('el horario es el de la clínica: las 10:00 de Bogotá son las 00:00 en Tokio', async () => {
        jest.useFakeTimers({
          now: DE_DIA,
          doNotFake: ['nextTick', 'setImmediate'],
        });
        sinVentana();
        chatbot.ofertaDeCupoConPlantilla.mockResolvedValue(true);
        prisma.organization.findUnique.mockResolvedValue({
          timezone: 'Asia/Tokyo',
        });
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(entrada())
          .mockResolvedValueOnce(null);

        await service.notifyWaitlist(cupo);

        expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
        expect(prisma.organization.findUnique).toHaveBeenCalledWith({
          where: { id: ORG },
          select: { timezone: true },
        });
      });

      it('la plantilla se mira una sola vez por cupo, aunque varios de la cola no hayan escrito', async () => {
        jest.useFakeTimers({
          now: DE_DIA,
          doNotFake: ['nextTick', 'setImmediate'],
        });
        sinVentana();
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(entrada({ id: 'w1' }))
          .mockResolvedValueOnce(entrada({ id: 'w2' }))
          .mockResolvedValueOnce(entrada({ id: 'w3' }))
          .mockResolvedValueOnce(null);

        await service.notifyWaitlist(cupo);

        expect(chatbot.ofertaDeCupoConPlantilla).toHaveBeenCalledTimes(1);
        expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
        expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      });

      it('si el mensaje no sale, vuelve a esperar con su turno (sin rastro de la oferta) y el cupo pasa al siguiente', async () => {
        jest.useFakeTimers({
          now: DE_DIA,
          doNotFake: ['nextTick', 'setImmediate'],
        });
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(
            entrada({ id: 'w1', whatsappId: '573000000001' }),
          )
          .mockResolvedValueOnce(
            entrada({ id: 'w2', whatsappId: '573000000002' }),
          );
        chatbot.notifyWaitlistCandidate
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);

        await service.notifyWaitlist(cupo);

        const updates = prisma.waitlistEntry.update.mock.calls.map(
          (c: any[]) => c[0],
        );
        expect(updates[0]).toMatchObject({
          where: { id: 'w1' },
          data: { status: 'NOTIFIED' },
        });
        expect(updates[1]).toEqual({
          where: { id: 'w1' },
          data: {
            status: 'WAITING',
            notifiedAt: null,
            expiresAt: null,
            metadata: Prisma.DbNull,
          },
        });
        expect(updates[2]).toMatchObject({
          where: { id: 'w2' },
          data: { status: 'NOTIFIED' },
        });
        expect(
          prisma.waitlistEntry.findFirst.mock.calls[1][0].where.id,
        ).toEqual({
          notIn: ['w1'],
        });
      });
    });

    it('sin nadie esperando no escribe ni notifica a nadie', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);

      await service.notifyWaitlist(params);

      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('confirmFromWaitlist', () => {
    it('SÍ → CONFIRMED y devuelve el cupo reservado para ese paciente', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ metadata: { pendingSlotId: 'slot-7' } }),
      );

      const r = await service.confirmFromWaitlist({
        whatsappId: '573001112233',
        organizationId: ORG,
        confirmed: true,
      });

      // La EPS con la que ENTRÓ a la lista: la cita se reserva con esa, no con la
      // de su ficha (quien está en el padrón puede pedirla particular).
      expect(r).toEqual({ slotId: 'slot-7', patientId: 'p1', epsId: 'eps-1' });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { status: 'CONFIRMED' },
      });
    });

    it('NO → se cancela y el cupo pasa al siguiente de la cola, no se pierde', async () => {
      const primero = entrada({
        metadata: {
          pendingSlotId: 'slot-7',
          doctorName: 'Dra. Ruiz',
          slotDate: '2030-06-01T14:00:00.000Z',
        },
      });
      const segundo = entrada({ id: 'w2', patientId: 'p2' });
      prisma.waitlistEntry.findFirst
        .mockResolvedValueOnce(primero) // el que rechaza
        .mockResolvedValueOnce(segundo); // el siguiente de la cola

      const r = await service.confirmFromWaitlist({
        whatsappId: '573001112233',
        organizationId: ORG,
        confirmed: false,
      });

      expect(r).toEqual({ slotId: null, patientId: null, epsId: null });
      expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'w1' },
        data: { status: 'CANCELLED' },
      });
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: segundo.whatsappId }),
      );
    });

    it('al reofrecer tras un NO se busca con la EPS del CUPO, no con la del que lo rechazó', async () => {
      const primero = entrada({
        epsId: 'sura',
        metadata: {
          pendingSlotId: 'slot-7',
          doctorName: 'Dra. Ruiz',
          slotDate: '2030-06-01T14:00:00.000Z',
          epsDelCupo: null,
        },
      });
      prisma.waitlistEntry.findFirst
        .mockResolvedValueOnce(primero)
        .mockResolvedValueOnce(entrada({ id: 'w2', epsId: 'salud-total' }));

      await service.confirmFromWaitlist({
        whatsappId: '573001112233',
        organizationId: ORG,
        confirmed: false,
      });

      expect(prisma.waitlistEntry.findFirst.mock.calls[1][0].where).toEqual({
        serviceId: 'svc-1',
        organizationId: ORG,
        status: 'WAITING',
      });
    });

    it('una oferta de antes, sin la EPS del cupo guardada, se reofrece como siempre (con la del paciente)', async () => {
      prisma.waitlistEntry.findFirst
        .mockResolvedValueOnce(
          entrada({
            metadata: {
              pendingSlotId: 'slot-7',
              doctorName: 'Dra. Ruiz',
              slotDate: '2030-06-01T14:00:00.000Z',
            },
          }),
        )
        .mockResolvedValueOnce(null);

      await service.confirmFromWaitlist({
        whatsappId: '573001112233',
        organizationId: ORG,
        confirmed: false,
      });

      expect(prisma.waitlistEntry.findFirst.mock.calls[1][0].where.OR).toEqual([
        { epsId: null },
        { epsId: 'eps-1' },
      ]);
    });

    it('sin ninguna notificación viva devuelve vacío y no escribe nada', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);

      const r = await service.confirmFromWaitlist({
        whatsappId: 'x',
        organizationId: ORG,
        confirmed: true,
      });

      expect(r).toEqual({ slotId: null, patientId: null, epsId: null });
      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
    });

    it('solo mira entradas NOTIFIED de esa clínica: la de otra org no cuenta', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);

      await service.confirmFromWaitlist({
        whatsappId: 'x',
        organizationId: ORG,
        confirmed: true,
      });

      expect(prisma.waitlistEntry.findFirst).toHaveBeenCalledWith({
        where: { whatsappId: 'x', organizationId: ORG, status: 'NOTIFIED' },
        include: { patient: true },
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('expireStaleNotifications (cron)', () => {
    const vencida = entrada({
      status: 'NOTIFIED',
      metadata: {
        pendingSlotId: 'slot-7',
        doctorName: 'Dra. Ruiz',
        slotDate: '2030-06-01T14:00:00.000Z',
      },
    });

    it('sin vencidas no hace nada', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([]);
      await service.expireStaleNotifications();
      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      expect(chatbot.sendOutboundMessage).not.toHaveBeenCalled();
    });

    it('marca EXPIRED, avisa al paciente y ofrece el cupo al siguiente', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ id: 'w2', whatsappId: '573009998877' }),
      );

      await service.expireStaleNotifications();

      expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'w1' },
        data: { status: 'EXPIRED' },
      });
      expect(chatbot.sendOutboundMessage).toHaveBeenCalledWith(
        '573001112233',
        expect.stringContaining('expiró'),
        ORG,
      );
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: '573009998877' }),
      );
    });

    it('el aviso sale por la línea de SU clínica, no por la que el caché tuviera', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        entrada({
          status: 'NOTIFIED',
          organizationId: 'org-de-verdad',
          metadata: {},
        }),
      ]);

      await service.expireStaleNotifications();

      expect(chatbot.sendOutboundMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'org-de-verdad',
      );
    });

    it('si el aviso al paciente falla, la entrada igual queda EXPIRED y el cupo se reofrece', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada({ id: 'w2' }));
      chatbot.sendOutboundMessage.mockRejectedValue(new Error('Meta 401'));

      await expect(service.expireStaleNotifications()).resolves.toBeUndefined();

      expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'w1' },
        data: { status: 'EXPIRED' },
      });
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalled();
    });

    it('una entrada sin cupo pendiente en su metadata no reofrece nada', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        entrada({ status: 'NOTIFIED', metadata: {} }),
      ]);

      await service.expireStaleNotifications();

      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('procesa TODAS las vencidas del tick, no solo la primera', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        entrada({ id: 'a', status: 'NOTIFIED', metadata: {} }),
        entrada({ id: 'b', status: 'NOTIFIED', metadata: {} }),
        entrada({ id: 'c', status: 'NOTIFIED', metadata: {} }),
      ]);

      await service.expireStaleNotifications();

      expect(prisma.waitlistEntry.update).toHaveBeenCalledTimes(3);
      expect(chatbot.sendOutboundMessage).toHaveBeenCalledTimes(3);
    });

    it('a quien no escribió en las últimas 24 h (se le ofreció con la plantilla) no se le manda el «expiró»: WhatsApp lo rechazaría', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        entrada({ status: 'NOTIFIED', metadata: {} }),
      ]);
      chatbot.isWithinServiceWindow.mockResolvedValue(false);

      await service.expireStaleNotifications();

      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { status: 'EXPIRED' },
      });
      expect(chatbot.sendOutboundMessage).not.toHaveBeenCalled();
    });

    it('solo recoge las NOTIFIED cuyo plazo ya venció', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([]);
      await service.expireStaleNotifications();
      const where = prisma.waitlistEntry.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('NOTIFIED');
      expect(where.expiresAt.lt).toBeInstanceOf(Date);
    });
  });
});
