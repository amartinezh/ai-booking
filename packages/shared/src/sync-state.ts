/**
 * El estado del envío de una cita al HIS, derivado de los eventos de su outbox.
 *
 * Vive en `@agenia/shared` porque lo lee más de una pieza y TODAS tienen que
 * clasificar igual (docs/PLAN_RASTREO_PACIENTE.md §13: «el vigilante y la pantalla
 * clasifican distinto»): el rastreo de paciente (web) y el vigilante de
 * excepciones (API). Es PURO: recibe filas ya leídas y devuelve datos.
 */
import type { EstadoSync } from './patient-trace';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface FilaOutbox {
  seq: bigint | string;
  op: string;
  createdAt: Date;
  deliveredAt: Date | null;
  attempts: number;
  deadLettered: boolean;
  nextAttemptAt: Date | null;
  lastError: string | null;
}

/**
 * El estado de TODOS los eventos de una cita, resumido en uno: el peor.
 *
 * Una cita tiene varios (el alta, luego un reagendamiento o una cancelación).
 * Basta uno rendido para que el hospital tenga la cita en un estado distinto al
 * de AgenIA, así que el orden es dead-letter > reintentando > en cola > entregado.
 * Sin ningún evento: el trigger solo registra eventos con el espejo ENCENDIDO,
 * de modo que una cita creada antes de activarlo (o con él apagado) no tiene.
 */
export function derivarSync(eventos: FilaOutbox[]): EstadoSync {
  if (eventos.length === 0) {
    return {
      estado: 'NO_EVENT',
      attempts: 0,
      lastError: null,
      creadoIso: null,
      oldestPendingIso: null,
      nextAttemptIso: null,
      deliveredAtIso: null,
      seq: null,
    };
  }

  const porFecha = [...eventos].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const creadoIso = iso(porFecha[0].createdAt);
  const pendientes = porFecha.filter((e) => !e.deliveredAt);

  const base = {
    creadoIso,
    oldestPendingIso: null as string | null,
    nextAttemptIso: null as string | null,
    deliveredAtIso: null as string | null,
    seq: null as string | null,
  };

  const rendido = pendientes.find((e) => e.deadLettered);
  if (rendido) {
    return {
      ...base,
      estado: 'DEAD_LETTER',
      attempts: rendido.attempts,
      lastError: rendido.lastError,
      seq: String(rendido.seq),
      oldestPendingIso: iso(rendido.createdAt),
    };
  }

  const reintentando = pendientes
    .filter((e) => e.attempts > 0)
    .sort((a, b) => b.attempts - a.attempts)[0];
  if (reintentando) {
    return {
      ...base,
      estado: 'RETRYING',
      attempts: reintentando.attempts,
      lastError: reintentando.lastError,
      nextAttemptIso: iso(reintentando.nextAttemptAt),
      oldestPendingIso: iso(pendientes[0].createdAt),
    };
  }

  if (pendientes.length > 0) {
    return {
      ...base,
      estado: 'PENDING',
      attempts: 0,
      lastError: null,
      oldestPendingIso: iso(pendientes[0].createdAt),
    };
  }

  const entregadoEn = porFecha
    .map((e) => e.deliveredAt!.getTime())
    .sort((a, b) => b - a)[0];
  return {
    ...base,
    estado: 'DELIVERED',
    attempts: 0,
    lastError: null,
    deliveredAtIso: new Date(entregadoEn).toISOString(),
  };
}
