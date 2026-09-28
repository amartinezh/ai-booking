import { Logger } from '@nestjs/common';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TELEGRAM_UNSUPPORTED_REPLY } from './telegram-inbound.adapter';
import type { TelegramConfigService } from './telegram-config.service';
import type { TelegramSenderService } from './telegram-sender.service';
import type { InboundQueueService } from '../chatbot/inbound-queue.service';
import type { ChatbotService } from '../chatbot/chatbot.service';
import type { TelegramUpdate } from './telegram.types';

/**
 * Webhook de Telegram (T1). Lo que no puede fallar:
 *  1. Sin el secreto de ESA clínica, nada llega al bot (401).
 *  2. Canal apagado → 200 y silencio.
 *  3. Duplicados descartados; cola llena → 503 para que Telegram reintente.
 *  4. Cada chat se serializa por `tg:<chat_id>` en la cola compartida.
 */
describe('TelegramWebhookController', () => {
  const ORG = 'org-1';
  const ROUTE = 'ruta-abc';
  const SECRET = 'secreto-de-la-clinica';

  let config: { forRouteKey: jest.Mock };
  let sender: { sendText: jest.Mock };
  let queue: {
    admit: jest.Mock;
    enqueue: jest.Mock;
    releaseAdmission: jest.Mock;
    inFlight: number;
  };
  let chatbot: { processIncomingMessage: jest.Mock };
  let controller: TelegramWebhookController;
  let tasks: Array<() => Promise<void>>;

  const texto = (text = 'Hola', updateId = 10): TelegramUpdate => ({
    update_id: updateId,
    message: {
      message_id: 1,
      from: { id: 777, is_bot: false },
      chat: { id: 777, type: 'private' },
      text,
    },
  });

  beforeEach(() => {
    for (const l of ['log', 'warn', 'debug'] as const) {
      jest.spyOn(Logger.prototype, l).mockImplementation();
    }
    tasks = [];
    config = {
      forRouteKey: jest.fn(async (rk: string) =>
        rk === ROUTE
          ? {
              organizationId: ORG,
              botToken: '1:tok',
              webhookSecret: SECRET,
              isActive: true,
            }
          : null,
      ),
    };
    sender = { sendText: jest.fn(async () => ({ ok: true })) };
    queue = {
      admit: jest.fn(async () => true),
      enqueue: jest.fn((_: string, task: () => Promise<void>) => {
        tasks.push(task);
        return true;
      }),
      releaseAdmission: jest.fn(async () => undefined),
      inFlight: 0,
    };
    chatbot = { processIncomingMessage: jest.fn(async () => undefined) };
    controller = new TelegramWebhookController(
      config as unknown as TelegramConfigService,
      sender as unknown as TelegramSenderService,
      queue as unknown as InboundQueueService,
      chatbot as unknown as ChatbotService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('autenticación', () => {
    it.each([
      ['sin header', undefined],
      ['secreto de otra clínica', 'secreto-de-otra'],
      ['secreto con distinta longitud', 'x'],
      ['vacío', ''],
    ])('%s → 401 y nada llega al bot', async (_, header) => {
      await expect(
        controller.handleUpdate(ROUTE, texto(), header),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(queue.admit).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('ruta desconocida → 401 (no se revela si existe)', async () => {
      await expect(
        controller.handleUpdate('otra-ruta', texto(), SECRET),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('canal inactivo → 200 sin procesar', async () => {
    config.forRouteKey.mockResolvedValue({
      organizationId: ORG,
      botToken: '1:tok',
      webhookSecret: SECRET,
      isActive: false,
    });
    await expect(
      controller.handleUpdate(ROUTE, texto(), SECRET),
    ).resolves.toEqual({
      ok: true,
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('texto → deduplica, encola por tg:<chat_id> y lo entrega al bot', async () => {
    await expect(
      controller.handleUpdate(ROUTE, texto(), SECRET),
    ).resolves.toEqual({
      ok: true,
    });
    expect(queue.admit).toHaveBeenCalledWith('tg:ruta-abc:10');
    expect(queue.enqueue).toHaveBeenCalledWith('tg:777', expect.any(Function));
    expect(chatbot.processIncomingMessage).not.toHaveBeenCalled(); // asíncrono

    await tasks[0]();
    const event = chatbot.processIncomingMessage.mock.calls[0][0];
    expect(event).toMatchObject({
      channel: 'telegram',
      type: 'text',
      text: { body: 'Hola' },
      telegram: { organizationId: ORG, chatId: '777', senderId: 'tg:777' },
    });
  });

  it('duplicado → 200 sin encolar', async () => {
    queue.admit.mockResolvedValue(false);
    await expect(
      controller.handleUpdate(ROUTE, texto(), SECRET),
    ).resolves.toEqual({
      ok: true,
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('cola llena → libera el dedup y responde 503 (Telegram reintenta)', async () => {
    queue.enqueue.mockReturnValue(false);
    await expect(
      controller.handleUpdate(ROUTE, texto(), SECRET),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(queue.releaseAdmission).toHaveBeenCalledWith('tg:ruta-abc:10');
  });

  it('ignorado (grupo) → 200 sin tocar la cola', async () => {
    const grupo: TelegramUpdate = {
      update_id: 11,
      message: { chat: { id: -100, type: 'group' }, text: 'hola' },
    };
    await expect(
      controller.handleUpdate(ROUTE, grupo, SECRET),
    ).resolves.toEqual({
      ok: true,
    });
    expect(queue.admit).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('una foto → aviso amable por la cola del mismo chat, sin pasar por el bot', async () => {
    const foto: TelegramUpdate = {
      update_id: 12,
      message: {
        message_id: 2,
        from: { id: 777 },
        chat: { id: 777, type: 'private' },
        photo: [{}],
      },
    };
    await controller.handleUpdate(ROUTE, foto, SECRET);
    expect(queue.enqueue).toHaveBeenCalledWith('tg:777', expect.any(Function));
    await tasks[0]();
    expect(sender.sendText).toHaveBeenCalledWith(
      ORG,
      '777',
      TELEGRAM_UNSUPPORTED_REPLY,
    );
    expect(chatbot.processIncomingMessage).not.toHaveBeenCalled();
  });

  it('la foto duplicada tampoco se contesta dos veces', async () => {
    queue.admit.mockResolvedValue(false);
    await controller.handleUpdate(
      ROUTE,
      {
        update_id: 12,
        message: { chat: { id: 777, type: 'private' }, photo: [] },
      },
      SECRET,
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
