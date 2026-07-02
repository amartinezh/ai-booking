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

/** Componentes de fecha de pared (año/mes/día) en una zona horaria. */
function wallDateParts(
  date: Date,
  timeZone: string,
): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day) };
}

/** Diferencia en días calendario entre dos fechas de pared (b − a). */
function dayDiff(
  a: { y: number; mo: number; d: number },
  b: { y: number; mo: number; d: number },
): number {
  const ua = Date.UTC(a.y, a.mo - 1, a.d);
  const ub = Date.UTC(b.y, b.mo - 1, b.d);
  return Math.round((ub - ua) / 86_400_000);
}

/**
 * Etiqueta del día en lenguaje HABLADO, relativa a hoy:
 *   0 → "hoy", 1 → "mañana", 2 → "pasado mañana",
 *   resto → "el miércoles 3 de junio".
 *
 * Pensada para TTS: no incluye hora (usar `formatAppointmentSpoken` para el
 * combo día + hora). `now` es inyectable para tests deterministas.
 */
export function formatSpokenDayLabel(
  date: Date | string,
  opts: FormatOptions & { now?: Date } = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const now = opts.now ?? new Date();

  const diff = dayDiff(wallDateParts(now, tz), wallDateParts(d, tz));
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === 2) return 'pasado mañana';

  const fecha = d.toLocaleDateString(locale, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  // "miércoles, 3 de junio" → "el miércoles 3 de junio" (la coma suena a pausa).
  return `el ${fecha.replace(',', '')}`;
}

/**
 * Hora en lenguaje HABLADO natural: "3 de la tarde", "9 y media de la mañana",
 * "mediodía". Evita el "cero tres cero cero" que produce leer "03:00".
 */
export function formatSpokenTime(
  date: Date | string,
  opts: FormatOptions = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour24 = map.hour === '24' ? 0 : Number(map.hour);
  const minute = Number(map.minute);

  if (hour24 === 12 && minute === 0) return 'mediodía';
  if (hour24 === 0 && minute === 0) return 'medianoche';

  const hour12 = hour24 % 12 || 12;
  const franja =
    hour24 < 12
      ? 'de la mañana'
      : hour24 === 12
        ? 'del mediodía'
        : hour24 <= 18
          ? 'de la tarde'
          : 'de la noche';

  let mins = '';
  if (minute === 30) mins = ' y media';
  else if (minute === 15) mins = ' y cuarto';
  else if (minute !== 0) mins = ` y ${minute}`;

  return `${hour12}${mins} ${franja}`;
}

/**
 * Fecha + hora en lenguaje HABLADO, ideal para TTS (menú de cupos por voz):
 *   "mañana a las 3 de la tarde", "el martes 9 de junio a las 9 de la mañana".
 */
export function formatAppointmentSpoken(
  date: Date | string,
  opts: FormatOptions & { now?: Date } = {},
): string {
  const dia = formatSpokenDayLabel(date, opts);
  const hora = formatSpokenTime(date, opts);
  // Concordancia: "al mediodía"/"a la medianoche", "a la 1", "a las 3".
  const conector =
    hora === 'mediodía'
      ? 'al'
      : hora === 'medianoche'
        ? 'a la'
        : /^1\b/.test(hora)
          ? 'a la'
          : 'a las';
  return `${dia} ${conector} ${hora}`;
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
