import {
  TELEGRAM_ORIGIN,
  resolveSenderIdentity,
  telegramOriginOf,
  type WhatsappInboundEvent,
} from './sender-identity';

/**
 * Identidad de un evento de Telegram (docs/PLAN_TELEGRAM.md §4.3 #1).
 *
 * La marca es un `Symbol`: solo la pone el webhook de Telegram (que ya
 * autenticó a la clínica) y ningún JSON —de Meta o de quien sea— la puede
 * fabricar.
 */
describe('resolveSenderIdentity — Telegram', () => {
  const origin = {
    organizationId: 'org-1',
    chatId: '3001112233',
    senderId: 'tg:3001112233',
  };

  it('el remitente es tg:<chat_id>, sin teléfono ni BSUID', () => {
    const event: WhatsappInboundEvent = {
      type: 'text',
      text: { body: 'hola' },
      [TELEGRAM_ORIGIN]: origin,
    };
    expect(resolveSenderIdentity(event)).toEqual({
      senderId: 'tg:3001112233',
      bsuid: null,
      phone: null,
      telegramChatId: '3001112233',
    });
  });

  it('con la marca, `from` y `user_id` se ignoran aunque vinieran', () => {
    const event: WhatsappInboundEvent = {
      from: '573001112233',
      user_id: 'CO.123',
      [TELEGRAM_ORIGIN]: origin,
    };
    expect(resolveSenderIdentity(event)?.senderId).toBe('tg:3001112233');
    expect(resolveSenderIdentity(event)?.phone).toBeNull();
  });

  it('un evento de WhatsApp no gana la propiedad telegramChatId', () => {
    const id = resolveSenderIdentity({ from: '573001112233' });
    expect(id).toEqual({
      senderId: '573001112233',
      bsuid: null,
      phone: '573001112233',
    });
    expect(id).not.toHaveProperty('telegramChatId');
  });

  it('campos con nombre de Telegram en un JSON no cuentan', () => {
    const falso = JSON.parse(
      '{"from":"573001112233","channel":"telegram","telegram":{"organizationId":"org-2","chatId":"1","senderId":"tg:1"}}',
    );
    expect(telegramOriginOf(falso)).toBeNull();
    expect(resolveSenderIdentity(falso)?.senderId).toBe('573001112233');
  });

  it('la marca no sobrevive a JSON.stringify', () => {
    const event: WhatsappInboundEvent = { [TELEGRAM_ORIGIN]: origin };
    expect(telegramOriginOf(event)).toEqual(origin);
    expect(telegramOriginOf(JSON.parse(JSON.stringify(event)))).toBeNull();
  });

  it('telegramOriginOf tolera null y undefined', () => {
    expect(telegramOriginOf(null)).toBeNull();
    expect(telegramOriginOf(undefined)).toBeNull();
  });
});
