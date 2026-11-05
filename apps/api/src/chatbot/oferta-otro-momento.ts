import {
  franjaDelCupo,
  interpretarOtroHorario,
  matchesHora,
} from '@agenia/shared';

/**
 * 🗓️ ¿La respuesta a una oferta de la lista de espera pide OTRO momento que el del
 * cupo? (2026-11-05)
 *
 * A una oferta del lunes 9 a la 1:00 p. m., una paciente contestó «Me sirve para
 * mañana viernes»: por «me sirve» se tomó como SÍ y se le agendó el lunes; ella la
 * canceló minutos después. Si nombra un día, una hora o una jornada que no es la del
 * cupo —o pide «otro día» u «otro horario»—, no es un SÍ a ESE cupo.
 *
 * Usa el mismo intérprete del menú de cupos (`interpretarOtroHorario`): si no
 * reconoce un día, una hora o una jornada con confianza, no pide otro momento.
 * Puro: sin base de datos ni Redis.
 */
export function pideOtroMomentoQueElCupo(
  texto: string | null | undefined,
  inicioDelCupo: Date,
  opts: { timeZone?: string; now?: Date } = {},
): boolean {
  const pedido = interpretarOtroHorario(texto, opts);
  if (!pedido) return false;
  // «Otro día», «otro horario»: no es ese.
  if (!pedido.fecha && !pedido.franja && !pedido.hora) return true;
  if (pedido.otroDia) return true;
  if (pedido.fecha) {
    const t = inicioDelCupo.getTime();
    if (t < pedido.fecha.desde.getTime() || t > pedido.fecha.hasta.getTime()) {
      return true;
    }
  }
  if (pedido.hora) {
    return !matchesHora(inicioDelCupo, pedido.hora, {
      timeZone: opts.timeZone,
    });
  }
  return (
    !!pedido.franja &&
    franjaDelCupo(inicioDelCupo, opts.timeZone) !== pedido.franja
  );
}
