/**
 * Quién puede hacer qué en el rastreo de paciente
 * (docs/PLAN_RASTREO_PACIENTE.md §5). Una sola tabla, un solo lugar.
 *
 * La regla de oro es la de todo el repo: el tenant SALE DEL TOKEN, nunca del
 * cliente. La única excepción es SUPER_ADMIN, que no pertenece a ninguna
 * clínica y por eso elige una — y esa elección se valida contra la base antes
 * de usarse. Un SUPER_ADMIN cruzando organizaciones en una sola búsqueda no
 * existe: contradice el aislamiento por tenant ya decidido para la identidad
 * de WhatsApp.
 */
import type { PrismaClient } from '@agenia/database';
import type { SessionPayload } from '../session';

export type RolRastreo = SessionPayload['role'];

/** Cuánto de la conversación con el bot ve el rol. */
export type NivelConversacion = 'NINGUNA' | 'RESUMEN' | 'TEXTO';

export interface PermisosRastreo {
  buscar: boolean;
  /** DOCTOR: solo pacientes con los que tiene una cita suya (misma regla que `TenantRbacGuard`). */
  soloConRelacionTerapeutica: boolean;
  /** RESUMEN = hechos (cuántos mensajes, cómo terminó); TEXTO = además lo que se dijeron. */
  conversacion: NivelConversacion;
  /** Estado del envío de cada cita al HIS y salud del agente. */
  verSync: boolean;
  /** `seq` de los eventos y el botón de reprocesar (solo quien ya puede hacerlo en el panel del espejo). */
  verInternos: boolean;
  /** Investigar una cita que el hospital agendó (escenario B). Necesita ver el sync. */
  modoB: boolean;
  /** La bitácora de consultas de la clínica. */
  verConsultas: boolean;
  /** BOOKING_AGENT: sus citas visibles se acotan a la EPS y al médico que tiene asignados. */
  aplicaScopeAgente: boolean;
}

const NADA: PermisosRastreo = {
  buscar: false,
  soloConRelacionTerapeutica: false,
  conversacion: 'NINGUNA',
  verSync: false,
  verInternos: false,
  modoB: false,
  verConsultas: false,
  aplicaScopeAgente: false,
};

/**
 * La matriz de §5. GENERAL_OBSERVER y PATIENT no aparecen: quedan en `NADA`,
 * igual que cualquier rol futuro (falla cerrado, como `TenantRbacGuard`).
 */
const MATRIZ: Partial<Record<RolRastreo, PermisosRastreo>> = {
  ORG_ADMIN: {
    buscar: true,
    soloConRelacionTerapeutica: false,
    conversacion: 'TEXTO',
    verSync: true,
    verInternos: true,
    modoB: true,
    verConsultas: true,
    aplicaScopeAgente: false,
  },
  BOOKING_AGENT: {
    buscar: true,
    soloConRelacionTerapeutica: false,
    // Decisión 2 del plan: es quien atiende en ventanilla.
    conversacion: 'TEXTO',
    verSync: true,
    verInternos: false,
    modoB: true,
    verConsultas: false,
    aplicaScopeAgente: true,
  },
  DOCTOR: {
    buscar: true,
    soloConRelacionTerapeutica: true,
    conversacion: 'NINGUNA',
    verSync: false,
    verInternos: false,
    modoB: false,
    verConsultas: false,
    aplicaScopeAgente: false,
  },
  SUPER_ADMIN: {
    buscar: true,
    soloConRelacionTerapeutica: false,
    // Punto abierto §12 #2, resuelto por defecto: hechos sí, texto no. Es
    // soporte de plataforma, no operación de ventanilla.
    conversacion: 'RESUMEN',
    verSync: true,
    verInternos: false,
    modoB: true,
    verConsultas: true,
    aplicaScopeAgente: false,
  },
};

export function permisosDeRol(rol: RolRastreo | null | undefined): PermisosRastreo {
  return (rol && MATRIZ[rol]) || NADA;
}

/** Quién consulta, ya con su clínica resuelta y su alcance. */
export interface ActorRastreo {
  userId: string;
  role: RolRastreo;
  /** La clínica sobre la que se opera: la del token, o la elegida por SUPER_ADMIN. */
  organizationId: string;
  permisos: PermisosRastreo;
  /** BOOKING_AGENT con EPS asignada; también lo lee el filtro de citas. */
  scopeEpsId: string | null;
  /** BOOKING_AGENT con médico asignado, o el propio médico si es DOCTOR. */
  scopeDoctorId: string | null;
}

export type ResultadoActor =
  | { ok: true; actor: ActorRastreo }
  | { ok: false; error: string };

type DbActor = Pick<
  PrismaClient,
  'organization' | 'agentProfile' | 'doctorProfile'
>;

export const SIN_PERMISOS = 'Sin permisos.';

/**
 * Arma el actor a partir de la sesión.
 *
 * `organizacionElegida` solo se mira si el rol es SUPER_ADMIN. Para cualquier
 * otro rol se IGNORA aunque venga: es exactamente el dato que un cliente
 * malicioso mandaría para intentar leer otra clínica.
 */
export async function resolverActor(
  db: DbActor,
  sesion: SessionPayload | null,
  organizacionElegida?: string | null,
): Promise<ResultadoActor> {
  if (!sesion) return { ok: false, error: SIN_PERMISOS };
  const permisos = permisosDeRol(sesion.role);
  if (!permisos.buscar) return { ok: false, error: SIN_PERMISOS };

  let organizationId: string;
  if (sesion.role === 'SUPER_ADMIN') {
    if (!organizacionElegida || typeof organizacionElegida !== 'string') {
      return { ok: false, error: 'Elige una organización para consultar.' };
    }
    const org = await db.organization.findUnique({
      where: { id: organizacionElegida },
      select: { id: true },
    });
    if (!org) return { ok: false, error: 'Organización no encontrada.' };
    organizationId = org.id;
  } else {
    if (!sesion.organizationId) return { ok: false, error: SIN_PERMISOS };
    organizationId = sesion.organizationId;
  }

  let scopeEpsId: string | null = null;
  let scopeDoctorId: string | null = null;

  if (sesion.role === 'BOOKING_AGENT') {
    // Sin perfil de agente no hay alcance que aplicar: mismo criterio que la
    // pantalla de agendamiento (`agentProfile?.epsId || undefined`).
    const perfil = await db.agentProfile.findUnique({
      where: { userId: sesion.userId },
      select: { epsId: true, doctorId: true },
    });
    scopeEpsId = perfil?.epsId ?? null;
    scopeDoctorId = perfil?.doctorId ?? null;
  } else if (sesion.role === 'DOCTOR') {
    const perfil = await db.doctorProfile.findUnique({
      where: { userId: sesion.userId },
      select: { id: true },
    });
    // Un DOCTOR sin perfil no tiene a quién atender: se rechaza, no se abre.
    if (!perfil) return { ok: false, error: 'Perfil de médico no encontrado.' };
    scopeDoctorId = perfil.id;
  }

  return {
    ok: true,
    actor: {
      userId: sesion.userId,
      role: sesion.role,
      organizationId,
      permisos,
      scopeEpsId,
      scopeDoctorId,
    },
  };
}
