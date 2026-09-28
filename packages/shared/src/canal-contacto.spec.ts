import { destinoDeContacto } from './canal-contacto';

/** La regla de T4 (docs/PLAN_TELEGRAM.md): canal de la cita, con caída al otro. */
describe('destinoDeContacto', () => {
  const soloWa = { whatsappId: '573001112233' };
  const soloTg = { telegramChatId: '777' };
  const ambos = { whatsappId: '573001112233', telegramChatId: '777' };

  describe('cita de WhatsApp (o manual, o del hospital): como siempre', () => {
    it.each(['WHATSAPP', 'MANUAL', 'MIRROR', null, undefined])(
      'origen %p con WhatsApp → WhatsApp',
      (origen) => {
        expect(destinoDeContacto(ambos, origen)).toEqual({
          canal: 'WHATSAPP',
          destinatario: '573001112233',
          esRespaldo: false,
        });
      },
    );

    it('el BSUID manda sobre el teléfono', () => {
      expect(
        destinoDeContacto({ whatsappId: '573001112233', bsuid: 'CO.1' }, 'WHATSAPP')
          ?.destinatario,
      ).toBe('CO.1');
    });

    it('sin WhatsApp, cae a Telegram', () => {
      expect(destinoDeContacto(soloTg, 'MIRROR')).toEqual({
        canal: 'TELEGRAM',
        destinatario: 'tg:777',
        esRespaldo: true,
      });
    });
  });

  describe('cita de Telegram', () => {
    it('va por Telegram', () => {
      expect(destinoDeContacto(ambos, 'TELEGRAM')).toEqual({
        canal: 'TELEGRAM',
        destinatario: 'tg:777',
        esRespaldo: false,
      });
    });

    it('si bloqueó al bot, cae a WhatsApp', () => {
      expect(
        destinoDeContacto(
          { ...ambos, telegramBlockedAt: new Date('2026-09-28T10:00:00Z') },
          'TELEGRAM',
        ),
      ).toEqual({
        canal: 'WHATSAPP',
        destinatario: '573001112233',
        esRespaldo: true,
      });
    });

    it('si no tiene chat, cae a WhatsApp', () => {
      expect(destinoDeContacto(soloWa, 'TELEGRAM')).toMatchObject({
        canal: 'WHATSAPP',
        esRespaldo: true,
      });
    });

    it('bloqueado y sin WhatsApp → no hay a quién escribir', () => {
      expect(
        destinoDeContacto({ ...soloTg, telegramBlockedAt: '2026-09-28' }, 'TELEGRAM'),
      ).toBeNull();
    });
  });

  it.each([
    {},
    { whatsappId: '', bsuid: '   ', telegramChatId: '' },
    { telegramChatId: 'no-es-numero' },
    { whatsappId: null, bsuid: null, telegramChatId: null },
  ])('sin identificadores utilizables (%p) → null', (p) => {
    expect(destinoDeContacto(p, 'WHATSAPP')).toBeNull();
    expect(destinoDeContacto(p, 'TELEGRAM')).toBeNull();
  });

  it('nunca manda un chat de Telegram como si fuera teléfono', () => {
    const d = destinoDeContacto({ telegramChatId: '3001112233' }, 'WHATSAPP');
    expect(d?.canal).toBe('TELEGRAM');
    expect(d?.destinatario).toBe('tg:3001112233');
  });
});
