import { adaptTelegramUpdate } from './telegram-inbound.adapter';
import { TELEGRAM_ORIGIN, telegramOriginOf } from '../chatbot/sender-identity';
import type { TelegramMessage, TelegramUpdate } from './telegram.types';

/**
 * Política de T8 (docs/PLAN_TELEGRAM.md): qué hace el canal con cada cosa que
 * Telegram puede mandar. Es la frontera entre Telegram y el bot, así que se
 * prueba también lo que NO debe pasar: que un chat_id termine en `from`
 * (se guardaría como teléfono) o que un grupo llegue al bot.
 */
describe('adaptTelegramUpdate', () => {
  const ORG = 'org-1';
  const ROUTE = 'ruta-abc';

  const msg = (over: Partial<TelegramMessage> = {}): TelegramMessage => ({
    message_id: 7,
    date: 1_790_000_000,
    from: { id: 3001112233, is_bot: false, first_name: 'Ana' },
    chat: { id: 3001112233, type: 'private' },
    ...over,
  });
  const upd = (over: Partial<TelegramUpdate> = {}): TelegramUpdate => ({
    update_id: 555,
    message: msg({ text: 'Quiero una cita' }),
    ...over,
  });

  describe('texto', () => {
    it('lo entrega al bot con remitente tg:<chat_id> y la clínica de la ruta', () => {
      const d = adaptTelegramUpdate(upd(), ORG, ROUTE);
      expect(d.action).toBe('message');
      if (d.action !== 'message') return;
      expect(d.event).toMatchObject({
        type: 'text',
        text: { body: 'Quiero una cita' },
      });
      expect(d.senderId).toBe('tg:3001112233');
      expect(telegramOriginOf(d.event)).toEqual({
        organizationId: ORG,
        chatId: '3001112233',
        senderId: 'tg:3001112233',
      });
    });

    it('la marca de Telegram es un Symbol: no viaja en JSON (no se puede falsificar desde Meta)', () => {
      const d = adaptTelegramUpdate(upd(), ORG, ROUTE);
      if (d.action !== 'message') throw new Error('se esperaba message');
      expect(Object.getOwnPropertySymbols(d.event)).toContain(TELEGRAM_ORIGIN);
      const copia = JSON.parse(JSON.stringify(d.event));
      expect(telegramOriginOf(copia)).toBeNull();
      // Un payload de Meta con campos parecidos tampoco cuenta como Telegram.
      expect(
        telegramOriginOf(
          JSON.parse(
            '{"from":"1","channel":"telegram","telegram":{"organizationId":"org-2"}}',
          ),
        ),
      ).toBeNull();
    });

    it('NO pone el chat_id en `from` ni en `user_id` (serían teléfono y BSUID de WhatsApp)', () => {
      const d = adaptTelegramUpdate(upd(), ORG, ROUTE);
      if (d.action !== 'message') throw new Error('se esperaba message');
      expect(d.event.from).toBeUndefined();
      expect(d.event.user_id).toBeUndefined();
      expect(d.event.metadata).toBeUndefined();
    });

    it('la llave de dedup incluye la ruta: update_id solo es único dentro de un bot', () => {
      const a = adaptTelegramUpdate(upd(), ORG, 'ruta-a');
      const b = adaptTelegramUpdate(upd(), 'org-2', 'ruta-b');
      if (a.action !== 'message' || b.action !== 'message') throw new Error();
      expect(a.dedupKey).toBe('tg:ruta-a:555');
      expect(b.dedupKey).not.toBe(a.dedupKey);
      expect(a.event.id).toBe(a.dedupKey);
    });

    it('recorta espacios', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ text: '  hola  ' }) }),
        ORG,
        ROUTE,
      );
      if (d.action !== 'message') throw new Error();
      expect(d.event.text?.body).toBe('hola');
    });

    it('un texto vacío se ignora', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ text: '   ' }) }),
        ORG,
        ROUTE,
      );
      expect(d.action).toBe('ignore');
    });
  });

  describe('/start', () => {
    it.each(['/start', '/start campaña-sede', '/start@ClinicaBot', '/START'])(
      '%p es el «Hola» de WhatsApp',
      (text) => {
        const d = adaptTelegramUpdate(
          upd({ message: msg({ text }) }),
          ORG,
          ROUTE,
        );
        if (d.action !== 'message') throw new Error();
        expect(d.event.text?.body).toBe('Hola');
      },
    );

    it('/startup no es /start', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ text: '/startup' }) }),
        ORG,
        ROUTE,
      );
      if (d.action !== 'message') throw new Error();
      expect(d.event.text?.body).toBe('/startup');
    });

    it('otros comandos pasan como texto', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ text: '/ayuda' }) }),
        ORG,
        ROUTE,
      );
      if (d.action !== 'message') throw new Error();
      expect(d.event.text?.body).toBe('/ayuda');
    });
  });

  describe('nota de voz', () => {
    it('va al bot como audio con el file_id', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ voice: { file_id: 'VOZ-1', duration: 3 } }) }),
        ORG,
        ROUTE,
      );
      if (d.action !== 'message') throw new Error();
      expect(d.event.type).toBe('audio');
      expect(d.event.audio).toEqual({ id: 'VOZ-1' });
      expect(d.event.text).toBeUndefined();
    });
  });

  describe('lo que el bot no entiende en un chat privado → aviso', () => {
    it.each([
      ['photo', { photo: [{}] }],
      ['sticker', { sticker: {} }],
      ['document', { document: {} }],
      ['audio', { audio: {} }], // archivo de música, no nota de voz
      ['video', { video: {} }],
      ['video_note', { video_note: {} }],
      ['location', { location: {} }],
      ['contact', { contact: {} }],
    ])('%s', (what, extra) => {
      const d = adaptTelegramUpdate(
        upd({ message: msg(extra as Partial<TelegramMessage>) }),
        ORG,
        ROUTE,
      );
      expect(d).toEqual({
        action: 'unsupported',
        chatId: '3001112233',
        senderId: 'tg:3001112233',
        dedupKey: 'tg:ruta-abc:555',
        what,
      });
    });

    it('algo desconocido también recibe aviso', () => {
      const d = adaptTelegramUpdate(upd({ message: msg() }), ORG, ROUTE);
      expect(d.action).toBe('unsupported');
      if (d.action === 'unsupported') expect(d.what).toBe('otro');
    });
  });

  describe('se ignora (T8)', () => {
    it.each(['group', 'supergroup', 'channel', undefined])(
      'chat de tipo %p',
      (type) => {
        const d = adaptTelegramUpdate(
          upd({ message: msg({ text: 'hola', chat: { id: -100123, type } }) }),
          ORG,
          ROUTE,
        );
        expect(d.action).toBe('ignore');
      },
    );

    it('mensaje editado (no se reprocesan turnos)', () => {
      const d = adaptTelegramUpdate(
        { update_id: 1, edited_message: msg({ text: 'otra cosa' }) },
        ORG,
        ROUTE,
      );
      expect(d).toEqual({ action: 'ignore', reason: 'mensaje editado' });
    });

    it('publicación de canal', () => {
      const d = adaptTelegramUpdate(
        { update_id: 1, channel_post: msg({ text: 'x' }) },
        ORG,
        ROUTE,
      );
      expect(d.action).toBe('ignore');
    });

    it('botones, cambios de miembro y demás updates sin message', () => {
      expect(
        adaptTelegramUpdate({ update_id: 1, callback_query: {} }, ORG, ROUTE)
          .action,
      ).toBe('ignore');
      expect(
        adaptTelegramUpdate({ update_id: 1, my_chat_member: {} }, ORG, ROUTE)
          .action,
      ).toBe('ignore');
    });

    it('un remitente que es bot', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ text: 'hola', from: { id: 1, is_bot: true } }) }),
        ORG,
        ROUTE,
      );
      expect(d.action).toBe('ignore');
    });

    it.each([null, undefined, {}, { update_id: '5' }])(
      'payload sin update_id numérico: %p',
      (payload) => {
        expect(
          adaptTelegramUpdate(payload as TelegramUpdate, ORG, ROUTE).action,
        ).toBe('ignore');
      },
    );

    it('chat privado sin id utilizable', () => {
      const d = adaptTelegramUpdate(
        upd({ message: msg({ text: 'hola', chat: { type: 'private' } }) }),
        ORG,
        ROUTE,
      );
      expect(d).toEqual({ action: 'ignore', reason: 'chat.id inválido' });
    });
  });
});
