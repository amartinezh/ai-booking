/**
 * Formato canónico de fechas/horas para presentación al usuario.
 *
 * Por qué este módulo existe:
 * - El contenedor Docker corre en UTC (`docker-compose` no fija TZ todavía).
 * - Hay dos consumidores que mostraban hora UTC al paciente:
 *   1) El chatbot por WhatsApp (TTS y texto) — bug observado: el menú de
 *      slots se veía "03:00 p m" y el resumen leía "15:00" sin AM/PM,
 *      percibido como "otra fecha".
 *   2) El dashboard web (varias pantallas) — depende de la TZ del navegador.
 * - Los `toLocale*` sin `timeZone` explícito caen al TZ del proceso, lo que
 *   crea inconsistencia entre entornos.
 *
 * Regla general: **todas las funciones de presentación pasan por aquí**, con
 * `timeZone` explícito. Si en el futuro se añade soporte multi-tenant fuera de
 * Colombia, se pasa `opts.timeZone` (cargada de `Organization.timezone`).
 */

/** Zona horaria por defecto del producto (Colombia, sin DST). */
export const DEFAULT_TIMEZONE = 'America/Bogota';

/** Locale por defecto para textos del paciente / staff. */
const DEFAULT_LOCALE = 'es-CO';

export interface FormatOptions {
  /** IANA timezone, p.ej. "America/Bogota". Default = `DEFAULT_TIMEZONE`. */
  timeZone?: string;
  /** Locale BCP-47. Default = "es-CO". */
  locale?: string;
}

/**
 * Limpia "p. m." → "p m" (sin puntos) y colapsa espacios. ElevenLabs y otros
 * TTS leen mejor el sufijo sin puntos; visualmente sigue siendo claro.
 */
function cleanMeridiem(s: string): string {
  return s.replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fecha + hora larga, ideal para mensajes conversacionales y TTS:
 *   "miércoles, 3 de junio a las 03:00 p m"
 *
 * Usar en: resumen previo a confirmación, mensaje de cita confirmada,
 * recordatorios, menús de slots A) B) C), etc.
 */
export function formatAppointmentLong(
  date: Date | string,
  opts: FormatOptions = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const fecha = d.toLocaleDateString(locale, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const hora = cleanMeridiem(
    d.toLocaleTimeString(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  );
  return `${fecha} a las ${hora}`;
}

/**
 * Fecha + hora con día/mes ABREVIADOS, ideal para listados densos donde caben
 * varias citas (cancelación, reagendamiento):
 *   "lun, 3 jun, 03:00 p m"
 *
 * Mantiene formato 12h "p m" para evitar la asimetría con `formatAppointmentLong`.
 */
export function formatAppointmentCompact(
  date: Date | string,
  opts: FormatOptions = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const fecha = d.toLocaleDateString(locale, {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const hora = cleanMeridiem(
    d.toLocaleTimeString(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  );
  return `${fecha}, ${hora}`;
}

/**
 * Fecha corta numérica + hora 12h, para listados densos:
 *   "03/06/2026 03:00 p m"
 */
export function formatAppointmentShort(
  date: Date | string,
  opts: FormatOptions = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const fecha = d.toLocaleDateString(locale, {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const hora = cleanMeridiem(
    d.toLocaleTimeString(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  );
  return `${fecha} ${hora}`;
}

/**
 * Solo la fecha en formato largo: "miércoles, 3 de junio".
 */
export function formatDateOnly(
  date: Date | string,
  opts: FormatOptions = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  return d.toLocaleDateString(locale, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Solo la hora 12h limpia: "03:00 p m" (o "03:00:45 p m" con `withSeconds`).
 * Pasar `withSeconds: true` para gráficos / monitores donde el segundo importa.
 */
export function formatTimeOnly(
  date: Date | string,
  opts: FormatOptions & { withSeconds?: boolean } = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  return cleanMeridiem(
    d.toLocaleTimeString(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      ...(opts.withSeconds ? { second: '2-digit' as const } : {}),
      hour12: true,
    }),
  );
}

/**
 * Fecha corta sin hora: "03/06/2026".
 */
export function formatDateShort(
  date: Date | string,
  opts: FormatOptions = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  return d.toLocaleDateString(locale, {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
