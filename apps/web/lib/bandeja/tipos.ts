/**
 * Lo que cruza del servidor al cliente en la bandeja de excepciones de
 * sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #3, Fase 3). Todo es
 * serializable (fechas como ISO, sin bigint) y NADA lleva un dato personal sin
 * enmascarar ni el detalle técnico a quien no puede verlo.
 */
import type {
  AccionExcepcion,
  EstadoExcepcion,
  SeveridadExcepcion,
  TipoExcepcion,
} from '@agenia/shared';

export type Resultado<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** La cita a la que se refiere una excepción, enmascarada. */
export interface CitaDeExcepcion {
  /** null si la excepción no es de una cita concreta (un error de la auditoría sin cita). */
  inicioIso: string | null;
  medico: string | null;
  servicio: string | null;
  /** Enmascarado: «María L••• N•••». */
  paciente: string | null;
  /** Enmascarado: «•••3456». */
  documento: string | null;
  /** Para saltar al rastreo. No es un dato personal: es un id opaco. */
  pacienteId: string | null;
}

export interface ExcepcionVista {
  id: string;
  tipo: TipoExcepcion;
  titulo: string;
  gravedad: SeveridadExcepcion;
  estado: EstadoExcepcion;
  /** Una frase neutra, sin datos técnicos ni personales. */
  resumen: string;
  /** El texto técnico (último error del agente…). Solo lo ve quien puede ver internos. */
  detalleTecnico: string | null;
  cita: CitaDeExcepcion | null;
  ocurrencias: number;
  primeraVezIso: string;
  ultimaVezIso: string;
  /** Cuándo se le avisó al agendador, si se le avisó. */
  avisadaIso: string | null;
  dueno: { esMio: boolean; etiqueta: string } | null;
  cierre: { atIso: string; por: string; nota: string | null } | null;
  /** Lo que ESTE usuario puede hacer ahora con ella (ya filtrado por el estado y el permiso). */
  acciones: AccionExcepcion[];
}

export interface EntradaHistorial {
  atIso: string;
  accion: string;
  por: string;
  nota: string | null;
}

export interface ExcepcionDetalle extends ExcepcionVista {
  historial: EntradaHistorial[];
}

export type FiltroEstado = 'ACTIVAS' | 'MIAS' | 'SIN_DUENO' | 'CERRADAS';

/**
 * RECIENTES: la más nueva primero (por `firstSeenAt`). URGENCIA: gravedad y,
 * dentro de ella, la cita más próxima (el orden histórico de la bandeja).
 * Solo aplica a los estados activos: las CERRADAS siempre van por fecha de
 * cierre, sea cual sea `orden`.
 */
export type OrdenBandeja = 'RECIENTES' | 'URGENCIA';

export interface FiltrosBandeja {
  estado?: FiltroEstado;
  tipo?: TipoExcepcion;
  gravedad?: SeveridadExcepcion;
  /** Médico de la cita relacionada (`SyncException.doctorId`). */
  medicoId?: string;
  /** `YYYY-MM-DD`, en hora de pared de Bogotá. Filtra por `firstSeenAt`. */
  desde?: string;
  hasta?: string;
  /** Busca en el título, la nota de cierre, el detalle técnico (si se puede ver) y el nombre del médico o del paciente. */
  q?: string;
  orden?: OrdenBandeja;
  pagina?: number;
}

/** Una opción del filtro «Médico»: solo los que ya tuvieron alguna excepción. */
export interface MedicoFiltro {
  id: string;
  nombre: string;
}

export interface ResumenBandeja {
  activas: number;
  sinDueno: number;
  mias: number;
  criticas: number;
  porGravedad: Record<SeveridadExcepcion, number>;
}

export interface ListaExcepciones {
  filas: ExcepcionVista[];
  total: number;
  pagina: number;
  paginas: number;
  resumen: ResumenBandeja;
  /** Opciones del filtro «Médico»; no cambia con los demás filtros (para no verse encogiendo). */
  medicos: MedicoFiltro[];
  /** Se truncó a `MAX_ACTIVAS` (solo pasa en orden URGENCIA): hay más de las que se ven. */
  truncada: boolean;
}

/** ¿Están saliendo los avisos al agendador? Si no, por qué. */
export interface EstadoAvisos {
  salen: boolean;
  razon: string | null;
  alertasActivas: boolean;
  plantilla: boolean;
  tieneNumero: boolean;
  /** Hay un número de respaldo para los recordatorios (§12 #14). */
  tieneRespaldo: boolean;
  /** El número, solo para quien lo configura (ORG_ADMIN). */
  numero: string | null;
  /** El respaldo, solo para quien lo configura (ORG_ADMIN). */
  respaldo: string | null;
}
