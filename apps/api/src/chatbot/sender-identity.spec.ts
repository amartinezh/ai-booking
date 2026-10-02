import { resolveSenderIdentity, UNIDENTIFIED_SENDER } from './sender-identity';

describe('resolveSenderIdentity', () => {
  // ── Mundo actual: Meta manda el teléfono ────────────────────────────────
  it('payload clásico (solo `from`) → el teléfono es la clave canónica', () => {
    expect(resolveSenderIdentity({ from: '573001112233' })).toEqual({
      senderId: '573001112233',
      phone: '573001112233',
      bsuid: null,
    });
  });

  // ── Mundo nuevo: el paciente ocultó su número ───────────────────────────
  it('payload con username activo (solo `user_id`) → el BSUID es la clave', () => {
    expect(
      resolveSenderIdentity({ user_id: 'CO.13491208655302741918' }),
    ).toEqual({
      senderId: 'CO.13491208655302741918',
      bsuid: 'CO.13491208655302741918',
      phone: null,
    });
  });

  // Forma REAL de `messages[]` (2026-10-02): el BSUID viene en `from_user_id`.
  it('payload real con número oculto (solo `from_user_id`) → el BSUID es la clave', () => {
    expect(
      resolveSenderIdentity({
        from_user_id: 'CO.13491208655302741918',
        id: 'wamid.X',
        type: 'audio',
        audio: { id: 'a1' },
      }),
    ).toEqual({
      senderId: 'CO.13491208655302741918',
      bsuid: 'CO.13491208655302741918',
      phone: null,
    });
  });

  it('`from_user_id` gana a `user_id` si vinieran los dos', () => {
    expect(
      resolveSenderIdentity({ from_user_id: 'CO.111', user_id: 'CO.222' })
        ?.bsuid,
    ).toBe('CO.111');
  });

  it('con AMBOS, la clave sigue siendo el teléfono y el BSUID se conserva aparte', () => {
    const identity = resolveSenderIdentity({
      from: '573001112233',
      from_user_id: 'CO.13491208655302741918',
    });
    expect(identity?.senderId).toBe('573001112233');
    expect(identity?.phone).toBe('573001112233');
    // El BSUID no se pierde: se conserva para guardarlo en su columna.
    expect(identity?.bsuid).toBe('CO.13491208655302741918');
  });

  it('el Parent BSUID (CO.ENT.*) NUNCA se usa como identidad', () => {
    const identity = resolveSenderIdentity({
      from_user_id: 'CO.13491208655302741918',
      from_parent_user_id: 'CO.ENT.99999999999999',
      parent_user_id: 'CO.ENT.99999999999999',
    });
    expect(identity?.senderId).toBe('CO.13491208655302741918');
    expect(JSON.stringify(identity)).not.toContain('ENT');
  });

  it.each([
    ['parent_user_id', { parent_user_id: 'CO.ENT.99999999999999' }],
    ['from_parent_user_id', { from_parent_user_id: 'CO.ENT.99999999999999' }],
  ])('un payload SOLO con %s no identifica a nadie', (_l, event) => {
    expect(resolveSenderIdentity(event)).toBeNull();
  });

  // ── Messenger legacy ────────────────────────────────────────────────────
  it('PSID de Messenger sirve de clave, pero no es teléfono ni BSUID', () => {
    expect(resolveSenderIdentity({ sender: { id: 'PSID-123' } })).toEqual({
      senderId: 'PSID-123',
      bsuid: null,
      phone: null,
    });
  });

  it('`from` tiene prioridad sobre el PSID legacy', () => {
    expect(
      resolveSenderIdentity({
        from: '573001112233',
        sender: { id: 'PSID-123' },
      })?.senderId,
    ).toBe('573001112233');
  });

  // ── Casos degenerados: el motivo de la falla silenciosa ─────────────────
  it.each([
    ['objeto vacío', {}],
    ['strings vacíos', { from: '', user_id: '', from_user_id: '' }],
    ['solo espacios', { from: '   ', user_id: '  ', from_user_id: ' ' }],
    ['solo metadata', { metadata: { phone_number_id: '123' }, type: 'text' }],
    ['sender sin id', { sender: {} }],
  ])('%s → null (el llamador debe auditar, no descartar)', (_label, event) => {
    expect(resolveSenderIdentity(event)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('evento %s → null sin lanzar', (_label, event) => {
    expect(resolveSenderIdentity(event)).toBeNull();
  });

  it('recorta espacios alrededor de los identificadores', () => {
    expect(resolveSenderIdentity({ from: '  573001112233  ' })).toEqual({
      senderId: '573001112233',
      phone: '573001112233',
      bsuid: null,
    });
  });

  it('el centinela de remitente desconocido es un valor estable', () => {
    expect(UNIDENTIFIED_SENDER).toBe('unknown');
  });
});
