/**
 * ══════════════════════════════════════════════════════════════════════════
 * ANTICIPACIÓN MÍNIMA DEL RECORDATORIO AUTOMÁTICO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * POR QUÉ EXISTE (2026-10-17)
 * El hospital agenda muchas citas de medicina general el mismo día, minutos
 * antes: el paciente la pide en la ventanilla o por teléfono y ya está en el
 * hospital o en camino. El cron las veía entrar y les mandaba el recordatorio
 * enseguida —29 de 151 con menos de una hora de anticipación, una a 4 minutos
 * de la cita—, con su «si no puede asistir, responda *cancelar cita*». A esa
 * altura no le sirve a nadie.
 *
 * Con esto, el recordatorio AUTOMÁTICO no sale si a la cita le faltan menos de
 * N minutos (`OrganizationSettings.reminderMinLeadMinutes`, default 60; lo edita
 * el administrador en /dashboard/configuracion). 0 = sin mínimo, como antes.
 *
 * La cita no se marca como recordada: si se mueve a una hora más lejana, el
 * recordatorio vuelve a poder salir. El botón de recordatorio manual de la
 * agenda no se afecta: lo dispara una persona que decide.
 */

export const ANTICIPACION_RECORDATORIO = {
  /** Lo que aplica una clínica que nunca tocó el ajuste. */
  DEFAULT_MIN: 60,
  MIN: 0,
  /** Más de 12 h dejaría sin recordatorio a casi todas las citas del día siguiente temprano. */
  MAX: 720,
  /** Lo que ofrece el panel. */
  OPCIONES: [0, 15, 30, 45, 60, 90, 120, 180, 240] as readonly number[],
} as const;

/**
 * Minutos enteros dentro de [MIN, MAX]. 0 es válido («sin mínimo»); cualquier
 * cosa inválida (null, NaN, negativo, texto) cae al default.
 */
export function normalizarAnticipacionRecordatorio(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') {
    return ANTICIPACION_RECORDATORIO.DEFAULT_MIN;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 0) return ANTICIPACION_RECORDATORIO.DEFAULT_MIN;
  return Math.min(ANTICIPACION_RECORDATORIO.MAX, Math.round(n));
}

/** ¿A la cita le faltan menos de `minutos`? (con 0, nunca). */
export function citaDemasiadoCercaParaRecordar(
  inicio: Date,
  ahora: Date,
  minutos: number,
): boolean {
  const minimo = normalizarAnticipacionRecordatorio(minutos);
  if (minimo === 0) return false;
  return inicio.getTime() - ahora.getTime() < minimo * 60_000;
}

/** «1 hora», «30 minutos», «1 h 30 min», «sin mínimo»: para el panel. */
export function textoAnticipacion(minutos: number): string {
  const m = normalizarAnticipacionRecordatorio(minutos);
  if (m === 0) return 'sin mínimo';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} minutos`;
  if (r === 0) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h} h ${r} min`;
}
