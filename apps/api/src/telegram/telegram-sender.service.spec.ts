import { Logger } from '@nestjs/common';
import { TelegramSenderService } from './telegram-sender.service';
import type { TelegramApiClient } from './telegram-api.client';
import type { TelegramConfigService } from './telegram-config.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Envío por Telegram. Como `sendWhatsAppMessage`: nunca lanza y cada envío
 * queda en el libro (T6). Además: 403 marca el bloqueo (T4) y 401 apaga el
 * canal.
 */
describe('TelegramSenderService', () => {
  const ORG = 'org-1';
  const CHAT = '3001112233';
  const TOKEN = '1:tok';

  let prisma: {
    telegramMessageLog: { create: jest.Mock };
    patientProfile: { updateMany: jest.Mock };
  };
  let api: { sendMessage: jest.Mock; sendVoice: jest.Mock };
  let config: { forOrg: jest.Mock; markTokenRevoked: jest.Mock };
  let sender: TelegramSenderService;

  const logged = () =>
    prisma.telegramMessageLog.create.mock.calls.map((c) => c[0].data);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma = {
      telegramMessageLog: { create: jest.fn(async () => ({})) },
      patientProfile: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    let n = 100;
    api = {
      sendMessage: jest.fn(async () => ({
        ok: true,
        result: { message_id: ++n },
      })),
      sendVoice: jest.fn(async () => ({
        ok: true,
        result: { message_id: 50 },
      })),
    };
    config = {
      forOrg: jest.fn(async () => ({
        organizationId: ORG,
        botToken: TOKEN,
        botId: '1',
        isActive: true,
      })),
      markTokenRevoked: jest.fn(async () => undefined),
    };
    sender = new TelegramSenderService(
      prisma as unknown as PrismaService,
      api as unknown as TelegramApiClient,
      config as unknown as TelegramConfigService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('envía el texto y lo registra como ACCEPTED', async () => {
    const res = await sender.sendText(ORG, CHAT, 'Hola', {
      kind: 'BOOKING_CONFIRMATION',
      appointmentId: 'apt-1',
    });
    expect(api.sendMessage).toHaveBeenCalledWith(TOKEN, CHAT, 'Hola', {
      html: true,
    });
    expect(res).toEqual({
      ok: true,
      messageId: 101,
      errorCode: null,
      blocked: false,
    });
    expect(logged()).toEqual([
      {
        organizationId: ORG,
        chatId: CHAT,
        messageId: 101,
        messageType: 'TEXT',
        kind: 'BOOKING_CONFIRMATION',
        appointmentId: 'apt-1',
        status: 'ACCEPTED',
        errorCode: null,
        errorDetail: null,
      },
    ]);
  });

  it('sin contexto se registra como respuesta del bot', async () => {
    await sender.sendText(ORG, CHAT, 'Hola');
    expect(logged()[0]).toMatchObject({
      kind: 'BOT_REPLY',
      appointmentId: null,
    });
  });

  it('un texto largo sale en varios mensajes, cada uno registrado', async () => {
    const res = await sender.sendText(ORG, CHAT, 'línea\n'.repeat(1500));
    expect(api.sendMessage.mock.calls.length).toBeGreaterThan(1);
    expect(logged()).toHaveLength(api.sendMessage.mock.calls.length);
    expect(res.messageId).toBe(100 + api.sendMessage.mock.calls.length);
  });

  it('si un trozo falla, no se mandan los siguientes', async () => {
    api.sendMessage
      .mockResolvedValueOnce({ ok: true, result: { message_id: 1 } })
      .mockResolvedValueOnce({ ok: false, errorCode: 400, description: 'x' });
    const res = await sender.sendText(ORG, CHAT, 'línea\n'.repeat(2500));
    expect(res.ok).toBe(false);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('403: marca el bloqueo en la ficha de ESA clínica', async () => {
    api.sendMessage.mockResolvedValue({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    const res = await sender.sendText(ORG, CHAT, 'Hola');
    expect(res).toEqual({
      ok: false,
      messageId: null,
      errorCode: 403,
      blocked: true,
    });
    expect(prisma.patientProfile.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, telegramChatId: CHAT },
      data: { telegramBlockedAt: expect.any(Date) },
    });
    expect(logged()[0]).toMatchObject({
      status: 'FAILED',
      errorCode: '403',
      errorDetail: 'Forbidden: bot was blocked by the user',
    });
  });

  it('401: apaga el canal', async () => {
    api.sendMessage.mockResolvedValue({
      ok: false,
      errorCode: 401,
      description: 'Unauthorized',
    });
    const res = await sender.sendText(ORG, CHAT, 'Hola');
    expect(res.blocked).toBe(false);
    expect(config.markTokenRevoked).toHaveBeenCalledWith(ORG);
    expect(prisma.patientProfile.updateMany).not.toHaveBeenCalled();
  });

  it('fallo de red: FAILED con código NETWORK', async () => {
    api.sendMessage.mockResolvedValue({
      ok: false,
      errorCode: null,
      description: 'timeout',
    });
    await sender.sendText(ORG, CHAT, 'Hola');
    expect(logged()[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'NETWORK',
    });
  });

  it.each([
    ['sin configurar', null, 'Canal sin configurar'],
    [
      'inactivo',
      { organizationId: ORG, botToken: TOKEN, botId: '1', isActive: false },
      'Canal inactivo',
    ],
  ])(
    'canal %s: no llama a Telegram y lo registra',
    async (_, creds, detail) => {
      config.forOrg.mockResolvedValue(creds);
      const res = await sender.sendText(ORG, CHAT, 'Hola');
      expect(res.ok).toBe(false);
      expect(api.sendMessage).not.toHaveBeenCalled();
      expect(logged()[0]).toMatchObject({
        status: 'FAILED',
        errorCode: 'CHANNEL_INACTIVE',
        errorDetail: detail,
      });
    },
  );

  it('si leer las credenciales falla, no lanza', async () => {
    config.forOrg.mockRejectedValue(new Error('db caída'));
    await expect(sender.sendText(ORG, CHAT, 'Hola')).resolves.toMatchObject({
      ok: false,
    });
  });

  it('si el libro falla, el envío igual se reporta como exitoso', async () => {
    prisma.telegramMessageLog.create.mockRejectedValue(new Error('db caída'));
    await expect(sender.sendText(ORG, CHAT, 'Hola')).resolves.toMatchObject({
      ok: true,
    });
  });

  it('si marcar el bloqueo falla, no lanza', async () => {
    api.sendMessage.mockResolvedValue({
      ok: false,
      errorCode: 403,
      description: 'x',
    });
    prisma.patientProfile.updateMany.mockRejectedValue(new Error('db caída'));
    await expect(sender.sendText(ORG, CHAT, 'Hola')).resolves.toMatchObject({
      blocked: true,
    });
  });

  it('sendVoice envía y registra VOICE', async () => {
    const ogg = Buffer.from('OggS');
    const res = await sender.sendVoice(ORG, CHAT, ogg, { kind: 'BOT_REPLY' });
    expect(api.sendVoice).toHaveBeenCalledWith(TOKEN, CHAT, ogg);
    expect(res.messageId).toBe(50);
    expect(logged()[0]).toMatchObject({
      messageType: 'VOICE',
      status: 'ACCEPTED',
    });
  });

  it('sendVoice con canal inactivo no llama a Telegram', async () => {
    config.forOrg.mockResolvedValue(null);
    await sender.sendVoice(ORG, CHAT, Buffer.from('x'));
    expect(api.sendVoice).not.toHaveBeenCalled();
    expect(logged()[0]).toMatchObject({
      messageType: 'VOICE',
      status: 'FAILED',
    });
  });

  describe('formato', () => {
    it('el *negrita* de WhatsApp llega como negrita de Telegram (HTML), escapado', async () => {
      await sender.sendText(ORG, CHAT, 'Su cita con *Dr. Ruiz & Cía* <hoy>');
      expect(api.sendMessage).toHaveBeenCalledWith(
        TOKEN,
        CHAT,
        'Su cita con <b>Dr. Ruiz &amp; Cía</b> &lt;hoy&gt;',
        { html: true },
      );
    });

    it('si Telegram rechaza el HTML, reenvía en texto plano sin marcas y registra UN envío', async () => {
      api.sendMessage
        .mockResolvedValueOnce({
          ok: false,
          errorCode: 400,
          description:
            "Bad Request: can't parse entities: unsupported start tag",
        })
        .mockResolvedValueOnce({ ok: true, result: { message_id: 9 } });
      const res = await sender.sendText(ORG, CHAT, 'Su cita es el *lunes*');
      expect(api.sendMessage).toHaveBeenLastCalledWith(
        TOKEN,
        CHAT,
        'Su cita es el lunes',
      );
      expect(res).toMatchObject({ ok: true, messageId: 9 });
      expect(logged()).toHaveLength(1);
      expect(logged()[0]).toMatchObject({ status: 'ACCEPTED', messageId: 9 });
    });

    it('otros 400 no se reintentan en texto plano', async () => {
      api.sendMessage.mockResolvedValue({
        ok: false,
        errorCode: 400,
        description: 'Bad Request: chat not found',
      });
      await sender.sendText(ORG, CHAT, 'Hola');
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('ningún trozo enviado pasa del tope de Telegram, ni con muchas marcas', async () => {
      const texto = Array.from(
        { length: 400 },
        (_, i) => `*Opción ${i}* & más`,
      ).join('\n');
      await sender.sendText(ORG, CHAT, texto);
      for (const c of api.sendMessage.mock.calls)
        expect((c[2] as string).length).toBeLessThanOrEqual(4096);
    });
  });
});
