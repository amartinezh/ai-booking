import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WaitlistService } from './waitlist.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from '../chatbot/chatbot.service';

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
  };
  let chatbot: {
    notifyWaitlistCandidate: jest.Mock;
    sendOutboundMessage: jest.Mock;
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
    };
    chatbot = {
      notifyWaitlistCandidate: jest.fn().mockResolvedValue(undefined),
      sendOutboundMessage: jest.fn().mockResolvedValue({ success: true }),
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

    it('la posición cuenta solo a los de delante: mismo servicio, EPS compatible y más antiguos', async () => {
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
          OR: [{ epsId: null }, { epsId: 'eps-1' }],
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
      slotDate: new Date('2026-06-01T14:00:00Z'),
    };

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
        slotDate: '2026-06-01T14:00:00.000Z',
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

      expect(r).toEqual({ slotId: 'slot-7', patientId: 'p1' });
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
          slotDate: '2026-06-01T14:00:00.000Z',
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

      expect(r).toEqual({ slotId: null, patientId: null });
      expect(prisma.waitlistEntry.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'w1' },
        data: { status: 'CANCELLED' },
      });
      expect(chatbot.notifyWaitlistCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappId: segundo.whatsappId }),
      );
    });

    it('sin ninguna notificación viva devuelve vacío y no escribe nada', async () => {
      prisma.waitlistEntry.findFirst.mockResolvedValue(null);

      const r = await service.confirmFromWaitlist({
        whatsappId: 'x',
        organizationId: ORG,
        confirmed: true,
      });

      expect(r).toEqual({ slotId: null, patientId: null });
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
        slotDate: '2026-06-01T14:00:00.000Z',
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

    it('solo recoge las NOTIFIED cuyo plazo ya venció', async () => {
      prisma.waitlistEntry.findMany.mockResolvedValue([]);
      await service.expireStaleNotifications();
      const where = prisma.waitlistEntry.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('NOTIFIED');
      expect(where.expiresAt.lt).toBeInstanceOf(Date);
    });
  });
});
