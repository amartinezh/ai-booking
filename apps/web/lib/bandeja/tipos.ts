/**
 * Lo que cruza del servidor al cliente en la bandeja de excepciones de
 * sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #3, Fase 3). Todo es
 * serializable (fechas como ISO, sin bigint) y NADA lleva un dato personal sin
 * enmascarar ni el detalle técnico a quien no puede verlo. La única excepción son
 * los celulares de la lista de avisos, completos SOLO para el administrador que la
 * configura (`EstadoAvisos.destinatarios`).
 */
import type {
  AccionExcepcion,
  CoberturaAvisos,
  EstadoExcepcion,
  ModoDestinatario,
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

/**
 * 📣 Cómo le fue a una persona con su último aviso (docs/PLAN_AVISOS_AGENDADORES.md
 * §3.6): lo que Meta dijo del último envío, o el último rechazo.
 */
export interface EstadoEnvioDestinatario {
  tono: 'ok' | 'pendiente' | 'error' | 'nunca';
  texto: string;
}

/** Qué recibe una persona en «Configurar avisos». `NO` = no está en la lista. */
export type RecibeAvisos = 'NO' | ModoDestinatario;

/**
 * Una fila de «Configurar avisos»: una persona del sistema (agendador o
 * administrador de la clínica), esté o no en la lista, o un número sin cuenta.
 */
export interface DestinatarioVista {
  /** La fila de la lista; `null` = persona del sistema que hoy no recibe. */
  id: string | null;
  /** `null` = número sin cuenta en AgenIA. */
  userId: string | null;
  nombre: string;
  rol: 'ORG_ADMIN' | 'BOOKING_AGENT' | null;
  /** «Todo», o su EPS y su médico si es un agendador acotado. `null` sin cuenta. */
  alcance: string | null;
  /** El nombre de un número sin cuenta. */
  label: string | null;
  /** Completo (solo lo ve el administrador). Para quien no recibe, el de su perfil, si lo hay. */
  phone: string | null;
  recibe: RecibeAvisos;
  syncAlerts: boolean;
  patientRequestAlerts: boolean;
  /** `false` = en pausa: sigue en la lista pero no recibe. */
  isActive: boolean;
  estado: EstadoEnvioDestinatario;
}

/** Lo que manda la pantalla al guardar: SOLO quienes reciben (los demás salen de la lista). */
export interface EntradaDestinatario {
  /** La fila, si ya existía (para un número sin cuenta es la única forma de reconocerlo). */
  id?: string | null;
  userId?: string | null;
  label?: string | null;
  phone: string;
  mode: ModoDestinatario;
  syncAlerts: boolean;
  patientRequestAlerts: boolean;
  isActive: boolean;
}

/** ¿Están saliendo los avisos de la bandeja? Si no, por qué, y a quién le llegan. */
export interface EstadoAvisos {
  /** Sale el aviso de las citas que no llegan al hospital. */
  salen: boolean;
  razon: string | null;
  alertasActivas: boolean;
  plantilla: boolean;
  /**
   * 🙋 El aviso de pedidos de pacientes (2026-10-27): pidió cancelar y no confirmó,
   * o avisó que no irá, con la cita a 24 h o menos. Su propia plantilla.
   * `razonPacientes` dice por qué no sale; null si sale.
   */
  plantillaPacientes: boolean;
  razonPacientes: string | null;
  /** Cuántas personas reciben, en total y por aviso (lo de arriba de la pantalla). */
  cobertura: CoberturaAvisos;
  /** Si quien mira está en la lista, y cómo (el agendador ve solo lo suyo, §3.5). */
  yo: {
    recibe: boolean;
    /** Enmascarado. */
    numero: string | null;
    modo: ModoDestinatario | null;
    syncAlerts: boolean;
    patientRequestAlerts: boolean;
    enPausa: boolean;
  };
  /** La lista para configurarla: SOLO para el administrador; `null` para los demás. */
  destinatarios: DestinatarioVista[] | null;
}
