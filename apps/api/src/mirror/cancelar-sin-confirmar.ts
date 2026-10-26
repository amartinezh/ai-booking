/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🙋 PIDIÓ CANCELAR Y NO CONFIRMÓ (2026-10-26)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El sábado 24 una paciente escribió «Cancelar esta cita por favor»; el asistente
 * le mostró la cita y le preguntó si la cancelaba, y ella nunca respondió. La cita
 * siguió en pie, el cupo ocupado, y nadie se enteró hasta revisar la caja negra.
 *
 * Aquí se decide, con la caja negra del chat (`InteractionLog`) de cada número,
 * qué pedidos de cancelar quedaron sin el SÍ: el vigilante deja un caso en la
 * Bandeja por cada cita. AgenIA no cancela nada: una persona confirma con el
 * paciente.
 *
 * Un pedido queda sin confirmar cuando:
 *   · el ÚLTIMO ofrecimiento de cancelar a ese número pasó hace más de una hora (lo
 *     que dura la sesión: después, el SÍ ya no cancela nada) y menos de tres días;
 *   · después no hubo un NO, ni la cancelación, ni un cambio de fecha (de esa u
 *     otra cita: el paciente resolvió por su cuenta);
 *   · y, por cita, después no confirmó su asistencia a esa cita.
 *
 * Que la cita siga vigente y no haya pasado lo mira el vigilante en la base.
 *
 * Puro: sin base de datos. Los nombres de los pasos y eventos son los que escribe
 * el chatbot en `metadata` (`chatbot.service.ts`).
 */

/** Pasos en los que el asistente pregunta si cancela (o cuál cancela). */
export const PASOS_QUE_OFRECEN_CANCELAR = [
  // Tras un recordatorio o sus citas próximas: «no puedo ir», «cancelar cita».
  'CANCELAR_OFRECIDO',
  'CANCELAR_ELEGIR_CITA',
  // El flujo de siempre: cédula y, si tiene varias, la letra.
  'CANCEL_SHOWING_SINGLE',
  'CANCEL_APPOINTMENT_SELECTED',
] as const;

/** En estos el paciente lo pidió con sus palabras; en los otros escribió su cédula o una letra. */
const PASOS_CON_SU_PEDIDO: ReadonlySet<string> = new Set([
  'CANCELAR_OFRECIDO',
  'CANCELAR_ELEGIR_CITA',
]);

/** Lo que cierra el pedido: dijo NO, se canceló (o espera al hospital), o cambió de fecha. */
const EVENTOS_QUE_LO_CIERRAN: ReadonlySet<string> = new Set([
  'CANCELLATION_ABORTED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_CANCEL_PENDING_HIS',
  'APPOINTMENT_CANCEL_NOT_APPLIED_BY_HIS',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_RESCHEDULE_PENDING_HIS',
  'MODIFY_NO_SLOTS_KEEP_APPOINTMENT',
]);

/** Confirmó su asistencia a una cita: esa la mantiene. */
const PASO_CONFIRMO_LA_CITA = 'RECORDATORIO_CONFIRMADO';

/** El SÍ se espera lo que dura la sesión (`SESSION_TTL`, una hora). */
export const ESPERA_SIN_CONFIRMAR_MS = 60 * 60_000;

/** Hasta cuándo atrás se buscan pedidos: si el vigilante estuvo detenido, los recoge. */
export const VENTANA_PEDIDOS_MS = 3 * 24 * 60 * 60_000;

/** Cuántos mensajes de después se guardan en el caso, y de qué largo. */
const MAX_MENSAJES_DESPUES = 3;
const MAX_LARGO_MENSAJE = 150;

export interface FilaCajaNegra {
  whatsappId: string;
  createdAt: Date;
  userMessage: string | null;
  metadata: unknown;
}

export interface PedidoSinConfirmar {
  whatsappId: string;
  appointmentIds: string[];
  /** Cuándo se le preguntó por última vez si cancelaba. */
  ofrecidoEn: Date;
  /** Lo que escribió al pedirlo, si fue con sus palabras (no su cédula ni una letra). */
  mensaje: string | null;
  /** Lo que escribió después, sin letras ni números sueltos. */
  despues: string[];
}

