import type { PrismaClient } from '@agenia/database';

/**
 * El alcance de un BOOKING_AGENT y de un DOCTOR sobre las citas.
 *
 * La regla PURA (`citaFueraDeAlcance`) vive en `@agenia/shared`, porque la API
 * también la aplica. Aquí queda lo que depende de esta aplicación: la sesión de
 * Next y la lectura de los perfiles.
 */
import type { AlcanceAgente } from '@agenia/shared';

export { citaFueraDeAlcance } from '@agenia/shared';
export type { AlcanceAgente } from '@agenia/shared';

// ─────────────────────────────────────────────────────────────
// Quién puede actuar sobre una cita, y con qué alcance
// ─────────────────────────────────────────────────────────────

/**
 * Los roles que operan la agenda de la clínica. Es la MISMA lista que deja entrar
 * la pantalla de agendamiento (`app/dashboard/agendamiento/page.tsx`): sin ella,
 * una acción de servidor queda abierta a cualquier sesión de la clínica —
 * incluida la de un PACIENTE, que llega igual con el id de la acción.
 * SUPER_ADMIN no está: el middleware lo saca de `/dashboard`.
 */
export const ROLES_AGENDA = ['ORG_ADMIN', 'DOCTOR', 'BOOKING_AGENT'] as const;

export type RolAgenda = (typeof ROLES_AGENDA)[number];

export function puedeOperarAgenda(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_AGENDA as readonly string[]).includes(rol);
}

type DbAlcance = Pick<PrismaClient, 'agentProfile' | 'doctorProfile'>;

/**
 * El alcance con el que ESTE usuario puede actuar sobre citas, que es exactamente el
 * mismo con el que su pantalla se las lista:
 *
 *   · BOOKING_AGENT → la EPS y el médico de su `AgentProfile`;
 *   · DOCTOR        → su propia agenda (el `id` de su `DoctorProfile`);
 *   · ORG_ADMIN / SUPER_ADMIN → `null`, sin acotar.
 *
 * No inventa una política nueva: hace que la acción EXIJA lo que la pantalla ya
 * insinúa. Una lista solo esconde botones; la acción llega igual desde una pestaña
 * vieja o una petición armada a mano.
 *
 * ⚠️ Un BOOKING_AGENT sin perfil, o un DOCTOR sin `DoctorProfile`, quedan SIN acotar
 * — es lo que hacen hoy sus pantallas (`agentProfile?.epsId || undefined`), así que
 * acotarlos aquí les mostraría citas que no podrían tocar. Que un DOCTOR exista sin
 * `DoctorProfile` es una inconsistencia de datos, y se trata como tal (ver §12 #11
 * del plan del rastreo), no callándola en esta capa.
 *
 * Si el perfil no se puede leer, esta función LANZA: quien la llama responde con
 * error y no actúa (falla cerrado).
 */
export async function alcanceDeLaSesion(
  db: DbAlcance,
  sesion: { role: string; userId: string },
): Promise<AlcanceAgente | null> {
  if (sesion.role === 'BOOKING_AGENT') {
    const perfil = await db.agentProfile.findUnique({
      where: { userId: sesion.userId },
      select: { epsId: true, doctorId: true },
    });
    return { epsId: perfil?.epsId || null, doctorId: perfil?.doctorId || null };
  }
  if (sesion.role === 'DOCTOR') {
    const perfil = await db.doctorProfile.findUnique({
      where: { userId: sesion.userId },
      select: { id: true },
    });
    return { epsId: null, doctorId: perfil?.id || null };
  }
  return null;
}

export const MSG_FUERA_DE_ALCANCE =
  'Esta cita está fuera de su alcance (EPS o médico asignados).';
export const MSG_SIN_PERMISO_AGENDA = 'No tiene permisos para operar la agenda.';
