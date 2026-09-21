import { derivarSync, type FilaOutbox } from './sync-state';

const T = (min: number) => new Date(Date.UTC(2026, 8, 21, 15, 0) + min * 60_000);

const evento = (over: Partial<FilaOutbox> = {}): FilaOutbox => ({
  seq: BigInt(1),
  op: 'INSERT',
  createdAt: T(0),
  deliveredAt: null,
  attempts: 0,
  deadLettered: false,
  nextAttemptAt: null,
  lastError: null,
  ...over,
});

describe('derivarSync', () => {
  it('sin eventos → NO_EVENT (el trigger no registra con el espejo apagado)', () => {
    expect(derivarSync([])).toMatchObject({ estado: 'NO_EVENT', creadoIso: null, seq: null });
  });

  it('un evento entregado → DELIVERED con su hora', () => {
    const s = derivarSync([evento({ deliveredAt: T(1) })]);
    expect(s).toMatchObject({ estado: 'DELIVERED', deliveredAtIso: T(1).toISOString(), creadoIso: T(0).toISOString() });
  });

  it('pendiente sin intentos → PENDING, con el más viejo', () => {
    const s = derivarSync([evento({ seq: BigInt(2), createdAt: T(5) }), evento({ seq: BigInt(1), createdAt: T(2) })]);
    expect(s.estado).toBe('PENDING');
    expect(s.oldestPendingIso).toBe(T(2).toISOString());
  });

  it('pendiente con intentos → RETRYING, con el motivo y el próximo intento', () => {
    const s = derivarSync([evento({ attempts: 3, lastError: 'Failed to connect', nextAttemptAt: T(4) })]);
    expect(s).toMatchObject({ estado: 'RETRYING', attempts: 3, lastError: 'Failed to connect', nextAttemptIso: T(4).toISOString() });
  });

  it('dead-letter → DEAD_LETTER con el seq (para el botón de reprocesar) y el motivo', () => {
    const s = derivarSync([evento({ seq: BigInt(42), attempts: 10, deadLettered: true, lastError: 'cupo ya vendido' })]);
    expect(s).toMatchObject({ estado: 'DEAD_LETTER', attempts: 10, lastError: 'cupo ya vendido', seq: '42' });
  });

  it('🚨 el PEOR estado manda: un INSERT entregado con un UPDATE rendido es DEAD_LETTER', () => {
    const s = derivarSync([
      evento({ seq: BigInt(1), op: 'INSERT', deliveredAt: T(1) }),
      evento({ seq: BigInt(2), op: 'UPDATE', createdAt: T(10), attempts: 10, deadLettered: true, lastError: 'x' }),
    ]);
    expect(s.estado).toBe('DEAD_LETTER');
    expect(s.seq).toBe('2');
  });

  it('dead-letter gana sobre reintentando, y reintentando sobre en cola', () => {
    expect(
      derivarSync([evento({ seq: BigInt(1), attempts: 2 }), evento({ seq: BigInt(2), attempts: 10, deadLettered: true })]).estado,
    ).toBe('DEAD_LETTER');
    expect(derivarSync([evento({ seq: BigInt(1) }), evento({ seq: BigInt(2), attempts: 2 })]).estado).toBe('RETRYING');
  });

  it('todo entregado: la hora es la del último', () => {
    const s = derivarSync([evento({ deliveredAt: T(1) }), evento({ seq: BigInt(2), createdAt: T(9), deliveredAt: T(11) })]);
    expect(s.deliveredAtIso).toBe(T(11).toISOString());
  });

  it('el seq puede venir como bigint o como texto', () => {
    expect(derivarSync([evento({ seq: '7', attempts: 10, deadLettered: true })]).seq).toBe('7');
  });
});
