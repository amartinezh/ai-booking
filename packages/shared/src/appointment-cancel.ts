/**
 * ══════════════════════════════════════════════════════════════════════════
 * QUIÉN Y CUÁNDO CANCELÓ UNA CITA (`Appointment.metaLog`)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Appointment` no tiene `updatedAt` ni un campo de cancelación, así que lo
 * único donde cabe "quién canceló y cuándo" es `metaLog` (Json). El hospital ya
 * lo usaba: cuando cancela desde el HIS, el espejo escribe
 * `{ cancelledBy: 'MIRROR', reason, observations, eventId }`. El personal que
 * cancelaba desde el panel NO dejaba nada, y en una reclamación ("yo no cancelé
 * esa cita") no había forma de saber si fue el paciente, el hospital o alguien
 * de la clínica (docs/PLAN_RASTREO_PACIENTE.md, Fase 1, hallazgo).
 *
 * Vive en `@agenia/shared` para que la acción que ESCRIBE la constancia (web) y
 * la pantalla de rastreo que la LEE compartan las mismas claves: una errata en
 * una de las dos partes dejaría cancelaciones "sin rastro" sin que ningún test
 * unitario lo viera.
 *
 * El paciente que cancela por WhatsApp NO escribe aquí: su cancelación queda
 * en `InteractionLog` (`metadata.event = 'APPOINTMENT_CANCELLED'`).
 */

/** Valores de `metaLog.cancelledBy`. `MIRROR` lo escribe la API; `STAFF`, el panel. */
export const CANCELADA_POR = {
  MIRROR: 'MIRROR',
  STAFF: 'STAFF',
} as const;

type Json = string | number | boolean | null | Json[] | { [clave: string]: Json };

/** Lo que el rastreo lee de una cancelación hecha desde el panel del personal. */
export interface CancelacionPersonal {
  /** `User.id` de quien canceló. Se guarda el id, no el correo: el correo se resuelve al mostrarlo. */
  userId: string | null;
  role: string | null;
  /** Cuándo, en ISO. `null` si la constancia no trae una fecha válida. */
  atIso: string | null;
}

function esObjetoPlano(valor: unknown): valor is Record<string, Json> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * El `metaLog` con la constancia de una cancelación del personal.
 *
 * Conserva lo que la cita ya tuviera en `metaLog` (hoy nada más escribe ahí en
 * una cita vigente, pero el campo es libre y pisarlo por completo sería
 * destruir datos ajenos) y agrega las claves de la constancia encima.
 *
 * `at` entra como parámetro para que la función sea pura y se pueda probar sin
 * reloj; quien la llama pasa `new Date()`.
 */
export function armarMetaLogCancelacionPersonal(
  previo: unknown,
  quien: { userId: string; role: string; at: Date },
): Record<string, Json> {
  return {
    ...(esObjetoPlano(previo) ? previo : {}),
    cancelledBy: CANCELADA_POR.STAFF,
    cancelledByUserId: quien.userId,
    cancelledByRole: quien.role,
    cancelledAt: quien.at.toISOString(),
  };
}

/**
 * La constancia de una cancelación del personal, o `null` si el `metaLog` no es
 * de una (no existe, lo escribió el espejo, o no es un objeto).
 *
 * Tolerante a lo que venga: es un campo Json libre y el rastreo nunca debe
 * fallar por un `metaLog` raro. Una fecha ilegible cae a `null`, no a "ahora".
 */
export function leerCancelacionPersonal(
  metaLog: unknown,
): CancelacionPersonal | null {
  if (!esObjetoPlano(metaLog) || metaLog.cancelledBy !== CANCELADA_POR.STAFF) {
    return null;
  }
  const texto = (v: Json | undefined) =>
    typeof v === 'string' && v.trim() ? v : null;
  const cuando = texto(metaLog.cancelledAt);
  return {
    userId: texto(metaLog.cancelledByUserId),
    role: texto(metaLog.cancelledByRole),
    atIso:
      cuando && !Number.isNaN(Date.parse(cuando))
        ? new Date(cuando).toISOString()
        : null,
  };
}