const leer = (metadata: unknown): Record<string, unknown> =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const pasoDe = (f: FilaCajaNegra): string | null => {
  const step = leer(f.metadata).step;
  return typeof step === 'string' ? step : null;
};

const eventoDe = (f: FilaCajaNegra): string | null => {
  const event = leer(f.metadata).event;
  return typeof event === 'string' ? event : null;
};

const ofreceCancelar = (f: FilaCajaNegra): boolean =>
  (PASOS_QUE_OFRECEN_CANCELAR as readonly string[]).includes(pasoDe(f) ?? '');

/** Las citas que nombra una fila: `appointmentId` o `appointmentIds`. */
const citasDe = (f: FilaCajaNegra): string[] => {
  const m = leer(f.metadata);
  const ids = Array.isArray(m.appointmentIds)
    ? m.appointmentIds.filter((x): x is string => typeof x === 'string')
    : [];
  return typeof m.appointmentId === 'string'
    ? [...new Set([m.appointmentId, ...ids])]
    : [...new Set(ids)];
};

/** Un mensaje que dice algo: ni una letra de menú, ni una cédula, ni vacío. */
const diceAlgo = (t: string): boolean =>
  t.length >= 3 && !/^[a-z]\)?$/i.test(t) && !/^[\d\s.-]+$/.test(t);

const recortar = (t: string): string =>
  t.length > MAX_LARGO_MENSAJE ? `${t.slice(0, MAX_LARGO_MENSAJE)}…` : t;

export function pedidosDeCancelarSinConfirmar(
  filas: readonly FilaCajaNegra[],
  ahora: Date,
): PedidoSinConfirmar[] {
  const porNumero = new Map<string, FilaCajaNegra[]>();
  for (const f of filas) {
    const lista = porNumero.get(f.whatsappId) ?? [];
    lista.push(f);
    porNumero.set(f.whatsappId, lista);
  }

  const pedidos: PedidoSinConfirmar[] = [];
  for (const [whatsappId, delNumero] of porNumero) {
    const conversacion = [...delNumero].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    let i = conversacion.length - 1;
    while (i >= 0 && !ofreceCancelar(conversacion[i])) i--;
    if (i < 0) continue;

    const oferta = conversacion[i];
    const edad = ahora.getTime() - oferta.createdAt.getTime();
    if (edad < ESPERA_SIN_CONFIRMAR_MS || edad > VENTANA_PEDIDOS_MS) continue;

    const despues = conversacion.slice(i + 1);
    if (despues.some((f) => EVENTOS_QUE_LO_CIERRAN.has(eventoDe(f) ?? ''))) {
      continue;
    }
    const confirmadas = new Set(
      despues
        .filter((f) => pasoDe(f) === PASO_CONFIRMO_LA_CITA)
        .flatMap(citasDe),
    );
    const appointmentIds = citasDe(oferta).filter((id) => !confirmadas.has(id));
    if (appointmentIds.length === 0) continue;

    // Lo que escribió al pedirlo: el ofrecimiento con sus palabras más cercano
    // (la letra con la que eligió la cita no dice nada), sin pasar de un pedido
    // anterior ya cerrado.
    let mensaje: string | null = null;
    for (let j = i; j >= 0; j--) {
      const f = conversacion[j];
      if (EVENTOS_QUE_LO_CIERRAN.has(eventoDe(f) ?? '')) break;
      if (!ofreceCancelar(f)) continue;
      if (PASOS_CON_SU_PEDIDO.has(pasoDe(f) ?? '')) {
        const t = (f.userMessage ?? '').replace(/\s+/g, ' ').trim();
        mensaje = t ? recortar(t) : null;
        break;
      }
    }

    pedidos.push({
      whatsappId,
      appointmentIds,
      ofrecidoEn: oferta.createdAt,
      mensaje,
      despues: despues
        .map((f) => (f.userMessage ?? '').replace(/\s+/g, ' ').trim())
        .filter(diceAlgo)
        .slice(0, MAX_MENSAJES_DESPUES)
        .map(recortar),
    });
  }
  return pedidos;
}
