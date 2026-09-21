/**
 * Quién puede hacer qué en la bandeja de excepciones de sincronización
 * (docs/PLAN_RASTREO_PACIENTE.md §10 #3). Una sola tabla, un solo lugar.
 *
 * El tenant SALE DEL TOKEN, nunca del cliente. No hay excepción para SUPER_ADMIN:
 * es soporte de plataforma y no opera la cola de una clínica.
 *
 * A un BOOKING_AGENT con EPS o médico asignados se le acota a SU alcance con la
 * misma regla que su lista de citas y que la acción de cancelar
 * (`lib/alcance-agente.ts`, §12 #9): una excepción sin EPS o sin médico conocidos
 * (un cupo, un error de la auditoría) queda FUERA para él, no dentro.
 */
import type { PrismaClient } from '@agenia/database';
import type { SessionPayload } from '../session';

export type RolBandeja = SessionPayload['role'];

export interface PermisosBandeja {
  /** Ver la bandeja y sus excepciones. */
  ver: boolean;
  /** Tomar, soltar, resolver, descartar y reabrir. */
  trabajar: boolean;
  /** El detalle técnico (último error del agente, texto de la auditoría) y el correo del dueño. */
  verInternos: boolean;
  /** Quitarle una excepción a otro o cerrar la de otro. */
  administrar: boolean;
  /** Configurar a quién se avisa. */
  configurarAvisos: boolean;
  /** BOOKING_AGENT: sus excepciones visibles se acotan a su EPS y a su médico. */
  aplicaScopeAgente: boolean;
}

const NADA: PermisosBandeja = {
  ver: false,
  trabajar: false,
  verInternos: false,
  administrar: false,
  configurarAvisos: false,
  aplicaScopeAgente: false,
};

const MATRIZ: Partial<Record<RolBandeja, PermisosBandeja>> = {
  ORG_ADMIN: {
    ver: true,
    trabajar: true,
    verInternos: true,
    administrar: true,
    configurarAvisos: true,
    aplicaScopeAgente: false,
  },
  BOOKING_AGENT: {
    ver: true,
    trabajar: true,
    verInternos: false,
    administrar: false,
    configurarAvisos: false,
    aplicaScopeAgente: true,
  },
};

/** Falla cerrado: cualquier rol que no esté en la tabla (o ausente) no tiene nada. */
export function permisosBandeja(rol: RolBandeja | null | undefined): PermisosBandeja {
  return (rol && MATRIZ[rol]) || NADA;
}

export interface ActorBandeja {
  userId: string;
  role: RolBandeja;
  organizationId: string;
  permisos: PermisosBandeja;
  /** BOOKING_AGENT con EPS asignada. */
  scopeEpsId: string | null;
  /** BOOKING_AGENT con médico asignado. */
  scopeDoctorId: string | null;
}

export type ResultadoActorBandeja =
  | { ok: true; actor: ActorBandeja }
  | { ok: false; error: string };

export const SIN_PERMISOS = 'Sin permisos.';

type DbActor = Pick<PrismaClient, 'agentProfile'>;

export async function resolverActorBandeja(
  db: DbActor,
  sesion: SessionPayload | null,
): Promise<ResultadoActorBandeja> {
  if (!sesion) return { ok: false, error: SIN_PERMISOS };
  const permisos = permisosBandeja(sesion.role);
  if (!permisos.ver || !sesion.organizationId) {
    return { ok: false, error: SIN_PERMISOS };
  }

  let scopeEpsId: string | null = null;
  let scopeDoctorId: string | null = null;
  if (permisos.aplicaScopeAgente) {
    // Sin perfil no hay alcance que aplicar (es global), como en la lista de citas.
    const perfil = await db.agentProfile.findUnique({
      where: { userId: sesion.userId },
      select: { epsId: true, doctorId: true },
    });
    scopeEpsId = perfil?.epsId || null;
    scopeDoctorId = perfil?.doctorId || null;
  }

  return {
    ok: true,
    actor: {
      userId: sesion.userId,
      role: sesion.role,
      organizationId: sesion.organizationId,
      permisos,
      scopeEpsId,
      scopeDoctorId,
    },
  };
}
