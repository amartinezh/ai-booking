import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WaitlistService, minutosParaContestar } from './waitlist.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { RedisService } from '../redis/redis.service';
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
      updateMany: jest.Mock;
    };
    organizationSettings: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    scheduleSlot: { findFirst: jest.Mock; findMany: jest.Mock };
    appointment: { findFirst: jest.Mock };
  };
  /** Redis de mentiras: el apartado de cupos (clave → valor). */
  /** Los cupos que el chat ofrecería (para la respuesta tardía). */
  let appointments: { getAvailableSlots: jest.Mock };
  let redis: {
    store: Map<string, string>;
    ttl: Map<string, number>;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // El médico del cupo agenda por el asistente.
      scheduleSlot: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ doctor: { whatsappBookingEnabled: true } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Sin fila de settings = operaciones prendidas (el default).
      organizationSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      // Sin zona propia: la de Colombia.
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      // Nadie de la lista consiguió cita por otro camino.
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const store = new Map<string, string>();
    const ttl = new Map<string, number>();
    redis = {
      store,
      ttl,
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string, _ex?: string, seg?: number) => {
        store.set(k, v);
        if (seg) ttl.set(k, seg);
        return 'OK';
      }),
      del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    };
    appointments = { getAvailableSlots: jest.fn().mockResolvedValue([]) };
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
        { provide: RedisService, useValue: redis },
        { provide: AppointmentsService, useValue: appointments },
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

    // 2026-10-30: 8 de 14 ofertas en dos semanas fueron cupos del médico comodín
    // del hospital, con WhatsApp apagado; al «SÍ», la reserva se rechazaba.
    it('👨‍⚕️ un cupo de un médico que no agenda por el asistente no se ofrece: la cola queda intacta', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        doctor: { whatsappBookingEnabled: false },
      });
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await service.notifyWaitlist(params);

      expect(prisma.scheduleSlot.findFirst).toHaveBeenCalledWith({
        where: { id: 'slot-1', organizationId: ORG },
        select: {
          isAvailable: true,
          doctor: { select: { whatsappBookingEnabled: true } },
        },
      });
      expect(prisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    // 2026-11-02: al vencer una oferta, el cupo se le ofrecía al siguiente aunque
    // ya no estuviera libre (lo tomó otro o el hospital lo cerró).
    it('🔒 un cupo que ya no está libre no se ofrece: nadie dice SÍ a un cupo que no hay', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        isAvailable: false,
        doctor: { whatsappBookingEnabled: true },
      });
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

      await expect(service.notifyWaitlist(params)).resolves.toBe(false);
      expect(prisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('un cupo que no existe (o de otra clínica) tampoco se ofrece', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue(null);
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      await service.notifyWaitlist(params);
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

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

    // El plazo depende de la hora (2026-11-10: con el mostrador abierto, 30 min):
    // estas pruebas fijan el reloj y no dependen de cuándo se corren.
    const NOCHE = new Date('2026-11-04T03:00:00.000Z'); // mar 3-nov, 10 p. m.
    const MOSTRADOR = new Date('2026-11-10T12:52:00.000Z'); // mar 10-nov, 7:52 a. m.
    const congelarEn = (fecha: Date) =>
      jest.useFakeTimers({
        now: fecha,
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
          'queueMicrotask',
        ],
      });
    afterEach(() => jest.useRealTimers());

    it('marca NOTIFIED y guarda el cupo pendiente; de noche, un cupo a más de 12 h da 2 horas para contestar', async () => {
      congelarEn(NOCHE);
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
      expect(minutos).toBeGreaterThan(119);
      expect(minutos).toBeLessThanOrEqual(120.5);
    });

    // 2026-11-10: el mostrador agendaba los cupos apartados 2 horas para la lista.
    it('con el mostrador abierto, aunque el cupo sea lejano, 30 minutos', async () => {
      congelarEn(MOSTRADOR);
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      const antes = Date.now();

      await service.notifyWaitlist(params);

      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      const minutos = (data.expiresAt.getTime() - antes) / 60000;
      expect(minutos).toBeGreaterThan(29);
      expect(minutos).toBeLessThanOrEqual(30.5);
      // Y el apartado (el chat no lo muestra) dura eso, no 2 horas.
      expect(redis.ttl.get(`cupo_apartado:${ORG}:slot-1`)).toBeLessThanOrEqual(
        32 * 60 + 1,
      );
    });

    // 2026-11-03: 30 minutos si el cupo es pronto (hay que moverlo rápido).
    it('un cupo en menos de 12 horas da 30 minutos para contestar', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      const antes = Date.now();
      await service.notifyWaitlist({
        ...params,
        slotDate: new Date(antes + 5 * 3_600_000),
      });
      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
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
        // Hasta cuándo tiene para contestar: el mensaje lo dice.
        hasta: prisma.waitlistEntry.update.mock.calls[0][0].data.expiresAt,
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
    // ──────────────────────────────────────────────────────────────
    // 2026-10-31: la lista recibe también los cupos libres (agenda nueva, días que
    // entran al plazo). Que un cupo no se ofrezca dos veces, que se aparte mientras
    // la persona responde, y que no se le ofrezca a quien ya no lo necesita.
    // ──────────────────────────────────────────────────────────────
    describe('🔔 ofertas sin repetir, apartadas y a quien todavía espera', () => {
      it('dice si se lo ofreció a alguien', async () => {
        prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
        await expect(service.notifyWaitlist(params)).resolves.toBe(true);
        prisma.waitlistEntry.findFirst.mockResolvedValue(null);
        await expect(service.notifyWaitlist(params)).resolves.toBe(false);
      });

      it('el cupo ofrecido queda apartado para esa persona mientras responde (el chat no lo muestra)', async () => {
        congelarEn(NOCHE);
        prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
        await service.notifyWaitlist(params);
        expect(redis.store.get(`cupo_apartado:${ORG}:slot-1`)).toBe(
          '573001112233',
        );
        // Sus 2 horas (el cupo es lejano) y un margen.
        expect(redis.ttl.get(`cupo_apartado:${ORG}:slot-1`)).toBeGreaterThan(
          120 * 60,
        );
        expect(
          redis.ttl.get(`cupo_apartado:${ORG}:slot-1`),
        ).toBeLessThanOrEqual(122 * 60 + 1);
      });

      it('si el mensaje no sale, el cupo se suelta', async () => {
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(entrada())
          .mockResolvedValueOnce(null);
        chatbot.notifyWaitlistCandidate.mockResolvedValue(false);
        await expect(service.notifyWaitlist(params)).resolves.toBe(false);
        expect(redis.store.has(`cupo_apartado:${ORG}:slot-1`)).toBe(false);
      });

      it.each([
        ['ya se le ofreció a alguien que no ha respondido', 'NOTIFIED'],
        ['lo tiene apartado un paciente del chat', 'CHAT'],
        ['hace poco no se pudo tomar desde la lista', 'FALLIDO'],
      ])('%s: no se ofrece', async (_d, caso) => {
        if (caso === 'NOTIFIED')
          prisma.waitlistEntry.count.mockResolvedValue(1);
        if (caso === 'CHAT')
          redis.store.set(`cupo_apartado:${ORG}:slot-1`, '573005550000');
        if (caso === 'FALLIDO')
          redis.store.set(`lista_cupo_fallido:${ORG}:slot-1`, '1');
        prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());

        await expect(service.notifyWaitlist(params)).resolves.toBe(false);
        expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
        expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
      });

      it('busca la oferta viva de ESE cupo en esa clínica', async () => {
        prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
        await service.notifyWaitlist(params);
        expect(prisma.waitlistEntry.count).toHaveBeenCalledWith({
          where: {
            organizationId: ORG,
            status: 'NOTIFIED',
            metadata: { path: ['pendingSlotId'], equals: 'slot-1' },
          },
        });
      });

      it('🙅 a quien dijo NO a ese cupo no se le vuelve a ofrecer: pasa al siguiente', async () => {
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(
            entrada({ metadata: { rechazados: ['slot-1'] } }),
          )
          .mockResolvedValueOnce(
            entrada({ id: 'w2', whatsappId: '573009998877' }),
          );
        await service.notifyWaitlist(params);
        expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledTimes(1);
        expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
          expect.objectContaining({ whatsappId: '573009998877' }),
        );
        expect(
          prisma.waitlistEntry.findFirst.mock.calls[1][0].where.id,
        ).toEqual({ notIn: ['w1'] });
      });

      it('🙅 ni otro cupo del día al que dijo NO; uno de otro día sí', async () => {
        const conDia = entrada({
          metadata: { diasRechazados: ['2030-06-01'] },
        });
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(conDia)
          .mockResolvedValueOnce(null);
        await expect(
          service.notifyWaitlist({
            ...params,
            slotId: 'slot-9',
            slotDate: new Date('2030-06-01T20:00:00Z'),
          }),
        ).resolves.toBe(false);
        expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();

        prisma.waitlistEntry.findFirst.mockResolvedValue(conDia);
        await expect(
          service.notifyWaitlist({
            ...params,
            slotId: 'slot-9',
            slotDate: new Date('2030-06-04T14:00:00Z'),
          }),
        ).resolves.toBe(true);
      });

      it('lo que ya rechazó viaja con la oferta (no se pierde al ofrecerle otro)', async () => {
        prisma.waitlistEntry.findFirst.mockResolvedValue(
          entrada({
            metadata: {
              rechazados: ['slot-0'],
              diasRechazados: ['2030-05-30'],
            },
          }),
        );
        await service.notifyWaitlist(params);
        expect(
          prisma.waitlistEntry.update.mock.calls[0][0].data.metadata,
        ).toEqual({
          rechazados: ['slot-0'],
          diasRechazados: ['2030-05-30'],
          pendingSlotId: 'slot-1',
          doctorName: 'Dra. Ruiz',
          slotDate: '2030-06-01T14:00:00.000Z',
          epsDelCupo: 'eps-1',
        });
      });

      it('📅 quien ya consiguió cita de ese servicio después de anotarse sale de la lista y el cupo pasa al siguiente', async () => {
        prisma.waitlistEntry.findFirst
          .mockResolvedValueOnce(entrada())
          .mockResolvedValueOnce(
            entrada({ id: 'w2', patientId: 'p2', whatsappId: '573009998877' }),
          );
        prisma.appointment.findFirst
          .mockResolvedValueOnce({ id: 'apt-9' })
          .mockResolvedValueOnce(null);

        await service.notifyWaitlist(params);

        expect(prisma.appointment.findFirst.mock.calls[0][0]).toEqual({
          where: {
            organizationId: ORG,
            patientId: 'p1',
            status: { not: 'CANCELLED' },
            createdAt: { gt: new Date('2026-05-01T10:00:00Z') },
            scheduleSlot: { serviceId: 'svc-1' },
          },
          select: { id: true },
        });
        expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
          where: { id: 'w1' },
          data: {
            status: 'CANCELLED',
            metadata: { motivo: 'YA_TIENE_CITA', appointmentId: 'apt-9' },
          },
        });
        expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
          expect.objectContaining({ whatsappId: '573009998877' }),
        );
      });

      it('si no se puede revisar su cita, sigue en la lista y se le ofrece', async () => {
        prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
        prisma.appointment.findFirst.mockRejectedValue(new Error('caída'));
        await expect(service.notifyWaitlist(params)).resolves.toBe(true);
      });
    });

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

    it('NO → sigue en la lista en su mismo puesto (sin ese cupo ni ese día) y el cupo pasa al siguiente', async () => {
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
      // 2026-10-31: antes salía de la lista (CANCELLED) aunque el mensaje le dijera
      // «usted sigue en la lista».
      expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'w1' },
        data: {
          status: 'WAITING',
          notifiedAt: null,
          expiresAt: null,
          metadata: {
            rechazados: ['slot-7'],
            // 14:00 UTC = 9:00 en Bogotá, ese mismo día.
            diasRechazados: ['2030-06-01'],
          },
        },
      });
      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('createdAt');
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: segundo.whatsappId }),
      );
    });

    it('NO: suelta el cupo que tenía apartado, y el siguiente lo recibe apartado', async () => {
      redis.store.set(`cupo_apartado:${ORG}:slot-7`, '573001112233');
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
        .mockResolvedValueOnce(
          entrada({ id: 'w2', whatsappId: '573009998877' }),
        );

      await service.confirmFromWaitlist({
        whatsappId: '573001112233',
        organizationId: ORG,
        confirmed: false,
      });

      expect(redis.store.get(`cupo_apartado:${ORG}:slot-7`)).toBe(
        '573009998877',
      );
    });

    it('SÍ: suelta el apartado (la reserva revisa que siga libre)', async () => {
      redis.store.set(`cupo_apartado:${ORG}:slot-7`, '573001112233');
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ metadata: { pendingSlotId: 'slot-7' } }),
      );
      await service.confirmFromWaitlist({
        whatsappId: '573001112233',
        organizationId: ORG,
        confirmed: true,
      });
      expect(redis.store.has(`cupo_apartado:${ORG}:slot-7`)).toBe(false);
    });

    it('un segundo NO suma el cupo y el día a lo que ya había rechazado', async () => {
      prisma.waitlistEntry.findFirst
        .mockResolvedValueOnce(
          entrada({
            metadata: {
              rechazados: ['slot-1'],
              diasRechazados: ['2030-05-30'],
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

      expect(
        prisma.waitlistEntry.update.mock.calls[0][0].data.metadata,
      ).toEqual({
        rechazados: ['slot-1', 'slot-7'],
        diasRechazados: ['2030-05-30', '2030-06-01'],
      });
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

      // Sin oferta por contestar: el chat lo atiende como respuesta tardía.
      expect(r).toEqual({
        slotId: null,
        patientId: null,
        epsId: null,
        sinOferta: true,
      });
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
  // 2026-10-30: dijo SÍ y el cupo ya no se podía tomar. Quedaba CONFIRMED y, al
  // anotarse otra vez, pasaba del primer puesto al noveno.
  // 2026-11-02: para repetirle la oferta a quien saluda en vez de contestar.
  describe('ofertaPendiente', () => {
    it('la oferta vigente: nombre, servicio, médico, fecha y hasta cuándo', async () => {
      const expiresAt = new Date(Date.now() + 20 * 60_000);
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({
          status: 'NOTIFIED',
          expiresAt,
          metadata: {
            pendingSlotId: 'slot-7',
            doctorName: 'Dra. Ruiz',
            slotDate: '2030-06-01T14:00:00.000Z',
          },
        }),
      );
      await expect(
        service.ofertaPendiente({
          whatsappId: '573001112233',
          organizationId: ORG,
        }),
      ).resolves.toEqual({
        nombre: 'Ana Gómez',
        servicio: 'Medicina General',
        doctorName: 'Dra. Ruiz',
        slotDate: new Date('2030-06-01T14:00:00.000Z'),
        expiresAt,
      });
      expect(prisma.waitlistEntry.findFirst).toHaveBeenCalledWith({
        where: {
          whatsappId: '573001112233',
          organizationId: ORG,
          status: 'NOTIFIED',
        },
        include: { patient: true, service: true },
      });
    });

    it('sin oferta, o vencida: null', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.ofertaPendiente({ whatsappId: 'x', organizationId: ORG }),
      ).resolves.toBeNull();
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({
          status: 'NOTIFIED',
          expiresAt: new Date(Date.now() - 60_000),
          metadata: { slotDate: '2030-06-01T14:00:00.000Z' },
        }),
      );
      await expect(
        service.ofertaPendiente({ whatsappId: 'x', organizationId: ORG }),
      ).resolves.toBeNull();
    });
  });

  describe('cerrarLosQueYaTienenCita', () => {
    it('saca de la lista a quien ya tiene cita de ese servicio y deja a los demás', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        entrada(),
        entrada({ id: 'w2', patientId: 'p2' }),
      ]);
      prisma.appointment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'apt-2' });

      await expect(
        service.cerrarLosQueYaTienenCita(ORG, 'svc-1'),
      ).resolves.toBe(1);
      expect(prisma.waitlistEntry.findMany.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
        serviceId: 'svc-1',
        status: 'WAITING',
      });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledTimes(1);
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w2' },
        data: {
          status: 'CANCELLED',
          metadata: { motivo: 'YA_TIENE_CITA', appointmentId: 'apt-2' },
        },
      });
    });
  });

  describe('volverAEsperar', () => {
    it('la entrada de ESE cupo vuelve a WAITING, sin tocar su fecha (conserva el puesto)', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue({
        id: 'w1',
        metadata: { pendingSlotId: 'slot-1', doctorName: 'Dra. Ruiz' },
      });
      await expect(
        service.volverAEsperar({
          whatsappId: '573001112233',
          organizationId: ORG,
          slotId: 'slot-1',
        }),
      ).resolves.toBe(true);

      expect(prisma.waitlistEntry.findFirst).toHaveBeenCalledWith({
        where: {
          whatsappId: '573001112233',
          organizationId: ORG,
          status: 'CONFIRMED',
          metadata: { path: ['pendingSlotId'], equals: 'slot-1' },
        },
        select: { id: true, metadata: true },
      });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: {
          status: 'WAITING',
          notifiedAt: null,
          expiresAt: null,
          // Ese cupo no se le vuelve a ofrecer.
          metadata: { rechazados: ['slot-1'] },
        },
      });
      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('createdAt');
    });

    it('conserva lo que ya había rechazado', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue({
        id: 'w1',
        metadata: {
          rechazados: ['slot-0'],
          diasRechazados: ['2030-05-30'],
          pendingSlotId: 'slot-1',
        },
      });
      await service.volverAEsperar({
        whatsappId: '573001112233',
        organizationId: ORG,
        slotId: 'slot-1',
      });
      expect(
        prisma.waitlistEntry.update.mock.calls[0][0].data.metadata,
      ).toEqual({
        rechazados: ['slot-0', 'slot-1'],
        diasRechazados: ['2030-05-30'],
      });
    });

    it('ese cupo no se le ofrece a nadie más de la lista por 6 horas, y se suelta su apartado', async () => {
      redis.store.set(`cupo_apartado:${ORG}:slot-1`, '573001112233');
      await service.volverAEsperar({
        whatsappId: '573001112233',
        organizationId: ORG,
        slotId: 'slot-1',
      });
      expect(redis.store.get(`lista_cupo_fallido:${ORG}:slot-1`)).toBe('1');
      expect(redis.ttl.get(`lista_cupo_fallido:${ORG}:slot-1`)).toBe(
        6 * 60 * 60,
      );
      expect(redis.store.has(`cupo_apartado:${ORG}:slot-1`)).toBe(false);
    });

    it('sin una entrada de ese cupo, no hace nada y lo dice', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.volverAEsperar({
          whatsappId: '573001112233',
          organizationId: ORG,
          slotId: 'slot-1',
        }),
      ).resolves.toBe(false);
    });
  });

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

    // 2026-11-03: antes salía de la lista a la primera; 6 de 33 ofertas se
    // contestaron tarde y esas personas se volvían a anotar al final.
    it('🙋 la primera sin contestar: conserva su puesto, guarda la oferta vencida, se le dice y el cupo pasa al siguiente', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ id: 'w2', whatsappId: '573009998877' }),
      );

      await service.expireStaleNotifications();

      expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'w1' },
        data: {
          status: 'WAITING',
          notifiedAt: null,
          expiresAt: null,
          metadata: {
            // Ese cupo no se le vuelve a ofrecer a ella.
            rechazados: ['slot-7'],
            sinRespuesta: 1,
            ultimaOferta: {
              slotId: 'slot-7',
              slotDate: '2030-06-01T14:00:00.000Z',
              doctorName: 'Dra. Ruiz',
              epsDelCupo: 'eps-1',
              vencioIso: expect.any(String),
            },
          },
        },
      });
      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('createdAt');
      const aviso = chatbot.sendOutboundMessage.mock.calls[0][1];
      expect(aviso).toContain('pasó a la siguiente persona');
      expect(aviso).toContain(
        'sigue en la *lista de espera*, en su mismo puesto',
      );
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: '573009998877' }),
      );
    });

    it('🙋 la segunda seguida sin contestar: sale de la lista y se le dice cómo volver', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        entrada({
          status: 'NOTIFIED',
          metadata: {
            sinRespuesta: 1,
            pendingSlotId: 'slot-7',
            doctorName: 'Dra. Ruiz',
            slotDate: '2030-06-01T14:00:00.000Z',
          },
        }),
      ]);

      await service.expireStaleNotifications();

      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      expect(data.status).toBe('EXPIRED');
      expect(data.metadata).toMatchObject({
        sinRespuesta: 2,
        ultimaOferta: { slotId: 'slot-7' },
      });
      expect(chatbot.sendOutboundMessage.mock.calls[0][1]).toContain(
        'dos ofertas seguidas',
      );
    });

    // 2026-11-02: Carol tomó el cupo desde el menú del chat y media hora después
    // recibió «el tiempo para confirmar el cupo expiró».
    it('📅 si ya consiguió cita por otro camino, sale de la lista sin el aviso de «expiró»', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-carol' });
      // El cupo que se le ofreció ya lo tomó ella: no se le ofrece a nadie más.
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        isAvailable: false,
        doctor: { whatsappBookingEnabled: true },
      });

      await service.expireStaleNotifications();

      expect(prisma.waitlistEntry.update).toHaveBeenCalledTimes(1);
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: {
          status: 'CANCELLED',
          metadata: { motivo: 'YA_TIENE_CITA', appointmentId: 'apt-carol' },
        },
      });
      expect(chatbot.sendOutboundMessage).not.toHaveBeenCalled();
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('si el cupo que se le ofreció ya no está libre, no se le ofrece al siguiente', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ id: 'w2', whatsappId: '573009998877' }),
      );
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        isAvailable: false,
        doctor: { whatsappBookingEnabled: true },
      });

      await service.expireStaleNotifications();

      // Sí se le avisa a ella que venció, pero el cupo no pasa a nadie.
      expect(chatbot.sendOutboundMessage).toHaveBeenCalledWith(
        '573001112233',
        expect.stringContaining('sigue en la *lista de espera*'),
        ORG,
      );
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('suelta el apartado del que no respondió: el siguiente lo recibe apartado', async () => {
      redis.store.set(`cupo_apartado:${ORG}:slot-7`, '573001112233');
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ id: 'w2', whatsappId: '573009998877' }),
      );
      await service.expireStaleNotifications();
      expect(redis.store.get(`cupo_apartado:${ORG}:slot-7`)).toBe(
        '573009998877',
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

    it('si el aviso al paciente falla, la entrada igual queda vencida y el cupo se reofrece', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([vencida]);
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada({ id: 'w2' }));
      chatbot.sendOutboundMessage.mockRejectedValue(new Error('Meta 401'));

      await expect(service.expireStaleNotifications()).resolves.toBeUndefined();

      expect(prisma.waitlistEntry.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'w1' },
        data: { status: 'WAITING' },
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

      expect(prisma.waitlistEntry.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'w1' },
        data: { status: 'WAITING' },
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

  // ────────────────────────────────────────────────────────────────
  // 2026-11-03: contestó después de vencer su oferta. Antes recibía el menú de
  // agendar, «agenda completa» y se volvía a anotar al final.
  describe('respuestaTardia', () => {
    const VENCIO = new Date(Date.now() - 40 * 60_000).toISOString();
    const conOfertaVencida = (over: Record<string, any> = {}) =>
      entrada({
        status: 'WAITING',
        updatedAt: new Date(VENCIO),
        metadata: {
          rechazados: ['slot-7'],
          sinRespuesta: 1,
          ultimaOferta: {
            slotId: 'slot-7',
            slotDate: '2030-06-01T14:00:00.000Z',
            doctorName: 'Dra. Ruiz',
            epsDelCupo: null,
            vencioIso: VENCIO,
          },
        },
        ...over,
      });
    const responder = (acepta: boolean) =>
      service.respuestaTardia({
        whatsappId: '573001112233',
        organizationId: ORG,
        acepta,
      });

    it('sin una oferta vencida reciente: null (sigue el camino de siempre)', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([entrada()]);
      await expect(responder(true)).resolves.toBeNull();
      expect(prisma.waitlistEntry.update).not.toHaveBeenCalled();
    });

    it('una vencida hace más de 24 h no cuenta', async () => {
      const viejo = new Date(Date.now() - 25 * 3_600_000).toISOString();
      prisma.waitlistEntry.findMany.mockResolvedValue([
        conOfertaVencida({
          metadata: {
            ultimaOferta: {
              slotId: 'slot-7',
              slotDate: '2030-06-01T14:00:00.000Z',
              doctorName: 'Dra. Ruiz',
              epsDelCupo: null,
              vencioIso: viejo,
            },
          },
        }),
      ]);
      await expect(responder(true)).resolves.toBeNull();
    });

    it('SÍ y el cupo sigue libre: es suyo (queda CONFIRMED con ese cupo, como un SÍ a tiempo)', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([conOfertaVencida()]);
      await expect(responder(true)).resolves.toEqual({
        tipo: 'TOMAR',
        slotId: 'slot-7',
        patientId: 'p1',
        epsId: 'eps-1',
      });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: {
          status: 'CONFIRMED',
          notifiedAt: expect.any(Date),
          metadata: {
            rechazados: ['slot-7'],
            pendingSlotId: 'slot-7',
            doctorName: 'Dra. Ruiz',
            slotDate: '2030-06-01T14:00:00.000Z',
            epsDelCupo: null,
          },
        },
      });
    });

    it('SÍ y el cupo ya está ofrecido a otro: sigue en la lista en su puesto (sin otro cupo libre)', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([conOfertaVencida()]);
      prisma.waitlistEntry.count.mockResolvedValue(1); // ofrecido a otra persona
      const r = await responder(true);
      expect(r).toEqual({
        tipo: 'SIN_CUPO',
        slotDate: new Date('2030-06-01T14:00:00.000Z'),
      });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { status: 'WAITING', metadata: { rechazados: ['slot-7'] } },
      });
    });

    it('SÍ, el cupo ya no está, pero hay otro libre: se le ofrece ya', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([conOfertaVencida()]);
      prisma.scheduleSlot.findFirst.mockImplementation(async (q: any) =>
        q.where.id === 'slot-7'
          ? { isAvailable: false, doctor: { whatsappBookingEnabled: true } }
          : { isAvailable: true, doctor: { whatsappBookingEnabled: true } },
      );
      appointments.getAvailableSlots.mockResolvedValue([{ slotId: 'slot-9' }]);
      prisma.scheduleSlot.findMany.mockResolvedValue([
        {
          id: 'slot-9',
          allowedEpsId: null,
          startTime: new Date('2030-06-02T14:00:00.000Z'),
          doctor: { fullName: 'Dr. Gómez' },
        },
      ]);

      await expect(responder(true)).resolves.toEqual({ tipo: 'OFRECIDO' });
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          whatsappId: '573001112233',
          slotId: 'slot-9',
          doctor: 'Dr. Gómez',
          via: 'TEXTO',
        }),
      );
    });

    it('si había salido de la lista (dos sin contestar), contestar la devuelve a su puesto', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([
        conOfertaVencida({ status: 'EXPIRED' }),
      ]);
      prisma.waitlistEntry.count.mockResolvedValue(1);
      await responder(true);
      const data = prisma.waitlistEntry.update.mock.calls[0][0].data;
      expect(data.status).toBe('WAITING');
      expect(data).not.toHaveProperty('createdAt');
    });

    it('si ya consiguió cita por otro camino: sale de la lista y no se le agenda otra (null)', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([conOfertaVencida()]);
      prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-nueva' });
      await expect(responder(true)).resolves.toBeNull();
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: {
          status: 'CANCELLED',
          metadata: { motivo: 'YA_TIENE_CITA', appointmentId: 'apt-nueva' },
        },
      });
    });

    it('NO tarde: sigue en la lista, sin ese cupo ni ese día', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([conOfertaVencida()]);
      await expect(responder(false)).resolves.toEqual({ tipo: 'RECHAZADO' });
      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: {
          status: 'WAITING',
          metadata: {
            rechazados: ['slot-7'],
            diasRechazados: ['2030-06-01'],
          },
        },
      });
    });

    it('busca solo entradas de esa persona en esa clínica, de las últimas 24 h', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([]);
      await responder(true);
      const where = prisma.waitlistEntry.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        whatsappId: '573001112233',
        organizationId: ORG,
        status: { in: ['WAITING', 'EXPIRED'] },
      });
      expect(where.updatedAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('minutosParaContestar', () => {
    // Martes 3-nov-2026 a las 10:00 p. m. en Bogotá: el mostrador ya cerró.
    const DE_NOCHE = new Date('2026-11-04T03:00:00.000Z');
    it.each([
      [1, 30],
      [11.9, 30],
      [12, 120],
      [72, 120],
    ])('de noche, cupo en %d h → %d minutos', (horas, minutos) => {
      expect(
        minutosParaContestar(
          new Date(DE_NOCHE.getTime() + horas * 3_600_000),
          DE_NOCHE,
        ),
      ).toBe(minutos);
    });

    // 2026-11-10: con el mostrador trabajando, el cupo apartado 2 horas lo llenaba
    // el hospital (16 de 21 en MD09) y el chat no lo veía.
    it.each([
      ['martes 10-nov a las 7:52 a. m.', '2026-11-10T12:52:00.000Z'],
      ['un sábado a las 9:00 a. m.', '2026-11-07T14:00:00.000Z'],
      ['a las 4:59 p. m.', '2026-11-10T21:59:00.000Z'],
    ])('con el mostrador abierto (%s), siempre 30 minutos', (_n, iso) => {
      const ahora = new Date(iso);
      expect(
        minutosParaContestar(new Date(ahora.getTime() + 26 * 3_600_000), ahora),
      ).toBe(30);
    });

    it.each([
      ['antes de las 7:00 a. m.', '2026-11-10T11:30:00.000Z'],
      ['desde las 5:00 p. m.', '2026-11-10T22:00:00.000Z'],
      ['un domingo al mediodía', '2026-11-08T17:00:00.000Z'],
      ['un festivo (lunes 16-nov) al mediodía', '2026-11-16T17:00:00.000Z'],
    ])('con el mostrador cerrado (%s), 2 horas a un cupo lejano', (_n, iso) => {
      const ahora = new Date(iso);
      expect(
        minutosParaContestar(new Date(ahora.getTime() + 26 * 3_600_000), ahora),
      ).toBe(120);
    });

    it('usa la hora de la clínica (otra zona, otro horario)', () => {
      // 7:52 a. m. en Bogotá son las 12:52 en UTC: en Londres, el mostrador abre.
      const ahora = new Date('2026-11-10T12:52:00.000Z');
      const cupo = new Date(ahora.getTime() + 26 * 3_600_000);
      expect(minutosParaContestar(cupo, ahora, 'America/Bogota')).toBe(30);
      // En Tokio son las 9:52 p. m.: cerrado.
      expect(minutosParaContestar(cupo, ahora, 'Asia/Tokyo')).toBe(120);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 2026-11-03: dijo SÍ y el cupo ya no estaba → se le ofrece otro libre ya.
  describe('ofrecerOtroCupo', () => {
    const libre = {
      id: 'slot-9',
      allowedEpsId: null,
      startTime: new Date('2030-06-02T14:00:00.000Z'),
      doctor: { fullName: 'Dr. Gómez' },
    };

    it('con otro cupo libre: se lo ofrece, con el texto de antes', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(
        entrada({ metadata: { rechazados: ['slot-7'] } }),
      );
      appointments.getAvailableSlots.mockResolvedValue([
        { slotId: 'slot-7' },
        { slotId: 'slot-9' },
      ]);
      prisma.scheduleSlot.findMany.mockResolvedValue([
        { ...libre, id: 'slot-7' },
        libre,
      ]);

      await expect(
        service.ofrecerOtroCupo({
          whatsappId: '573001112233',
          organizationId: ORG,
          intro: 'Ese ya no está, pero tengo otro:',
        }),
      ).resolves.toBe(true);

      // El que no se pudo tomar (rechazados) no se le vuelve a ofrecer.
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledTimes(1);
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          slotId: 'slot-9',
          via: 'TEXTO',
          intro: 'Ese ya no está, pero tengo otro:',
        }),
      );
      expect(prisma.waitlistEntry.findFirst.mock.calls[0][0].where).toEqual({
        whatsappId: '573001112233',
        organizationId: ORG,
        status: 'WAITING',
      });
    });

    // 2026-11-05: a una persona se le ofreció como reemplazo un cupo con 5 minutos
    // de creado; los recién aparecidos esperan 10, como en el barrido.
    it('solo cupos que llevan 10 minutos o más en la agenda', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada({}));
      appointments.getAvailableSlots.mockResolvedValue([{ slotId: 'slot-9' }]);
      prisma.scheduleSlot.findMany.mockResolvedValue([]);
      const antes = Date.now();

      await expect(
        service.ofrecerOtroCupo({ whatsappId: 'x', organizationId: ORG }),
      ).resolves.toBe(false);

      const where = prisma.scheduleSlot.findMany.mock.calls[0][0].where;
      const tope = where.createdAt.lte.getTime();
      expect(tope).toBeLessThanOrEqual(Date.now() - 10 * 60_000);
      expect(tope).toBeGreaterThanOrEqual(antes - 10 * 60_000);
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('sin otro cupo libre, o sin entrada en la lista: false', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      await expect(
        service.ofrecerOtroCupo({ whatsappId: 'x', organizationId: ORG }),
      ).resolves.toBe(false);
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.ofrecerOtroCupo({ whatsappId: 'x', organizationId: ORG }),
      ).resolves.toBe(false);
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
    });

    it('si algo falla: false (se le dice que sigue en la lista)', async () => {
      prisma.waitlistEntry.findFirst.mockRejectedValue(new Error('caída'));
      await expect(
        service.ofrecerOtroCupo({ whatsappId: 'x', organizationId: ORG }),
      ).resolves.toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 2026-11-03: el hospital anuló las citas del miércoles de un médico y le quitó
  // el turno; los cupos se ofrecieron antes de que la agenda los cerrara.
  describe('cupoLiberadoPorElHospital', () => {
    let programado: (() => void) | null;
    let espera: number | null;
    beforeEach(() => {
      programado = null;
      espera = null;
      jest
        .spyOn(service as any, 'programar')
        .mockImplementation((fn: any, ms: any) => {
          programado = fn;
          espera = ms;
        });
    });
    const despuesDeLaEspera = async () => {
      programado!();
      // Deja correr la oferta que dispara el temporizador.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    };

    it('no se ofrece enseguida: el cupo queda apartado 10 minutos (el chat tampoco lo muestra)', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      await service.cupoLiberadoPorElHospital({
        organizationId: ORG,
        slotId: 'slot-1',
      });
      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
      expect(espera).toBe(10 * 60_000);
      expect(redis.store.get(`cupo_apartado:${ORG}:slot-1`)).toMatch(
        /^HOSPITAL:/,
      );
      // Mientras tanto, ni la lista lo ofrece.
      await expect(
        service.notifyWaitlist({
          slotId: 'slot-1',
          serviceId: 'svc-1',
          epsId: null,
          organizationId: ORG,
          doctorName: 'Dra. Ruiz',
          slotDate: new Date('2030-06-01T14:00:00Z'),
        }),
      ).resolves.toBe(false);
    });

    it('pasada la espera, si sigue libre: suelta el apartado y lo ofrece a la lista', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      await service.cupoLiberadoPorElHospital({
        organizationId: ORG,
        slotId: 'slot-1',
      });
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        id: 'slot-1',
        serviceId: 'svc-1',
        allowedEpsId: null,
        isAvailable: true,
        startTime: new Date('2030-06-01T14:00:00Z'),
        doctor: { fullName: 'Dra. Ruiz', whatsappBookingEnabled: true },
      });

      await despuesDeLaEspera();

      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ slotId: 'slot-1' }),
      );
      // Queda apartado, ahora para quien lo recibió.
      expect(redis.store.get(`cupo_apartado:${ORG}:slot-1`)).toBe(
        '573001112233',
      );
    });

    it('pasada la espera, si la agenda lo cerró (el hospital quitó el día): no lo ofrece', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(entrada());
      await service.cupoLiberadoPorElHospital({
        organizationId: ORG,
        slotId: 'slot-1',
      });
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        id: 'slot-1',
        isAvailable: false,
        doctor: { fullName: 'Dra. Ruiz', whatsappBookingEnabled: true },
      });

      await despuesDeLaEspera();

      expect(chatbot.notifyWaitlistCandidate).not.toHaveBeenCalled();
      expect(redis.store.has(`cupo_apartado:${ORG}:slot-1`)).toBe(false);
    });

    it('si el cupo ya lo tenía apartado alguien del chat, no se lo quita', async () => {
      redis.store.set(`cupo_apartado:${ORG}:slot-1`, '573005550000');
      redis.set.mockImplementationOnce(async () => null); // NX: ya existía
      await service.cupoLiberadoPorElHospital({
        organizationId: ORG,
        slotId: 'slot-1',
      });
      expect(redis.store.get(`cupo_apartado:${ORG}:slot-1`)).toBe(
        '573005550000',
      );
    });
  });
});
