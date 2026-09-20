import {
  CANCELADA_POR,
  armarMetaLogCancelacionPersonal,
  leerCancelacionPersonal,
} from './appointment-cancel';

const AT = new Date('2026-09-21T15:30:00.000Z');
const QUIEN = { userId: 'u-1', role: 'BOOKING_AGENT', at: AT };

describe('CANCELADA_POR', () => {
  // `MIRROR` ya está escrito en las filas que dejó el espejo: renombrarlo partiría
  // la historia en dos. Este test fija los valores igual que el de SYNC_AUDIT_DIRECTION.
  it('conserva los valores que ya existen en la base', () => {
    expect(CANCELADA_POR).toEqual({ MIRROR: 'MIRROR', STAFF: 'STAFF' });
  });
});

describe('armarMetaLogCancelacionPersonal', () => {
  it('deja quién, con qué rol y cuándo (en ISO)', () => {
    expect(armarMetaLogCancelacionPersonal(null, QUIEN)).toEqual({
      cancelledBy: 'STAFF',
      cancelledByUserId: 'u-1',
      cancelledByRole: 'BOOKING_AGENT',
      cancelledAt: '2026-09-21T15:30:00.000Z',
    });
  });

  it('no guarda el correo ni ningún otro dato personal: solo el id', () => {
    const texto = JSON.stringify(armarMetaLogCancelacionPersonal(null, QUIEN));
    expect(texto).not.toContain('@');
  });

  it('conserva lo que la cita ya tuviera en metaLog y agrega la constancia encima', () => {
    const r = armarMetaLogCancelacionPersonal({ nota: 'x', eventId: 'e-1' }, QUIEN);
    expect(r).toMatchObject({ nota: 'x', eventId: 'e-1', cancelledBy: 'STAFF' });
  });

  it('una constancia previa se sobrescribe (quien llama decide si debe hacerlo)', () => {
    const r = armarMetaLogCancelacionPersonal(
      { cancelledBy: 'MIRROR', reason: 'x' },
      QUIEN,
    );
    expect(r.cancelledBy).toBe('STAFF');
  });

  it.each([null, undefined, 'texto', 42, true, [1, 2]])(
    'un metaLog previo que no es un objeto (%p) se ignora sin romper',
    (previo) => {
      expect(armarMetaLogCancelacionPersonal(previo, QUIEN)).toEqual({
        cancelledBy: 'STAFF',
        cancelledByUserId: 'u-1',
        cancelledByRole: 'BOOKING_AGENT',
        cancelledAt: AT.toISOString(),
      });
    },
  );

  it('no muta el metaLog previo', () => {
    const previo = { nota: 'x' };
    armarMetaLogCancelacionPersonal(previo, QUIEN);
    expect(previo).toEqual({ nota: 'x' });
  });
});

describe('leerCancelacionPersonal', () => {
  it('lee lo que escribe armarMetaLogCancelacionPersonal (ida y vuelta)', () => {
    expect(
      leerCancelacionPersonal(armarMetaLogCancelacionPersonal(null, QUIEN)),
    ).toEqual({ userId: 'u-1', role: 'BOOKING_AGENT', atIso: AT.toISOString() });
  });

  it('una cancelación del hospital NO es del personal', () => {
    expect(
      leerCancelacionPersonal({ cancelledBy: 'MIRROR', reason: 'PACIENTE LLAMA' }),
    ).toBeNull();
  });

  it.each([null, undefined, 'texto', 42, [], {}])(
    'un metaLog sin constancia (%p) → null',
    (metaLog) => {
      expect(leerCancelacionPersonal(metaLog)).toBeNull();
    },
  );

  it('tolera una constancia incompleta: los campos que faltan quedan en null', () => {
    expect(leerCancelacionPersonal({ cancelledBy: 'STAFF' })).toEqual({
      userId: null,
      role: null,
      atIso: null,
    });
  });

  it('una fecha ilegible cae a null, NO a "ahora" (no inventar cuándo)', () => {
    const r = leerCancelacionPersonal({
      cancelledBy: 'STAFF',
      cancelledByUserId: 'u-1',
      cancelledAt: 'no es una fecha',
    });
    expect(r?.atIso).toBeNull();
    expect(r?.userId).toBe('u-1');
  });

  it('valores que no son texto se ignoran', () => {
    expect(
      leerCancelacionPersonal({
        cancelledBy: 'STAFF',
        cancelledByUserId: 42,
        cancelledByRole: { x: 1 },
        cancelledAt: 1789900000,
      }),
    ).toEqual({ userId: null, role: null, atIso: null });
  });

  it('un texto en blanco cuenta como ausente', () => {
    expect(
      leerCancelacionPersonal({ cancelledBy: 'STAFF', cancelledByUserId: '   ' })?.userId,
    ).toBeNull();
  });
});
