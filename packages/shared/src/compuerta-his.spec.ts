import {
  MENSAJE_OPERACION_APAGADA,
  algunaCompuertaAbierta,
  compuertaAbierta,
  compuertasHis,
  eventoPuedeSalir,
  operacionFrenadaDelError,
  operacionHisDelEvento,
} from './compuerta-his';

const cita = (op: string, payload: unknown) => ({
  entityType: 'APPOINTMENT',
  op,
  payload,
});

describe('operacionHisDelEvento — el mismo criterio que el motor del agente', () => {
  it('alta = AGENDAR', () => {
    expect(operacionHisDelEvento(cita('INSERT', {}))).toBe('AGENDAR');
  });

  it('🛡️ el BORRADO de una cita no es una cancelación para el hospital: nunca sale', () => {
    // Solo sale de purgar una clínica; eso jamás debe cancelar nada en el HIS.
    expect(operacionHisDelEvento(cita('DELETE', {}))).toBe('OTRO');
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

describe('compuertasHis — un interruptor por operación, falla cerrado', () => {
  it('cada operación con SU interruptor de Configuración', () => {
    expect(
      compuertasHis({ bookingEnabled: true, cancelEnabled: false, rescheduleEnabled: true }),
    ).toEqual({ agendar: true, cancelar: false, modificar: true, otros: false });
  });

  it('lo que no es agendar, cancelar ni cambiar de fecha nunca sale, ni con todo encendido', () => {
    const c = compuertasHis({ bookingEnabled: true, cancelEnabled: true, rescheduleEnabled: true });
    expect(c.otros).toBe(false);
    expect(eventoPuedeSalir({ entityType: 'SCHEDULE_SLOT', op: 'UPDATE', payload: {} }, c)).toBe(false);
    expect(eventoPuedeSalir(cita('DELETE', {}), c)).toBe(false);
  });

  it('cancelar sale con su interruptor aunque agendar esté apagado', () => {
    const c = compuertasHis({ bookingEnabled: false, cancelEnabled: true, rescheduleEnabled: false });
    expect(eventoPuedeSalir(cita('UPDATE', { status: 'CANCELLED' }), c)).toBe(true);
    expect(eventoPuedeSalir(cita('INSERT', {}), c)).toBe(false);
  });

  it('sin configuración, o con un valor que no sea true, no sale nada', () => {
    expect(algunaCompuertaAbierta(compuertasHis(null))).toBe(false);
    expect(
      algunaCompuertaAbierta(
        compuertasHis({ bookingEnabled: null, cancelEnabled: undefined, rescheduleEnabled: null }),
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

describe('operacionFrenadaDelError — el freno de la base, leído desde el error de Prisma', () => {
  it('reconoce cada operación frenada', () => {
    for (const op of ['AGENDAR', 'CANCELAR', 'MODIFICAR', 'REACTIVAR'] as const) {
      const e = new Error(
        `Invalid \`prisma.appointment.create()\` invocation: ... ERROR: AGENIA_OPERACION_APAGADA:${op}`,
      );
      expect(operacionFrenadaDelError(e)).toBe(op);
      expect(MENSAJE_OPERACION_APAGADA[op]).toBeTruthy();
    }
  });

  it('cualquier otro error no es el freno', () => {
    expect(operacionFrenadaDelError(new Error('Unique constraint failed'))).toBeNull();
    expect(operacionFrenadaDelError(null)).toBeNull();
    expect(operacionFrenadaDelError({ message: 'AGENIA_OPERACION_APAGADA:CANCELAR' })).toBeNull();
    expect(operacionFrenadaDelError('AGENIA_OPERACION_APAGADA:CANCELAR')).toBe('CANCELAR');
  });
});
