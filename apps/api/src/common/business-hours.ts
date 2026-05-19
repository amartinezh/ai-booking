/**
 * Cálculo de "horas hábiles" en zona horaria America/Bogota.
 *
 * Reglas:
 *  - Sábado y domingo NO cuentan: sus horas se ignoran.
 *  - Lunes a viernes cuentan completas (00:00 → 24:00).
 *  - Bogotá vive en UTC-5 todo el año (Colombia no observa DST).
 *
 * Todo el cálculo se hace en "tiempo Bogotá" — internamente representado
 * como un Date al que le restamos el offset de 5h. Al final convertimos
 * de vuelta a UTC para que Prisma reciba un timestamp comparable contra
 * `scheduleSlot.startTime` (que se guarda como TIMESTAMP en UTC).
 *
 * Sin dependencias externas a propósito: la lógica es lo bastante simple
 * para no justificar `date-fns-tz` y mantenemos el bundle de NestJS liviano.
 */

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function isWeekendUTC(d: Date): boolean {
  // getUTCDay sobre un Date que internamente representa "Bogotá" devuelve
  // el día-de-semana correcto en Bogotá porque ya restamos el offset.
  const day = d.getUTCDay();
  return day === 0 /* domingo */ || day === 6 /* sábado */;
}

function utcToBogota(date: Date): Date {
  return new Date(date.getTime() - BOGOTA_OFFSET_MS);
}

function bogotaToUtc(bogotaDate: Date): Date {
  return new Date(bogotaDate.getTime() + BOGOTA_OFFSET_MS);
}

/**
 * Suma (o resta) `hours` horas hábiles a `from`, saltándose sábados y domingos.
 *
 * Ejemplos (todos en hora Bogotá):
 *   addBusinessHours(viernes 10:00, +24)  → lunes 10:00
 *   addBusinessHours(lunes 10:00, -24)    → viernes 10:00
 *   addBusinessHours(sábado 12:00, +1)    → lunes 01:00 (skip el fin de semana)
 *   addBusinessHours(lunes 00:30, -1)     → viernes 23:30
 *
 * @param from   Fecha de referencia (UTC).
 * @param hours  Cantidad de horas hábiles a sumar. Puede ser negativa.
 * @returns      Fecha resultante en UTC.
 */
export function addBusinessHours(from: Date, hours: number): Date {
  if (!Number.isFinite(hours) || hours === 0) return new Date(from);

  const direction = hours > 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(hours));

  const cursor = utcToBogota(from);

  while (remaining > 0) {
    cursor.setUTCHours(cursor.getUTCHours() + direction);

    if (isWeekendUTC(cursor)) {
      // Saltamos los días enteros de sábado/domingo en la misma dirección.
      // La hora-del-día se conserva: el bloque del fin de semana no consume
      // horas hábiles del contador `remaining`.
      do {
        cursor.setUTCDate(cursor.getUTCDate() + direction);
      } while (isWeekendUTC(cursor));
    }

    remaining -= 1;
  }

  return bogotaToUtc(cursor);
}

/**
 * Calcula la ventana que debe consultar el cron de recordatorios:
 *
 *   targetThreshold = addBusinessHours(now, N)
 *
 * Las citas cuyo `startTime` esté en `(now, targetThreshold]` ya entraron
 * en la zona de "recordar". El estado `reminderSentAt = NULL` asegura
 * idempotencia para que no se envíe dos veces aunque el cron corra varias
 * veces dentro de la ventana.
 */
export function reminderWindow(now: Date, businessHoursBefore: number): {
  from: Date;
  to: Date;
} {
  return {
    from: now,
    to: addBusinessHours(now, businessHoursBefore),
  };
}

/**
 * Formatea una fecha UTC para presentar al paciente en zona Bogotá.
 * Ej: "lunes 19 de mayo, 10:00 a. m.".
 */
export function formatForPatient(utcDate: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Bogota',
  }).format(utcDate);
}
