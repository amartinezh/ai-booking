/**
 * Wrapper de presentación de fechas para el frontend (Next.js).
 *
 * Re-exporta los helpers canónicos de `@agenia/shared` para que el código
 * del dashboard nunca llame `toLocale*` directamente y termine usando la TZ
 * del navegador (variable) en vez de la de la organización (estable).
 *
 * Si en el futuro el frontend recibe la `Organization.timezone` desde el
 * backend, este archivo es el lugar para leer un contexto/hook y pasarla a
 * todos los helpers como `opts.timeZone`.
 */
export {
  DEFAULT_TIMEZONE,
  formatAppointmentLong,
  formatAppointmentCompact,
  formatAppointmentShort,
  formatDateOnly,
  formatTimeOnly,
  formatDateShort,
} from '@agenia/shared';
export type { FormatOptions } from '@agenia/shared';
