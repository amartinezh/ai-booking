import { formatWhatsappIdentifier, whatsappIdentifierLabel, whatsappDeepLink } from './whatsapp';

// wa_id de teléfono: dígitos únicamente. BSUID: prefijo de país + punto + dígitos.
const PHONE_ID = '573001234567';
const BSUID = 'CO.13491208655302741918';

describe('formatWhatsappIdentifier', () => {
    it('antepone "+" a un identificador de teléfono', () => {
        expect(formatWhatsappIdentifier(PHONE_ID)).toBe(`+${PHONE_ID}`);
    });

    it('deja un BSUID sin modificar (nunca lo disfraza de teléfono)', () => {
        expect(formatWhatsappIdentifier(BSUID)).toBe(BSUID);
    });
});

describe('whatsappIdentifierLabel', () => {
    it('etiqueta un teléfono como "📞 Teléfono"', () => {
        expect(whatsappIdentifierLabel(PHONE_ID)).toBe('📞 Teléfono');
    });

    it('etiqueta un BSUID como "🆔 ID de WhatsApp"', () => {
        expect(whatsappIdentifierLabel(BSUID)).toBe('🆔 ID de WhatsApp');
    });
});

describe('whatsappDeepLink', () => {
    it('genera un enlace wa.me para un teléfono', () => {
        const link = whatsappDeepLink(PHONE_ID, 'Hola');
        expect(link).toBe(`https://wa.me/${PHONE_ID}?text=Hola`);
    });

    it('codifica el texto del mensaje en la URL', () => {
        const link = whatsappDeepLink(PHONE_ID, 'Hola & bienvenido?');
        expect(link).toBe(`https://wa.me/${PHONE_ID}?text=${encodeURIComponent('Hola & bienvenido?')}`);
    });

    it('devuelve null para un BSUID — nunca inventa un número de teléfono', () => {
        expect(whatsappDeepLink(BSUID, 'Hola')).toBeNull();
    });
});
