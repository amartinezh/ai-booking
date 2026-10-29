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
  /** 🩺 Solo en «Médico del hospital con citas que aún no está en AgenIA». */
  medicoNuevo?: MedicoNuevoVista | null;
  /**
   * ✉️ ESTE usuario puede escribirle al paciente de la cita desde el caso
   * (2026-10-29): puede trabajar la Bandeja y el caso tiene cita y paciente.
   */
  escribirAlPaciente?: boolean;
}

/** ✉️ Lo que el panel muestra antes de escribirle al paciente (2026-10-29). */
export interface PreparacionMensaje {
  canal: 'WHATSAPP' | 'TELEGRAM';
  /** Se le puede escribir texto libre ahora (WhatsApp: escribió en las últimas 24 horas). */
  puedeEscribir: boolean;
  /** Hasta cuándo se le puede escribir; null por Telegram o fuera de la ventana. */
  hastaIso: string | null;
  /** A dónde va, enmascarado («•••9051»); null por Telegram. */
  destino: string | null;
  /** Va a un número que no es el de la ficha (quien agendó o respondió por la cita). */
  otroNumero: boolean;
  /** La cita sigue vigente en AgenIA. */
  citaVigente: boolean;
  sugerencias: { cancelada: string; confirmada: string; saludo: string };
  /** La sugerencia con que abre el cuadro, según el tipo de caso. */
  sugerida: 'cancelada' | 'confirmada' | 'saludo';
}

/** El médico del hospital que se puede crear y homologar desde la Bandeja (2026-10-24). */
export interface MedicoNuevoVista {
  codigo: string;
  nombre: string | null;
  cargo: string | null;
  /** Los últimos 4 dígitos de su cédula. */
  cedulaFinal: string | null;
  servicio: string | null;
  citas: number;
  primeraIso: string | null;
  /** Lo que impide crearlo desde aquí: se homologa a mano en Espejo › Homologación. */
  bloqueos: string[];
  /** Lo que conviene revisar antes de crearlo. */
  advertencias: string[];
  /** ESTE usuario puede crearlo ahora: administrador, caso activo y sin bloqueos. */
  puedeCrear: boolean;
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
  /**
   * 🙋 El aviso de pedidos de pacientes (2026-10-27): pidió cancelar y no confirmó,
   * o avisó que no irá, con la cita a 24 h o menos. Usa el mismo número y su propia
   * plantilla. `razonPacientes` dice por qué no sale; null si sale.
   */
  plantillaPacientes: boolean;
  razonPacientes: string | null;
}
