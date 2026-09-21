/**
 * El alcance de un BOOKING_AGENT: la EPS y el médico que tiene asignados en su
 * `AgentProfile` (docs/PLAN_RASTREO_PACIENTE.md §12 #9).
 *
 * Vive en `@agenia/shared` porque la aplican los DOS lados: las acciones de la web y
 * la API (el recordatorio manual, §12 #10b). Dos copias de una regla de permisos es
 * una copia de más: la que se olvide de actualizar se convierte en el hueco.
 *
 * Es la MISMA regla con que el panel le lista las citas (`app/dashboard/page.tsx`:
 * `epsId` y `scheduleSlot.doctorId` forzados al de su perfil) y con que el rastreo
 * se las acota (`alcanceDeCitas`, `lib/rastreo/servicio.ts`). Una acción que
 * modifica una cita tiene que aplicarla también: la lista solo esconde botones, y
 * una pestaña vieja o una petición armada a mano llega igual a la acción.
 *
 *  · Sin perfil, o con un perfil sin EPS ni médico, el agente es GLOBAL (la lista de
 *    usuarios lo rotula "GLOBAL"): nada queda fuera.
 *  · Con EPS asignada, solo las citas de esa EPS. Una cita SIN EPS queda fuera: el
 *    panel filtra por `epsId` igual y tampoco se la lista.
 *  · Con médico asignado, solo las del cupo de ese médico.
 *  · Con las dos, hay que cumplir las dos.
 *
 * Los campos vacíos cuentan como "sin asignar" (el panel usa `||`, no `??`).
 */
export interface AlcanceAgente {
  epsId?: string | null;
  doctorId?: string | null;
}

/**
 * ¿La cita queda FUERA del alcance del agente?
 *
 * Falla CERRADO: con un alcance acotado, una cita de la que no se sabe la EPS o el
 * médico (una lectura que olvidó traer el campo) queda fuera. Nunca abre la puerta
 * por un dato que falta.
 */
export function citaFueraDeAlcance(
  alcance: AlcanceAgente | null | undefined,
  cita: { epsId: string | null; doctorId: string | null },
): boolean {
  if (!alcance) return false;
  if (alcance.epsId && cita.epsId !== alcance.epsId) return true;
  if (alcance.doctorId && cita.doctorId !== alcance.doctorId) return true;
  return false;
}
