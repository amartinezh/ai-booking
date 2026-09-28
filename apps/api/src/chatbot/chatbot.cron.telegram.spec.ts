import { of } from 'rxjs';
import { ChatbotCron } from './chatbot.cron';
import { ChatState, SESSION_TTL } from './chatbot.constants';

/**
 * Cierre por inactividad de una sesión de Telegram (docs/PLAN_TELEGRAM.md
 * §4.3 #9). El cron llamaba a Meta directo, sin pasar por el envío central:
 * a un `tg:` se le cerraba la sesión en silencio y se intentaba un envío a la
 * Graph API que solo podía fallar.
 */
describe('ChatbotCron — cierre por inactividad de una sesión de Telegram', () => {
  const ORG = 'org-1';

  const build = (sender: string, withChannel = true) => {
    const key = `chat_state:${ORG}:${sender}`;
    const redis = {
      keys: jest.fn((p: string) => (p.startsWith('chat_state:') ? [key] : [])),
      get: jest.fn((k: string) =>
        k.startsWith('alta_en_curso:') ? null : ChatState.AWAITING_SPECIALTY,
      ),
      ttl: jest.fn(() => SESSION_TTL - 600), // 10 min inactiva (umbral: 5)
      del: jest.fn(() => 1),
    };
    const httpService = { post: jest.fn(() => of({ data: {} })) };
    const whatsappCredentials = {
      forOrg: jest.fn(() => ({
        organizationId: ORG,
        phoneNumberId: 'pnid',
        accessToken: 'tok',
        isActive: true,
      })),
    };
    const messageLog = { recordOutbound: jest.fn() };
    const channel = { sendText: jest.fn(async () => ({ ok: true })) };
    const cron = new ChatbotCron(
      redis as any,
      httpService as any,
      whatsappCredentials as any,
      messageLog as any,
      withChannel ? (channel as any) : undefined,
    );
    return { cron, redis, httpService, whatsappCredentials, channel, key };
  };

  it('avisa por Telegram, no por Meta, y limpia la sesión', async () => {
    const { cron, httpService, whatsappCredentials, channel, redis, key } =
      build('tg:777');

    await cron.handleAbandonedSessions();

    expect(channel.sendText).toHaveBeenCalledWith(
      ORG,
      'tg:777',
      expect.stringContaining('inactividad'),
      { kind: 'SYSTEM_NOTICE' },
    );
    expect(httpService.post).not.toHaveBeenCalled();
    expect(whatsappCredentials.forOrg).not.toHaveBeenCalled();
    expect(redis.del.mock.calls.flat()).toContain(key);
  });

  it('el aviso por Telegram es el mismo texto que por WhatsApp', async () => {
    const tg = build('tg:777');
    await tg.cron.handleAbandonedSessions();
    const wa = build('573001112233');
    await wa.cron.handleAbandonedSessions();

    const textoWa = (wa.httpService.post.mock.calls[0] as any[])[1].text.body;
    expect((tg.channel.sendText.mock.calls[0] as any[])[2]).toBe(textoWa);
  });

  it('sin el canal cargado: limpia la sesión igual y NO intenta Meta', async () => {
    const { cron, httpService, redis, key } = build('tg:777', false);
    await cron.handleAbandonedSessions();
    expect(httpService.post).not.toHaveBeenCalled();
    expect(redis.del.mock.calls.flat()).toContain(key);
  });

  it('una sesión de WhatsApp sigue saliendo por Meta y no toca Telegram', async () => {
    const { cron, httpService, channel } = build('573001112233');
    await cron.handleAbandonedSessions();
    expect(httpService.post).toHaveBeenCalledTimes(1);
    expect(channel.sendText).not.toHaveBeenCalled();
  });
});
