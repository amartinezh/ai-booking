import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
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

    chatbotService = {
      processIncomingMessage: jest.fn(),
      sendOutboundMessage: jest.fn(async () => ({ success: true })),
    };
    credentials = {
      organizationIdByVerifyToken: jest.fn(async () => null),
      appSecretByPhoneNumberId: jest.fn(async () => null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatbotController],
      providers: [
        { provide: ChatbotService, useValue: chatbotService },
        { provide: WhatsappCredentialsService, useValue: credentials },
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
    it('sin App Secret configurado → acepta el evento (retrocompatibilidad)', async () => {
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
