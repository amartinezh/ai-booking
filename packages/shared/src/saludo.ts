/**
 * Saludo según la hora, en la zona horaria de la clínica.
 *
 * POR QUE EXISTE
 * El recordatorio decía «Buenos días» fijo en el código. El cron corre cada
 * 15 minutos durante todo el día, así que la mayoría de los recordatorios
 * saludaban mal: en la campaña E2E del 2026-09-22 llegó uno a las 2:21 p. m.
 * dando los buenos días. Es lo PRIMERO que lee el paciente, y es justo el
 * detalle que hace que un mensaje se sienta de máquina.
 *
 * ⚠️ La hora hay que sacarla en la zona de la clínica, no en la del
 * contenedor: en UTC, las 2 de la tarde en Colombia son las 7 de la noche y
 * el saludo se iría a «Buenas noches». Por eso `timeZone` tiene default
 * 'America/Bogota' y se puede sobrescribir por organización, igual que en los
 * formateadores de fecha (ver CLAUDE.md).
 */

export type Saludo = 'Buenos días' | 'Buenas tardes' | 'Buenas noches';

export interface SaludoOptions {
  /** Zona de la clínica. `Organization.timezone` cuando exista. */
  timeZone?: string;
}

/**
 * Cortes en hora local:
 *   00:00–11:59 → Buenos días
 *   12:00–18:59 → Buenas tardes
 *   19:00–23:59 → Buenas noches
 *
 * Son los de uso corriente en Colombia. La tarde empieza a las 12 en punto
 * (no a la 1) y la noche a las 7, no al anochecer real, que cambia con el mes
 * y no se puede saber desde aquí.
 */
export function saludoPorHora(
  fecha: Date = new Date(),
  opts: SaludoOptions = {},
): Saludo {
  const hora = horaLocal(fecha, opts.timeZone ?? 'America/Bogota');
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Hora (0-23) de esa fecha en esa zona.
 *
 * Con `formatToParts` y `hourCycle: 'h23'` en vez de `toLocaleTimeString`:
 * devuelve el número ya partido, sin depender de cómo el locale arme la
 * cadena — y 'h23' evita que la medianoche salga como 24.
 */
function horaLocal(fecha: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(fecha);

  const hora = partes.find((p) => p.type === 'hour')?.value;
  return hora ? Number(hora) : fecha.getUTCHours();
}
