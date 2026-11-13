/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🏥 RESERVA DE AGENDA PARA LA ATENCIÓN PRESENCIAL (2026-11-13)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La clínica elige en Configuración › Asistente Virtual qué parte de la agenda
 * puede tomar el asistente (WhatsApp y Telegram); el resto queda para agendar
 * en el hospital (ventanilla o teléfono). Lo pidió el hospital: 80 % por el
 * asistente y 20 % para quien no tiene el chat.
 *
 *  - Es un TOPE DEL CHAT por MÉDICO y DÍA (en la zona de la clínica): con 80 %,
 *    el asistente tiene como mucho piso(capacidad × 80 %) citas vigentes de ese
 *    médico ese día. Con 20 cupos, 16; con 7, 5; con 1, ninguna.
 *  - CAPACIDAD = cupos libres + cupos con una cita vigente, de cualquier origen.
 *    Los cupos cerrados sin cita no cuentan (horas que el hospital no tiene).
 *  - CITAS DEL CHAT = vigentes con origen WHATSAPP o TELEGRAM. Las del panel y
 *    las del hospital son de la parte presencial.
 *  - Al BUSCAR cupos, los que otro paciente tiene apartados (mientras se
 *    registra, o mientras contesta una oferta de la lista de espera) cuentan
 *    como del chat; al RESERVAR, solo las citas.
 *  - Sin porcentaje (null) o con 100 % no hay reserva: nada cambia.
 *  - Solo el asistente: el personal y el hospital agendan sin tope, y las citas
 *    ya dadas no cambian.
 *
 * Puro: sin base de datos.
 */

export const RESERVA_PRESENCIAL = {
  MIN: 10,
  /** 100 % = sin reserva. */
  MAX: 100,
  /** Lo que ofrece el panel; un valor guardado fuera de la lista se muestra igual. */
  OPCIONES: [50, 60, 70, 75, 80, 85, 90, 95] as const,
} as const;

/**
 * Lo que venga de la BD: entero en [MIN, MAX), o null = sin reserva. Lo inválido
 * (0, negativo, NaN, texto) y el 100 % cuentan como sin reserva: un dato raro
 * nunca deja al asistente sin citas para ofrecer.
 */
export function normalizarParteDelChat(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return null;
  const entero = Math.round(n);
  if (entero < RESERVA_PRESENCIAL.MIN || entero >= RESERVA_PRESENCIAL.MAX) {
    return null;
  }
  return entero;
}

/**
 * Lo que llega del panel: null (sin reserva) o un entero en [MIN, MAX]. Aquí lo
 * inválido es un error, no «sin reserva»: quien quiso poner 80 % no debe quedar
 * sin reserva por un dato mal enviado.
 */
export function validarParteDelChat(
  valor: unknown,
): { ok: true; porcentaje: number | null } | { ok: false; error: string } {
  if (valor === null) return { ok: true, porcentaje: null };
  if (
    typeof valor !== 'number' ||
    !Number.isInteger(valor) ||
    valor < RESERVA_PRESENCIAL.MIN ||
    valor > RESERVA_PRESENCIAL.MAX
  ) {
    return {
      ok: false,
      error: `La parte de la agenda para el asistente debe ser un porcentaje entero entre ${RESERVA_PRESENCIAL.MIN} y ${RESERVA_PRESENCIAL.MAX}, o «Sin reserva».`,
    };
  }
  return { ok: true, porcentaje: valor };
}

/**
 * Cuántas citas del chat caben en un médico-día de esa capacidad: se redondea
 * hacia abajo (la reserva del hospital, hacia arriba). Sin reserva, toda la
 * capacidad.
 */
export function topeDelChat(
  capacidad: number,
  porcentaje: number | null,
): number {
  const cap = Number.isFinite(capacidad) ? Math.max(0, Math.floor(capacidad)) : 0;
  const pct = normalizarParteDelChat(porcentaje);
  if (pct === null) return cap;
  // Entero × entero: sin el error de 0,8 × 5 en coma flotante.
  return Math.floor((cap * pct) / 100);
}

/** Un médico y un día, como los cuenta la base. */
export interface MedicoDia {
  doctorId: string;
  /** 'YYYY-MM-DD' en la zona de la clínica. */
  dia: string;
  /** Cupos libres + cupos con una cita vigente. */
  capacidad: number;
  /** Citas vigentes del asistente (WHATSAPP, TELEGRAM). */
  chat: number;
  /** Cupos libres apartados por otro paciente del chat (solo al buscar). */
  apartados?: number;
}

/**
 * ¿El asistente ya no puede tomar otro cupo de este médico este día? Sin
 * reserva, nunca.
 */
export function chatEnElTope(
  medicoDia: Pick<MedicoDia, 'capacidad' | 'chat' | 'apartados'>,
  porcentaje: number | null,
): boolean {
  const pct = normalizarParteDelChat(porcentaje);
  if (pct === null) return false;
  const tomados =
    Math.max(0, medicoDia.chat || 0) + Math.max(0, medicoDia.apartados || 0);
  return tomados >= topeDelChat(medicoDia.capacidad, pct);
}

/** Los médico-días donde el asistente ya llegó a su tope. */
export function medicoDiasEnElTope<T extends MedicoDia>(
  filas: readonly T[],
  porcentaje: number | null,
): T[] {
  if (normalizarParteDelChat(porcentaje) === null) return [];
  return filas.filter((f) => chatEnElTope(f, porcentaje));
}

/** «Sin reserva» o «80 % para el asistente, 20 % para el hospital». */
export function textoParteDelChat(porcentaje: number | null): string {
  const pct = normalizarParteDelChat(porcentaje);
  if (pct === null) return 'Sin reserva';
  return `${pct} % para el asistente, ${100 - pct} % para el hospital`;
}
