import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';

describe('ChatbotController', () => {
  let controller: ChatbotController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatbotController],
      providers: [
        {
          provide: ChatbotService,
          useValue: { processIncomingMessage: jest.fn() },
        },
        {
          provide: WhatsappCredentialsService,
          useValue: { resolveForOrg: jest.fn(), verifyWebhook: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<ChatbotController>(ChatbotController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
