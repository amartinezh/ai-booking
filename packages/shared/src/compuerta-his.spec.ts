import {
  algunaCompuertaAbierta,
  compuertaAbierta,
  compuertasHis,
  eventoPuedeSalir,
  operacionHisDelEvento,
} from './compuerta-his';

const cita = (op: string, payload: unknown) => ({
  entityType: 'APPOINTMENT',
  op,
  payload,
});

describe('operacionHisDelEvento — el mismo criterio que el motor del agente', () => {
  it('alta = AGENDAR; borrado = CANCELAR', () => {
    expect(operacionHisDelEvento(cita('INSERT', {}))).toBe('AGENDAR');
    expect(operacionHisDelEvento(cita('DELETE', {}))).toBe('CANCELAR');
  });

  it('UPDATE a CANCELLED = CANCELAR, aunque también cambie el cupo', () => {
    expect(
      operacionHisDelEvento(
        cita('UPDATE', { status: 'CANCELLED', scheduleSlotId: 's2', __old: { scheduleSlotId: 's1' } }),
      ),
    ).toBe('CANCELAR');
  });

  it('UPDATE que cambia de cupo = MODIFICAR', () => {
    expect(
      operacionHisDelEvento(
        cita('UPDATE', { status: 'SCHEDULED', scheduleSlotId: 's2', __old: { scheduleSlotId: 's1' } }),
      ),
    ).toBe('MODIFICAR');
  });

  it('cualquier otro UPDATE de una cita (asistencia, EPS, motivo) = OTRO', () => {
    expect(
      operacionHisDelEvento(
        cita('UPDATE', { status: 'SCHEDULED', scheduleSlotId: 's1', __old: { scheduleSlotId: 's1' } }),
      ),
    ).toBe('OTRO');
    expect(operacionHisDelEvento(cita('UPDATE', { status: 'SCHEDULED' }))).toBe('OTRO');
  });

  it('cupos y médicos = OTRO; un payload roto no revienta', () => {
    expect(operacionHisDelEvento({ entityType: 'SCHEDULE_SLOT', op: 'UPDATE', payload: {} })).toBe('OTRO');
    expect(operacionHisDelEvento({ entityType: 'DOCTOR', op: 'INSERT', payload: null })).toBe('OTRO');
    for (const payload of [null, undefined, 'x', 42, []]) {
      expect(operacionHisDelEvento(cita('UPDATE', payload))).toBe('OTRO');
    }
  });
});

describe('compuertasHis — cada operación con su interruptor, falla cerrado', () => {
  it('el envío al hospital abre solo citas nuevas y lo demás que no es cancelar ni cambiar', () => {
    expect(compuertasHis({ pushEnabled: true }, { cancelEnabled: false, rescheduleEnabled: false })).toEqual({
      agendar: true,
      cancelar: false,
      modificar: false,
      otros: true,
    });
  });

  it('cancelar y cambiar fecha salen con su interruptor aunque el envío esté apagado', () => {
    const c = compuertasHis({ pushEnabled: false }, { cancelEnabled: true, rescheduleEnabled: true });
    expect(c).toEqual({ agendar: false, cancelar: true, modificar: true, otros: false });
    expect(eventoPuedeSalir(cita('UPDATE', { status: 'CANCELLED' }), c)).toBe(true);
    expect(eventoPuedeSalir(cita('INSERT', {}), c)).toBe(false);
  });

  it('sin configuración, o con un valor que no sea true, no sale nada', () => {
    const c = compuertasHis(null, null);
    expect(algunaCompuertaAbierta(c)).toBe(false);
    expect(
      algunaCompuertaAbierta(
        compuertasHis({ pushEnabled: null }, { cancelEnabled: undefined, rescheduleEnabled: null }),
      ),
    ).toBe(false);
  });

  it('compuertaAbierta mira la compuerta de cada operación', () => {
    const c = { agendar: false, cancelar: true, modificar: false, otros: false };
    expect(compuertaAbierta('CANCELAR', c)).toBe(true);
    expect(compuertaAbierta('AGENDAR', c)).toBe(false);
    expect(compuertaAbierta('MODIFICAR', c)).toBe(false);
    expect(compuertaAbierta('OTRO', c)).toBe(false);
  });
});
