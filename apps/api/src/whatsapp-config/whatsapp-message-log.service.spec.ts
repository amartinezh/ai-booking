import { Prisma } from '@agenia/database';
import {
  WhatsappMessageLogService,
  extractWamid,
} from './whatsapp-message-log.service';

describe('extractWamid', () => {
  it('lee messages[0].id de la respuesta de la Cloud API', () => {
    expect(
      extractWamid({
        messaging_product: 'whatsapp',
        contacts: [{ input: '573001112233', wa_id: '573001112233' }],
        messages: [{ id: 'wamid.ABC' }],
      }),
    ).toBe('wamid.ABC');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['una cadena', 'wamid.ABC'],
    ['sin messages', { contacts: [] }],
    ['messages vacío', { messages: [] }],
    ['messages[0] sin id', { messages: [{}] }],
    ['id que no es texto', { messages: [{ id: 42 }] }],
    ['id vacío', { messages: [{ id: '' }] }],
  ])('devuelve null si la respuesta es %s', (_nombre, respuesta) => {
    expect(extractWamid(respuesta)).toBeNull();
  });
});

describe('WhatsappMessageLogService', () => {
  const ORG = 'org-1';
  const WAMID = 'wamid.ABC';

  const build = () => {
    const prisma = {
      whatsappMessageLog: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new WhatsappMessageLogService(prisma as never);
    return { service, prisma };
  };

  describe('recordOutbound', () => {
    it('registra el mensaje con el wamid de Meta, la org y el destinatario', async () => {
      const { service, prisma } = build();

      await service.recordOutbound({
        organizationId: ORG,
        recipientId: '573001112233',
        messageType: 'TEXT',
        metaResponse: { messages: [{ id: WAMID }] },
      });

      expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith({
        data: {
          wamid: WAMID,
          organizationId: ORG,
          recipientId: '573001112233',
          messageType: 'TEXT',
          kind: 'BOT_REPLY',
          appointmentId: null,
        },
      });
    });

    it('sin contexto es BOT_REPLY; con contexto guarda el tipo y la cita', async () => {
      const { service, prisma } = build();

      await service.recordOutbound({
        organizationId: ORG,
        recipientId: 'CO.13491208655302741918',
        messageType: 'TEMPLATE',
        metaResponse: { messages: [{ id: WAMID }] },
        context: { kind: 'APPOINTMENT_REMINDER', appointmentId: 'apt-9' },
      });

      expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'APPOINTMENT_REMINDER',
          appointmentId: 'apt-9',
          messageType: 'TEMPLATE',
        }),
      });
    });

    it('sin wamid en la respuesta no escribe nada (y no lanza)', async () => {
      const { service, prisma } = build();

      await expect(
        service.recordOutbound({
          organizationId: ORG,
          recipientId: '573001112233',
          messageType: 'TEXT',
          metaResponse: { messages: [] },
        }),
      ).resolves.toBeUndefined();

      expect(prisma.whatsappMessageLog.create).not.toHaveBeenCalled();
    });

    it('🛡️ NUNCA lanza: si la base falla, el mensaje ya salió y el flujo sigue', async () => {
      const { service, prisma } = build();
      prisma.whatsappMessageLog.create.mockRejectedValue(new Error('db caída'));

      await expect(
        service.recordOutbound({
          organizationId: ORG,
          recipientId: '573001112233',
          messageType: 'TEXT',
          metaResponse: { messages: [{ id: WAMID }] },
        }),
      ).resolves.toBeUndefined();
    });

    it('un wamid duplicado (P2002) se absorbe en silencio', async () => {
      const { service, prisma } = build();
      prisma.whatsappMessageLog.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.recordOutbound({
          organizationId: ORG,
          recipientId: '573001112233',
          messageType: 'TEXT',
          metaResponse: { messages: [{ id: WAMID }] },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('applyStatus', () => {
    it.each([
      ['sent', 'SENT', ['ACCEPTED']],
      ['delivered', 'DELIVERED', ['ACCEPTED', 'SENT']],
      ['read', 'READ', ['ACCEPTED', 'SENT', 'DELIVERED']],
    ])(
      "'%s' → %s, y solo desde estados anteriores",
      async (metaStatus, esperado, desde) => {
        const { service, prisma } = build();

        const cambio = await service.applyStatus({
          id: WAMID,
          status: metaStatus,
          timestamp: '1789900000',
        });

        expect(cambio).toBe(true);
        expect(prisma.whatsappMessageLog.updateMany).toHaveBeenCalledWith({
          where: { wamid: WAMID, status: { in: desde } },
          data: expect.objectContaining({
            status: esperado,
            statusAt: new Date(1789900000 * 1000),
          }),
        });
      },
    );

    it('🚨 un estado atrasado no pisa uno más avanzado: la condición lo excluye', async () => {
      const { service, prisma } = build();
      // El mensaje ya está READ: un `sent` tardío llega y no encuentra fila.
      prisma.whatsappMessageLog.updateMany.mockResolvedValue({ count: 0 });

      const cambio = await service.applyStatus({ id: WAMID, status: 'sent' });

      expect(cambio).toBe(false);
      // Lo que garantiza que no pise: el WHERE solo admite ACCEPTED.
      expect(prisma.whatsappMessageLog.updateMany).toHaveBeenCalledWith({
        where: { wamid: WAMID, status: { in: ['ACCEPTED'] } },
        data: expect.anything(),
      });
    });

    it('failed guarda código y detalle del error de Meta, y solo pisa antes de la entrega', async () => {
      const { service, prisma } = build();

      await service.applyStatus({
        id: WAMID,
        status: 'failed',
        timestamp: '1789900000',
        errors: [
          {
            code: 131047,
            title: 'Re-engagement message',
            error_data: { details: 'Han pasado más de 24 horas' },
          },
        ],
      });

      expect(prisma.whatsappMessageLog.updateMany).toHaveBeenCalledWith({
        where: { wamid: WAMID, status: { in: ['ACCEPTED', 'SENT'] } },
        data: expect.objectContaining({
          status: 'FAILED',
          errorCode: '131047',
          errorDetail: 'Han pasado más de 24 horas',
        }),
      });
    });

    it('trunca el detalle del error', async () => {
      const { service, prisma } = build();

      await service.applyStatus({
        id: WAMID,
        status: 'failed',
        errors: [{ code: 1, message: 'x'.repeat(2000) }],
      });

      const data = (
        prisma.whatsappMessageLog.updateMany.mock.calls[0] as [
          { data: { errorDetail: string } },
        ]
      )[0].data;
      expect(data.errorDetail).toHaveLength(500);
    });

    it('un estado que no es de entrega (deleted, warning…) se ignora sin tocar la base', async () => {
      const { service, prisma } = build();

      expect(await service.applyStatus({ id: WAMID, status: 'deleted' })).toBe(
        false,
      );
      expect(prisma.whatsappMessageLog.updateMany).not.toHaveBeenCalled();
    });

    it('sin id o sin estado no hace nada', async () => {
      const { service, prisma } = build();

      expect(await service.applyStatus({ status: 'sent' })).toBe(false);
      expect(await service.applyStatus({ id: WAMID })).toBe(false);
      expect(prisma.whatsappMessageLog.updateMany).not.toHaveBeenCalled();
    });

    it('un wamid desconocido no crea filas: solo actualiza', async () => {
      const { service, prisma } = build();
      prisma.whatsappMessageLog.updateMany.mockResolvedValue({ count: 0 });

      expect(
        await service.applyStatus({ id: 'wamid.FALSO', status: 'read' }),
      ).toBe(false);
      expect(prisma.whatsappMessageLog.create).not.toHaveBeenCalled();
    });

    it('un timestamp inválido cae a "ahora" en vez de guardar una fecha rota', async () => {
      const { service, prisma } = build();
      const antes = Date.now();

      await service.applyStatus({
        id: WAMID,
        status: 'sent',
        timestamp: 'abc',
      });

      const data = (
        prisma.whatsappMessageLog.updateMany.mock.calls[0] as [
          { data: { statusAt: Date } },
        ]
      )[0].data;
      expect(data.statusAt.getTime()).toBeGreaterThanOrEqual(antes);
    });

    it('🛡️ NUNCA lanza: un fallo de la base devuelve false', async () => {
      const { service, prisma } = build();
      prisma.whatsappMessageLog.updateMany.mockRejectedValue(
        new Error('caída'),
      );

      await expect(
        service.applyStatus({ id: WAMID, status: 'delivered' }),
      ).resolves.toBe(false);
    });
  });
});
