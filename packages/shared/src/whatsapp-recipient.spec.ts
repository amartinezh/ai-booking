import {
  isWhatsappPhoneId,
  whatsappRecipientField,
  buildWhatsappRecipient,
} from './whatsapp-recipient';

describe('isWhatsappPhoneId', () => {
  it.each(['573001112233', '13491208655302741918', '1'])(
    '%s → es teléfono (wa_id es E.164 sin el +)',
    (id) => {
      expect(isWhatsappPhoneId(id)).toBe(true);
    },
  );

  it.each([
    ['BSUID', 'CO.13491208655302741918'],
    ['Parent BSUID', 'CO.ENT.13491208655302741918'],
    ['formato futuro desconocido', 'XX_abc-123'],
    ['con el + de E.164', '+573001112233'],
    ['con espacios internos', '573 001 1122'],
    ['vacío', ''],
    ['solo espacios', '   '],
  ])('%s → NO es teléfono', (_label, id) => {
    expect(isWhatsappPhoneId(id)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('%s → false sin lanzar', (_label, id) => {
    expect(isWhatsappPhoneId(id)).toBe(false);
  });

  it('tolera espacios alrededor', () => {
    expect(isWhatsappPhoneId('  573001112233  ')).toBe(true);
  });
});

describe('whatsappRecipientField', () => {
  it('teléfono → `to` (comportamiento clásico)', () => {
    expect(whatsappRecipientField('573001112233')).toBe('to');
  });

  it('BSUID → `recipient`', () => {
    expect(whatsappRecipientField('CO.13491208655302741918')).toBe('recipient');
  });

  it('identificador opaco no reconocido → `recipient`, nunca `to`', () => {
    // Falla del lado seguro: mandar un id opaco en `to` es un error garantizado.
    expect(whatsappRecipientField('FORMATO.NUEVO.DE.META')).toBe('recipient');
  });
});

describe('buildWhatsappRecipient', () => {
  it('teléfono → { to }', () => {
    expect(buildWhatsappRecipient('573001112233')).toEqual({
      to: '573001112233',
    });
  });

  it('BSUID → { recipient }', () => {
    expect(buildWhatsappRecipient('CO.13491208655302741918')).toEqual({
      recipient: 'CO.13491208655302741918',
    });
  });

  it('nunca emite ambos campos a la vez', () => {
    for (const id of ['573001112233', 'CO.13491208655302741918']) {
      expect(Object.keys(buildWhatsappRecipient(id))).toHaveLength(1);
    }
  });
});
