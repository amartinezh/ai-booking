import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { InboundQueueService } from './inbound-queue.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';

describe('ChatbotController', () => {
  let controller: ChatbotController;
  let chatbotService: {
    processIncomingMessage: jest.Mock;
    sendOutboundMessage: jest.Mock;
  };
  let credentials: {
    organizationIdByVerifyToken: jest.Mock;
    appSecretByPhoneNumberId: jest.Mock;
  };
  // Cola de entrada fake: `admit` deduplica en memoria y `enqueue` ejecuta la
  // tarea de inmediato (síncrono) para poder afirmar que se procesó el mensaje.
  let inboundQueue: {
    admit: jest.Mock;
    releaseAdmission: jest.Mock;
    enqueue: jest.Mock;
    inFlight: number;
    seen: Set<string>;
  };

  const APP_SECRET = 'super-secreto-de-meta';

  const inboundBody = () => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '123456789012345' },
              messages: [{ from: '573001234567', text: { body: 'Hola' } }],
            },
          },
        ],
      },
    ],
  });

  const signedRequest = (body: any, secret?: string) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = secret
      ? 'sha256=' +
        crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
      : undefined;
    return { req: { rawBody } as any, signature };
  };

  beforeEach(async () => {
    delete process.env.META_APP_SECRET;
    delete process.env.META_REQUIRE_SIGNATURE;

    chatbotService = {
      processIncomingMessage: jest.fn(),
      sendOutboundMessage: jest.fn(() => ({ success: true })),
    };
    credentials = {
      organizationIdByVerifyToken: jest.fn(() => null),
      appSecretByPhoneNumberId: jest.fn(() => null),
    };
    inboundQueue = {
      seen: new Set<string>(),
      inFlight: 0,
      admit: jest.fn((wamid?: string) => {
        if (!wamid) return true;
        if (inboundQueue.seen.has(wamid)) return false;
        inboundQueue.seen.add(wamid);
        return true;
      }),
      releaseAdmission: jest.fn((wamid?: string) => {
        if (wamid) inboundQueue.seen.delete(wamid);
      }),
      enqueue: jest.fn((_senderId: string, task: () => Promise<void>) => {
        void task();
        return true;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatbotController],
      providers: [
        { provide: ChatbotService, useValue: chatbotService },
        { provide: WhatsappCredentialsService, useValue: credentials },
        { provide: InboundQueueService, useValue: inboundQueue },
      ],
    }).compile();

    controller = module.get<ChatbotController>(ChatbotController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ══════════════════════════════════════════════════════════════
  // 🔏 Verificación de firma X-Hub-Signature-256
  // ══════════════════════════════════════════════════════════════
  describe('firma del webhook', () => {
    it('sin App Secret configurado → RECHAZA por defecto (firma obligatoria)', async () => {
      const body = inboundBody();
      const { req } = signedRequest(body);

      await expect(
        controller.handleMessage(body, req, undefined),
      ).rejects.toThrow(ForbiddenException);
      expect(chatbotService.processIncomingMessage).not.toHaveBeenCalled();
    });

    it('sin App Secret + META_REQUIRE_SIGNATURE=false → acepta (modo migración)', async () => {
      process.env.META_REQUIRE_SIGNATURE = 'false';
      const body = inboundBody();
      const { req } = signedRequest(body);

      const result = await controller.handleMessage(body, req, undefined);

      expect(result).toBe('EVENT_RECEIVED');
      expect(chatbotService.processIncomingMessage).toHaveBeenCalled();
    });

    it('con App Secret de la clínica y firma válida → procesa el mensaje', async () => {
      credentials.appSecretByPhoneNumberId.mockResolvedValue(APP_SECRET);
      const body = inboundBody();
      const { req, signature } = signedRequest(body, APP_SECRET);

      const result = await controller.handleMessage(body, req, signature);

      expect(result).toBe('EVENT_RECEIVED');
      expect(credentials.appSecretByPhoneNumberId).toHaveBeenCalledWith(
        '123456789012345',
      );
      expect(chatbotService.processIncomingMessage).toHaveBeenCalled();
    });

    it('con App Secret y firma INVÁLIDA → 403 y NO procesa', async () => {
      credentials.appSecretByPhoneNumberId.mockResolvedValue(APP_SECRET);
      const body = inboundBody();
      const { req, signature } = signedRequest(body, 'otro-secreto-atacante');

      await expect(
        controller.handleMessage(body, req, signature),
      ).rejects.toThrow(ForbiddenException);
      expect(chatbotService.processIncomingMessage).not.toHaveBeenCalled();
    });

    it('con App Secret y SIN firma → 403 y NO procesa', async () => {
      credentials.appSecretByPhoneNumberId.mockResolvedValue(APP_SECRET);
      const body = inboundBody();
      const { req } = signedRequest(body);

      await expect(
        controller.handleMessage(body, req, undefined),
      ).rejects.toThrow(ForbiddenException);
      expect(chatbotService.processIncomingMessage).not.toHaveBeenCalled();
    });

    it('sin secreto de clínica pero con META_APP_SECRET del env → lo usa', async () => {
      process.env.META_APP_SECRET = APP_SECRET;
      const body = inboundBody();
      const { req, signature } = signedRequest(body, 'firma-incorrecta');

      await expect(
        controller.handleMessage(body, req, signature),
      ).rejects.toThrow(ForbiddenException);
      expect(chatbotService.processIncomingMessage).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 📦 Batching, deduplicación y backpressure de la cola de entrada
  // ══════════════════════════════════════════════════════════════
  describe('cola de entrada', () => {
    beforeEach(() => {
      // Aislamos estas pruebas de la firma (probada aparte).
      process.env.META_REQUIRE_SIGNATURE = 'false';
    });

    const msg = (id: string, from: string, body: string) => ({
      id,
      from,
      text: { body },
    });

    it('procesa TODOS los mensajes/cambios/entries agrupados (#1)', async () => {
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'p1' },
                  messages: [
                    msg('w1', '573001', 'Hola'),
                    msg('w2', '573002', 'Buenas'),
                  ],
                },
              },
              {
                value: {
                  metadata: { phone_number_id: 'p1' },
                  messages: [msg('w3', '573003', 'Cita')],
                },
              },
            ],
          },
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'p2' },
                  messages: [msg('w4', '573004', 'Agendar')],
                },
              },
            ],
          },
        ],
      };
      const { req } = signedRequest(body);

      await controller.handleMessage(body, req, undefined);

      expect(chatbotService.processIncomingMessage).toHaveBeenCalledTimes(4);
      // La metadata del `value` se inyecta en cada mensaje para enrutar tenant.
      const firstArg = chatbotService.processIncomingMessage.mock.calls[0][0];
      expect(firstArg.metadata).toEqual({ phone_number_id: 'p1' });
    });

    it('descarta reentregas con el mismo wamid (#2)', async () => {
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'p1' },
                  messages: [msg('dup-1', '573001', 'Hola')],
                },
              },
            ],
          },
        ],
      };
      const { req } = signedRequest(body);

      await controller.handleMessage(body, req, undefined);
      await controller.handleMessage(body, req, undefined); // reentrega

      expect(chatbotService.processIncomingMessage).toHaveBeenCalledTimes(1);
    });

    it('backpressure: si la cola rechaza, revierte el dedup para no perder el mensaje (#6)', async () => {
      inboundQueue.enqueue.mockReturnValueOnce(false); // cola llena una vez
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'p1' },
                  messages: [msg('bp-1', '573001', 'Hola')],
                },
              },
            ],
          },
        ],
      };
      const { req } = signedRequest(body);

      await controller.handleMessage(body, req, undefined);
      expect(inboundQueue.releaseAdmission).toHaveBeenCalledWith('bp-1');

      // El reintento de Meta ahora SÍ se procesa (no quedó marcado como dup).
      await controller.handleMessage(body, req, undefined);
      expect(chatbotService.processIncomingMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 🏢 Outbound con tenant del token
  // ══════════════════════════════════════════════════════════════
  describe('outbound', () => {
    it('envía por la clínica del token (organizationId explícito)', async () => {
      const result = await controller.sendOutboundMessage(
        { to: '573001234567', message: 'Recordatorio' },
        'org-1',
      );

      expect(result).toEqual({ success: true });
      expect(chatbotService.sendOutboundMessage).toHaveBeenCalledWith(
        '573001234567',
        'Recordatorio',
        'org-1',
      );
    });

    it('rechaza cuerpos incompletos', async () => {
      await expect(
        controller.sendOutboundMessage({ to: '', message: 'x' }, 'org-1'),
      ).rejects.toThrow('Faltan parámetros (to, message)');
      expect(chatbotService.sendOutboundMessage).not.toHaveBeenCalled();
    });
  });
});
