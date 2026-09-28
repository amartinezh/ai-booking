import {
  formatWhatsappIdentifier,
  whatsappIdentifierLabel,
  whatsappDeepLink,
  noDeepLinkReason,
  NO_DEEP_LINK_REASON,
  NO_DEEP_LINK_REASON_TELEGRAM,
} from './whatsapp';

/**
 * Un remitente de Telegram en el panel (docs/PLAN_TELEGRAM.md). El chat es un
 * número, así que el riesgo es el mismo que con el BSUID: que se muestre como
 * teléfono o, peor, que se le arme un `wa.me` hacia el celular de un tercero.
 */
describe('identificadores de Telegram en el panel', () => {
  const TG = 'tg:3001112233';

  it('se etiqueta como Telegram', () => {
    expect(whatsappIdentifierLabel(TG)).toBe('✈️ Telegram');
  });

  it('se muestra como chat, nunca con «+» de teléfono', () => {
    expect(formatWhatsappIdentifier(TG)).toBe('Chat 3001112233');
    expect(formatWhatsappIdentifier(TG)).not.toContain('+');
  });

  it('NUNCA genera un enlace wa.me (los dígitos serían el celular de otro)', () => {
    expect(whatsappDeepLink(TG, 'Hola')).toBeNull();
  });

  it('el motivo de «sin enlace» dice Telegram, no «ocultó su número»', () => {
    expect(noDeepLinkReason(TG)).toBe(NO_DEEP_LINK_REASON_TELEGRAM);
    expect(noDeepLinkReason('CO.123')).toBe(NO_DEEP_LINK_REASON);
  });

  it('los identificadores de WhatsApp no cambian', () => {
    expect(whatsappIdentifierLabel('573001234567')).toBe('📞 Teléfono');
    expect(formatWhatsappIdentifier('573001234567')).toBe('+573001234567');
    expect(whatsappIdentifierLabel('CO.1')).toBe('🆔 ID de WhatsApp');
  });
});
