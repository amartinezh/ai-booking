import {
  TELEGRAM_SENDER_PREFIX,
  chatIdFromTelegramSender,
  isTelegramSender,
  toTelegramSenderId,
} from './telegram-identity';
import { buildWhatsappRecipient, isWhatsappPhoneId } from './whatsapp-recipient';

/**
 * Todo lo que hoy puede ser un `senderId` de WhatsApp. La guarda de Telegram
 * tiene que decir `false` a TODOS: es lo que garantiza que el camino de
 * WhatsApp siga siendo el de siempre (docs/PLAN_TELEGRAM.md §6).
 */
const IDENTIFICADORES_DE_WHATSAPP = [
  '573001112233', // teléfono con indicativo
  '3001112233', // teléfono sin indicativo
  'CO.13491208655302741918', // BSUID
  'CO.ENT.99887766554433', // Parent BSUID (no se usa, pero no debe confundirse)
  '1234567890123456', // PSID legacy de Messenger
  'unknown', // UNIDENTIFIED_SENDER
  '',
  '   ',
  'TG:123', // mayúsculas: no es nuestro prefijo
  'x-tg:123',
];

describe('isTelegramSender', () => {
  it.each(IDENTIFICADORES_DE_WHATSAPP)(
    'es false para el identificador de WhatsApp %p',
    (id) => {
      expect(isTelegramSender(id)).toBe(false);
    },
  );

  it('es false para null y undefined', () => {
    expect(isTelegramSender(null)).toBe(false);
    expect(isTelegramSender(undefined)).toBe(false);
  });

  it('es true para un remitente de Telegram', () => {
    expect(isTelegramSender('tg:123456789')).toBe(true);
    expect(isTelegramSender(' tg:123456789 ')).toBe(true);
  });

  it('es true también para un tg: malformado (nunca debe ir a Meta)', () => {
    expect(isTelegramSender('tg:')).toBe(true);
    expect(isTelegramSender('tg:abc')).toBe(true);
  });
});

describe('toTelegramSenderId', () => {
  it('prefija un chat_id numérico', () => {
    expect(toTelegramSenderId(123456789)).toBe('tg:123456789');
    expect(toTelegramSenderId('123456789')).toBe('tg:123456789');
    expect(toTelegramSenderId(' 42 ')).toBe('tg:42');
  });

  it('acepta ids de grupo (negativos); filtrarlos es cosa del webhook', () => {
    expect(toTelegramSenderId(-1001234567890)).toBe('tg:-1001234567890');
  });

  it('acepta ids por encima de 2^31', () => {
    expect(toTelegramSenderId(7_123_456_789)).toBe('tg:7123456789');
  });

  it.each([null, undefined, '', 'abc', '12.5', 12.5, NaN, Infinity, '1e9'])(
    'devuelve null para %p',
    (chatId) => {
      expect(toTelegramSenderId(chatId as never)).toBeNull();
    },
  );

  it('rechaza un número que ya perdió precisión', () => {
    expect(toTelegramSenderId(2 ** 60)).toBeNull();
  });
});

describe('chatIdFromTelegramSender', () => {
  it('es la inversa de toTelegramSenderId', () => {
    for (const chatId of ['1', '123456789', '-1001234567890']) {
      expect(chatIdFromTelegramSender(toTelegramSenderId(chatId))).toBe(
        chatId,
      );
    }
  });

  it('devuelve null para identificadores de WhatsApp', () => {
    for (const id of IDENTIFICADORES_DE_WHATSAPP) {
      expect(chatIdFromTelegramSender(id)).toBeNull();
    }
    expect(chatIdFromTelegramSender(null)).toBeNull();
  });

  it('devuelve null para un tg: malformado', () => {
    expect(chatIdFromTelegramSender('tg:')).toBeNull();
    expect(chatIdFromTelegramSender('tg:abc')).toBeNull();
  });
});

describe('convivencia con la identidad de WhatsApp', () => {
  it('un remitente de Telegram nunca es un teléfono de WhatsApp', () => {
    const id = `${TELEGRAM_SENDER_PREFIX}3001112233`;
    expect(isWhatsappPhoneId(id)).toBe(false);
  });

  it('el mismo número como teléfono y como chat da dos remitentes distintos', () => {
    expect(toTelegramSenderId('3001112233')).not.toBe('3001112233');
  });

  it('documenta el riesgo: sin la guarda, un tg: viajaría a Meta como BSUID', () => {
    // Por esto cada envío del bot debe preguntar `isTelegramSender` ANTES de
    // armar el destinatario de WhatsApp (Fase 2 del plan).
    expect(buildWhatsappRecipient('tg:3001112233')).toEqual({
      recipient: 'tg:3001112233',
    });
  });
});
