import { SESSION_TTL } from '../chatbot/chatbot.constants';
import {
  ESPERA_SIN_CONFIRMAR_MS,
  VENTANA_PEDIDOS_MS,
  pedidosDeCancelarSinConfirmar,
  type FilaCajaNegra,
} from './cancelar-sin-confirmar';

/**
 * Pidió cancelar y no confirmó: qué pedidos del chat quedan sin el SÍ. Los casos
 * son los de la caja negra del 24 al 26 de octubre de 2026.
 */
describe('pedidosDeCancelarSinConfirmar', () => {
  const AHORA = new Date('2026-10-26T14:30:00.000Z');
  const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);
  const fila = (
    minutos: number,
    metadata: Record<string, unknown> | null,
    userMessage: string | null = 'x',
    whatsappId = '573000007882',
  ): FilaCajaNegra => ({
    whatsappId,
    createdAt: hace(minutos),
    userMessage,
    metadata,
  });
  const ofrecido = (
    minutos: number,
    id = 'apt-1',
    texto = 'Cancelar esta cita por favor',
  ) => fila(minutos, { step: 'CANCELAR_OFRECIDO', appointmentId: id }, texto);

  it('Laura: «Cancelar esta cita por favor» y nunca respondió → queda el pedido, con lo que escribió', () => {
    const r = pedidosDeCancelarSinConfirmar([ofrecido(2 * 24 * 60)], AHORA);
    expect(r).toEqual([
      {
        whatsappId: '573000007882',
        appointmentIds: ['apt-1'],
        ofrecidoEn: hace(2 * 24 * 60),
        mensaje: 'Cancelar esta cita por favor',
        despues: [],
      },
    ]);
  });

  it('se espera al menos lo que dura la sesión del chat: antes, el SÍ todavía cancela', () => {
    expect(ESPERA_SIN_CONFIRMAR_MS).toBeGreaterThanOrEqual(SESSION_TTL * 1000);
  });

  it('antes de una hora no se da por perdido: todavía puede responder SÍ', () => {
    const minutos = ESPERA_SIN_CONFIRMAR_MS / 60_000 - 1;
    expect(pedidosDeCancelarSinConfirmar([ofrecido(minutos)], AHORA)).toEqual(
      [],
    );
  });

  it('un pedido de hace más de tres días ya no se mira', () => {
    const minutos = VENTANA_PEDIDOS_MS / 60_000 + 1;
    expect(pedidosDeCancelarSinConfirmar([ofrecido(minutos)], AHORA)).toEqual(
      [],
    );
  });

  it.each([
    ['dijo NO', 'CANCELLATION_ABORTED'],
    ['se canceló', 'APPOINTMENT_CANCELLED'],
    ['quedó esperando al hospital', 'APPOINTMENT_CANCEL_PENDING_HIS'],
    [
      'el hospital no la aplicó (ya hay otro caso)',
      'APPOINTMENT_CANCEL_NOT_APPLIED_BY_HIS',
    ],
    ['cambió la fecha', 'APPOINTMENT_RESCHEDULED'],
    [
      'decidió mantenerla al no haber otra fecha',
      'MODIFY_NO_SLOTS_KEEP_APPOINTMENT',
    ],
  ])('si después %s, no hay pedido', (_caso, event) => {
    const r = pedidosDeCancelarSinConfirmar(
      [ofrecido(120), fila(119, { event }, 'Sí')],
      AHORA,
    );
    expect(r).toEqual([]);
  });

  it('si después confirmó su asistencia a ESA cita, la mantiene', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        ofrecido(120),
        fila(
          110,
          { step: 'RECORDATORIO_CONFIRMADO', appointmentId: 'apt-1' },
          'Sí asistiré',
        ),
      ],
      AHORA,
    );
    expect(r).toEqual([]);
  });

  it('confirmar OTRA cita no cierra el pedido de esta', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        ofrecido(120),
        fila(
          110,
          { step: 'RECORDATORIO_CONFIRMADO', appointmentId: 'apt-9' },
          'Gracias',
        ),
      ],
      AHORA,
    );
    expect(r.map((p) => p.appointmentIds)).toEqual([['apt-1']]);
  });

  it('Jazmín: lo que escribió después queda en el pedido, sin letras de menú ni cédulas', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        ofrecido(220, 'apt-1', 'Buenos días  Para cancelar la cita'),
        fila(219, { stage: 'CANCEL_CONFIRM' }, 'Muchas gracias'),
        fila(210, { step: 'SERVICE_MENU_SHOWN' }, 'Buen dia'),
        fila(209, { step: 'EPS_MENU_SHOWN' }, 'A'),
        fila(208, { step: 'LOOKUP_SHOWN' }, '1054913144'),
        fila(207, { step: 'LOOKUP_SHOWN' }, 'Yo ya tengo cita'),
        fila(206, null, 'Quiero confirmar'),
      ],
      AHORA,
    );
    expect(r[0].mensaje).toBe('Buenos días Para cancelar la cita');
    expect(r[0].despues).toEqual([
      'Muchas gracias',
      'Buen dia',
      'Yo ya tengo cita',
    ]);
  });

  it('cuenta el ÚLTIMO ofrecimiento: uno anterior que se cerró no deja pedido', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        ofrecido(300, 'apt-1'),
        fila(299, { event: 'CANCELLATION_ABORTED' }, 'No'),
        ofrecido(120, 'apt-2', 'No voy a poder ir'),
      ],
      AHORA,
    );
    expect(r.map((p) => [p.appointmentIds, p.mensaje])).toEqual([
      [['apt-2'], 'No voy a poder ir'],
    ]);
  });

  it('con varias citas sin elegir cuál: el pedido nombra todas', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        fila(
          120,
          { step: 'CANCELAR_ELEGIR_CITA', appointmentIds: ['apt-1', 'apt-2'] },
          'cancelar las citas',
        ),
      ],
      AHORA,
    );
    expect(r[0].appointmentIds).toEqual(['apt-1', 'apt-2']);
  });

  it('eligió la cita con una letra: el pedido es de esa, con las palabras con que lo pidió', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        fila(
          130,
          { step: 'CANCELAR_ELEGIR_CITA', appointmentIds: ['apt-1', 'apt-2'] },
          'no podemos ir',
        ),
        fila(
          129,
          { step: 'CANCEL_APPOINTMENT_SELECTED', appointmentId: 'apt-2' },
          'B',
        ),
      ],
      AHORA,
    );
    expect(r).toEqual([
      expect.objectContaining({
        appointmentIds: ['apt-2'],
        mensaje: 'no podemos ir',
      }),
    ]);
  });

  it('por el flujo de la cédula: el pedido sin mensaje (lo que escribió fue su cédula)', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        fila(
          120,
          { step: 'CANCEL_SHOWING_SINGLE', appointmentId: 'apt-1' },
          '1002593442',
        ),
      ],
      AHORA,
    );
    expect(r).toEqual([
      expect.objectContaining({ appointmentIds: ['apt-1'], mensaje: null }),
    ]);
  });

  it('cada número va por su lado', () => {
    const r = pedidosDeCancelarSinConfirmar(
      [
        ofrecido(120, 'apt-1'),
        fila(121, { event: 'CANCELLATION_ABORTED' }, 'No', '573000000002'),
        fila(
          120,
          { step: 'CANCELAR_OFRECIDO', appointmentId: 'apt-2' },
          'cancelar',
          '573000000002',
        ),
      ],
      AHORA,
    );
    // El NO del segundo número llegó ANTES de su ofrecimiento: no lo cierra.
    expect(r.map((p) => p.appointmentIds).sort()).toEqual([
      ['apt-1'],
      ['apt-2'],
    ]);
  });

  it('un ofrecimiento sin cita en su metadata no deja pedido', () => {
    expect(
      pedidosDeCancelarSinConfirmar(
        [fila(120, { step: 'CANCELAR_OFRECIDO' })],
        AHORA,
      ),
    ).toEqual([]);
  });

  it('sin ningún ofrecimiento de cancelar, nada', () => {
    expect(
      pedidosDeCancelarSinConfirmar(
        [
          fila(120, { step: 'SLOTS_OFFERED' }),
          fila(100, { event: 'APPOINTMENT_CANCELLED' }),
        ],
        AHORA,
      ),
    ).toEqual([]);
  });
});
