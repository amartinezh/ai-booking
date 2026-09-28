import { Logger } from '@nestjs/common';
import { TelegramChannelService } from './telegram-channel.service';

/**
 * La fachada que usa el bot: traduce `tg:<chat_id>` y el contexto de
 * WhatsApp, y nunca lanza.
 */
describe('TelegramChannelService', () => {
  const ORG = 'org-1';
  let prisma: { patientProfile: { updateMany: jest.Mock } };
  let api: { downloadFile: jest.Mock };
  let config: { forOrg: jest.Mock };
  let sender: { sendText: jest.Mock; sendVoice: jest.Mock };
  let channel: TelegramChannelService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    prisma = {
      patientProfile: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    api = { downloadFile: jest.fn(async () => Buffer.from('ogg')) };
    config = {
      forOrg: jest.fn(async () => ({ botToken: 'T', isActive: true })),
    };
    sender = {
      sendText: jest.fn(async () => ({ ok: true })),
      sendVoice: jest.fn(async () => ({ ok: true })),
    };
    channel = new TelegramChannelService(
      prisma as any,
      api as any,
      config as any,
      sender as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('quita el prefijo tg: y traduce el contexto', async () => {
    await channel.sendText(ORG, 'tg:777', 'hola', {
      kind: 'BOOKING_CONFIRMATION',
      appointmentId: 'apt-1',
    });
    expect(sender.sendText).toHaveBeenCalledWith(ORG, '777', 'hola', {
      kind: 'BOOKING_CONFIRMATION',
      appointmentId: 'apt-1',
    });
  });

  it('sin contexto no inventa uno', async () => {
    await channel.sendText(ORG, 'tg:777', 'hola');
    expect(sender.sendText).toHaveBeenCalledWith(ORG, '777', 'hola', {});
  });

  it('MASS_NOTICE (que no sale por Telegram) se registra como aviso del sistema', async () => {
    await channel.sendText(ORG, 'tg:777', 'x', { kind: 'MASS_NOTICE' });
    expect(sender.sendText.mock.calls[0][3].kind).toBe('SYSTEM_NOTICE');
  });

  it.each(['573001112233', 'tg:', 'tg:abc', 'CO.123'])(
    'un remitente que no es un chat válido (%p) no se envía',
    async (bad) => {
      const res = await channel.sendText(ORG, bad, 'hola');
      expect(res.ok).toBe(false);
      expect(sender.sendText).not.toHaveBeenCalled();
    },
  );

  it('sendVoice también traduce', async () => {
    const ogg = Buffer.from('x');
    await channel.sendVoice(ORG, 'tg:9', ogg, { kind: 'BOT_REPLY' });
    expect(sender.sendVoice).toHaveBeenCalledWith(ORG, '9', ogg, {
      kind: 'BOT_REPLY',
      appointmentId: null,
    });
    await channel.sendVoice(ORG, 'no-tg', ogg);
    expect(sender.sendVoice).toHaveBeenCalledTimes(1);
  });

  describe('downloadVoice', () => {
    it('baja con el token de la clínica', async () => {
      await expect(channel.downloadVoice(ORG, 'F1')).resolves.toEqual(
        Buffer.from('ogg'),
      );
      expect(api.downloadFile).toHaveBeenCalledWith('T', 'F1');
    });

    it('sin configuración → null', async () => {
      config.forOrg.mockResolvedValue(null);
      await expect(channel.downloadVoice(ORG, 'F1')).resolves.toBeNull();
    });

    it('un error inesperado → null, sin lanzar', async () => {
      config.forOrg.mockRejectedValue(new Error('db'));
      await expect(channel.downloadVoice(ORG, 'F1')).resolves.toBeNull();
    });
  });

  describe('noteInbound', () => {
    it('limpia el bloqueo solo de ese chat en esa clínica', async () => {
      await channel.noteInbound(ORG, '777');
      expect(prisma.patientProfile.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          telegramChatId: '777',
          telegramBlockedAt: { not: null },
        },
        data: { telegramBlockedAt: null },
      });
    });

    it('nunca lanza', async () => {
      prisma.patientProfile.updateMany.mockRejectedValue(new Error('db'));
      await expect(channel.noteInbound(ORG, '777')).resolves.toBeUndefined();
    });
  });
});
