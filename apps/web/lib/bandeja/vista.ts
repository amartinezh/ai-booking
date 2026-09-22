/**
 * Lo PURO de la bandeja de excepciones: de una fila de la base a lo que se le
 * muestra a quien mira (docs/PLAN_RASTREO_PACIENTE.md §10 #3, Fase 3). Sin base de
 * datos: la lectura vive en `servicio.ts` y aquí solo se decide QUÉ se ve.
 *
 * Tres cosas que esta capa garantiza y sus pruebas fijan:
 *
 *  1. **Nada personal sin enmascarar.** El paciente sale como «María L••• N•••» y
 *     «•••3456»: para distinguir homónimos, no para publicarlo. El detalle completo
 *     se abre en el rastreo, que deja bitácora.
 *  2. **El texto técnico es de quien puede verlo.** `detail` lleva el último error del
 *     agente, que puede nombrar servidores del hospital: el resumen que ven todos se
 *     reconstruye desde `meta`, no se recorta del detalle.
 *  3. **Las acciones ya vienen filtradas** por estado, dueño y permiso. La pantalla
 *     solo pinta botones; la regla es la misma que valida el servidor al aplicar.
 */
import {
  ESTADOS_ACTIVOS,
  TITULO_EXCEPCION,
  enmascararDocumento,
  enmascararNombre,
  resumenRetencion,
  transicionExcepcion,
  type AccionExcepcion,
  type EstadoExcepcion,
  type MotivoRetencion,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import { etiquetaActorPersonal, etiquetaMedico } from '../rastreo/evidencia';
import type { PermisosBandeja } from './acceso';
import type {
  EntradaHistorial,
  ExcepcionVista,
} from './tipos';

/** Lo que `servicio.ts` lee de `SyncException`. */
export interface FilaExcepcion {
  id: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  detail: string | null;
  appointmentId: string | null;
  patientId: string | null;
  epsId: string | null;
  doctorId: string | null;
  appointmentStartAt: Date | null;
  meta: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: number;
  assignedToUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  notifiedAt: Date | null;
}

export interface FilaHistorial {
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  note: string | null;
  createdAt: Date;
}

/** Lo que `servicio.ts` trae aparte para completar las filas de una página. */
export interface ContextoVista {
  actor: { userId: string; permisos: PermisosBandeja };
  ahora: Date;
  medicos: Map<string, { fullName: string; isFunctionalAgenda: boolean }>;
  pacientes: Map<string, { fullName: string | null; cedula: string | null }>;
  citas: Map<string, { servicio: string | null }>;
  usuarios: Map<string, { email: string; role: string }>;
}

const MIN_MS = 60_000;

const ACCIONES: readonly AccionExcepcion[] = [
  'TOMAR',
  'SOLTAR',
  'RESOLVER',
  'DESCARTAR',
  'REABRIR',
];

/** Una nota cualquiera válida: para saber si la acción SERÍA posible, la pantalla pide la real. */
const NOTA_DE_PRUEBA = 'nota de prueba';

export const MSG_NO_REABRIR_AUTO =
  'El sistema la cerró porque el problema dejó de cumplirse: si vuelve, la reabre sola.';

export const esEstadoActivo = (estado: string): boolean =>
  (ESTADOS_ACTIVOS as readonly string[]).includes(estado);

// ─────────────────────────────────────────────────────────────
// Qué se puede hacer
// ─────────────────────────────────────────────────────────────

/**
 * ¿Puede ESTE actor aplicar `accion` a una excepción en `estado`? La usan la
 * pantalla (para pintar botones) y el servidor (para validar): una sola regla.
 */
export function evaluarAccion(
  estado: string,
  accion: AccionExcepcion,
  ctx: {
    esDuenio: boolean;
    hayDuenio: boolean;
    permisos: Pick<PermisosBandeja, 'trabajar' | 'administrar'>;
    nota?: string;
  },
): { ok: true; estado: EstadoExcepcion } | { ok: false; motivo: string } {
  if (!ctx.permisos.trabajar) return { ok: false, motivo: 'Sin permisos.' };
  const t = transicionExcepcion(estado as EstadoExcepcion, accion, {
    esDuenio: ctx.esDuenio,
    esAdmin: ctx.permisos.administrar,
    hayDuenio: ctx.hayDuenio,
    nota: ctx.nota,
  });
  if (!t.ok) return t;
  // Reabrir lo que el sistema cerró no sirve: si el problema sigue ahí lo vuelve a
  // cerrar en la próxima vuelta, y si vuelve a pasar lo reabre él.
  if (accion === 'REABRIR' && estado === 'AUTO_RESUELTA') {
    return { ok: false, motivo: MSG_NO_REABRIR_AUTO };
  }
  return t;
}

export function accionesDisponibles(
  estado: string,
  ctx: {
    esDuenio: boolean;
    hayDuenio: boolean;
    permisos: Pick<PermisosBandeja, 'trabajar' | 'administrar'>;
  },
): AccionExcepcion[] {
  return ACCIONES.filter(
    (a) => evaluarAccion(estado, a, { ...ctx, nota: NOTA_DE_PRUEBA }).ok,
  );
}

// ─────────────────────────────────────────────────────────────
// El resumen que ve todo el mundo
// ─────────────────────────────────────────────────────────────

const MOTIVOS: readonly MotivoRetencion[] = ['EN_COLA', 'REINTENTANDO', 'RENDIDA'];

const numero = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

function leerMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

/**
 * Una frase neutra por tipo, armada desde `meta` (nunca del texto técnico).
 * `referenciaMs` es el «ahora» con el que se cuentan los minutos: para una excepción
 * activa, el momento de mirar; para una cerrada, la última vez que se vio activa
 * (contar «lleva 3 días» de algo que se resolvió el martes sería mentir).
 */
export function resumenPublico(
  fila: Pick<FilaExcepcion, 'kind' | 'title' | 'meta' | 'occurrences'>,
  referenciaMs: number,
): string {
  const meta = leerMeta(fila.meta);
  const veces = fila.occurrences > 1 ? ` (${fila.occurrences} veces)` : '';

  switch (fila.kind) {
    case 'CITA_NO_ENTREGADA': {
      const motivo = MOTIVOS.find((m) => m === meta.motivo) ?? 'EN_COLA';
      const desde =
        typeof meta.desdeIso === 'string' ? Date.parse(meta.desdeIso) : NaN;
      const minutos = Number.isNaN(desde)
        ? numero(meta.minutosRetenida)
        : Math.max(0, Math.floor((referenciaMs - desde) / MIN_MS));
      return resumenRetencion(motivo, minutos, numero(meta.intentos));
    }
    case 'EVENTO_RENDIDO':
      return resumenRetencion('RENDIDA', 0, numero(meta.intentos));
    case 'CONFLICTO_SYNC':
      return `Un cambio que llegó del hospital chocó con lo que AgenIA tiene${veces}.`;
    case 'ERROR_SYNC':
      return `Un cambio que llegó del hospital no se pudo aplicar en AgenIA${veces}.`;
    case 'DERIVA_EN_HIS':
      return 'La comparación con el hospital no encontró esta cita. Puede haberse cancelado allá, agendado en otro cupo o no haberse registrado nunca.';
    case 'IDENTIDAD_AMBIGUA':
      return `El hospital agendó una cita y hay ${numero(meta.candidatos) || 'más de un'} paciente(s) en AgenIA con ese mismo documento escrito distinto (ceros a la izquierda). No se creó la cita: hay que corregir el documento en el sistema donde esté mal escrito${veces}.`;
    default:
      return fila.title;
  }
}

// ─────────────────────────────────────────────────────────────
// Quién
// ─────────────────────────────────────────────────────────────

/**
 * «Tú», o el rol (y el correo solo para quien ve internos, como en el rastreo: saber
 * que lo tiene «un agente de reservas» basta para atender; el nombre de un compañero
 * solo le hace falta a quien administra).
 */
export function etiquetaPersona(
  userId: string,
  ctx: Pick<ContextoVista, 'actor' | 'usuarios'>,
  rolRegistrado: string | null = null,
): string {
  if (userId === ctx.actor.userId) return 'Tú';
  const u = ctx.usuarios.get(userId);
  return etiquetaActorPersonal(
    u?.role ?? rolRegistrado,
    ctx.actor.permisos.verInternos ? (u?.email ?? null) : null,
  );
}

// ─────────────────────────────────────────────────────────────
// La fila
// ─────────────────────────────────────────────────────────────

export function mapearExcepcion(
  f: FilaExcepcion,
  ctx: ContextoVista,
): ExcepcionVista {
  const activa = esEstadoActivo(f.status);
  // Activa: los minutos corren hasta ahora. Cerrada: hasta la última vez que se vio.
  const referenciaMs = activa ? ctx.ahora.getTime() : f.lastSeenAt.getTime();

  const medico = f.doctorId ? ctx.medicos.get(f.doctorId) : undefined;
  const paciente = f.patientId ? ctx.pacientes.get(f.patientId) : undefined;
  const cita = f.appointmentId ? ctx.citas.get(f.appointmentId) : undefined;
  const esDuenio = !!f.assignedToUserId && f.assignedToUserId === ctx.actor.userId;

  const tieneCita = !!(f.appointmentStartAt || f.appointmentId || f.patientId);

  return {
    id: f.id,
    tipo: f.kind as TipoExcepcion,
    titulo: TITULO_EXCEPCION[f.kind as TipoExcepcion] ?? f.title,
    gravedad: f.severity as SeveridadExcepcion,
    estado: f.status as EstadoExcepcion,
    resumen: resumenPublico(f, referenciaMs),
    detalleTecnico: ctx.actor.permisos.verInternos ? f.detail : null,
    cita: tieneCita
      ? {
          inicioIso: f.appointmentStartAt?.toISOString() ?? null,
          medico: medico
            ? etiquetaMedico(medico.fullName, medico.isFunctionalAgenda) || null
            : null,
          servicio: cita?.servicio ?? null,
          paciente: paciente?.fullName ? enmascararNombre(paciente.fullName) : null,
          documento: enmascararDocumento(paciente?.cedula),
          pacienteId: f.patientId,
        }
      : null,
    ocurrencias: f.occurrences,
    primeraVezIso: f.firstSeenAt.toISOString(),
    ultimaVezIso: f.lastSeenAt.toISOString(),
    avisadaIso: f.notifiedAt?.toISOString() ?? null,
    dueno:
      activa && f.assignedToUserId
        ? {
            esMio: esDuenio,
            etiqueta: etiquetaPersona(f.assignedToUserId, ctx),
          }
        : null,
    cierre: activa
      ? null
      : {
          atIso: (f.resolvedAt ?? f.lastSeenAt).toISOString(),
          por: f.resolvedByUserId
            ? etiquetaPersona(f.resolvedByUserId, ctx)
            : 'El sistema',
          nota: f.resolutionNote,
        },
    acciones: accionesDisponibles(f.status, {
      esDuenio,
      hayDuenio: !!f.assignedToUserId,
      permisos: ctx.actor.permisos,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// El historial
// ─────────────────────────────────────────────────────────────

const ETIQUETA_ACCION: Record<string, string> = {
  CREADA: 'Detectada',
  REAPARECIDA: 'El problema volvió',
  ESCALADA: 'Subió de gravedad',
  AVISADA: 'Se avisó al agendador',
  RECORDADA: 'Se le recordó al agendador (nadie la había tomado)',
  TOMADA: 'La tomó',
  REASIGNADA: 'Se la quitó a quien la tenía',
  SOLTADA: 'La soltó',
  RESUELTA: 'La resolvió',
  DESCARTADA: 'La descartó',
  REABIERTA: 'La reabrió',
  AUTO_RESUELTA: 'Se cerró sola',
  VENCIDA: 'Venció sin resolución',
};

export function mapearHistorial(
  logs: FilaHistorial[],
  ctx: Pick<ContextoVista, 'actor' | 'usuarios'>,
): EntradaHistorial[] {
  return logs.map((l) => ({
    atIso: l.createdAt.toISOString(),
    accion: ETIQUETA_ACCION[l.action] ?? l.action,
    por: l.actorUserId
      ? etiquetaPersona(l.actorUserId, ctx, l.actorRole)
      : 'El sistema',
    nota: l.note,
  }));
}
