/**
 * Lo que cruza del servidor al cliente en el rastreo de paciente. Todo es
 * serializable (fechas como ISO, sin bigint) y NADA lleva un dato personal sin
 * enmascarar salvo lo que el permiso del rol autoriza explícitamente.
 */
import type {
  AuditoriaCupo,
  CitaRastreo,
  EstadoCitaHis,
  EsperaRastreo,
  PasoLinea,
  ResultadoRastreo,
  ResumenConversacion,
  SaludEspejo,
} from '@agenia/shared';
import type { NivelConversacion } from './acceso';
import type { MensajeConversacion } from './evidencia';

export type Resultado<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** A: "dice que agendó". B: "lo agendaron en el HIS". */
export type ModoRastreo = 'A' | 'B';

// ── Búsqueda ────────────────────────────────────────────────

export interface CandidatoRastreo {
  /** PACIENTE tiene perfil; REMITENTE es un número que solo aparece en las conversaciones. */
  tipo: 'PACIENTE' | 'REMITENTE';
  /** `PatientProfile.id`, o el identificador de WhatsApp si es REMITENTE. */
  id: string;
  /** Enmascarado: el primer nombre entero, del resto la inicial. Vacío en REMITENTE. */
  nombre: string;
  documento: string | null;
  contacto: string | null;
  eps: string | null;
  citas: number;
  coincidePor: 'CEDULA' | 'TELEFONO' | 'BSUID' | 'NOMBRE';
}

export interface ResultadoBusqueda {
  candidatos: CandidatoRastreo[];
  /** Había más de los que se muestran: afinar la búsqueda. */
  hayMas: boolean;
  interpretadoComo: 'DOCUMENTO_O_TELEFONO' | 'BSUID' | 'NOMBRE';
}

export type SujetoRastreo =
  | { tipo: 'PACIENTE'; id: string }
  | { tipo: 'REMITENTE'; whatsappId: string };

// ── Consulta en vivo al HIS (Fase 2) ────────────────────────

/** ¿Se puede pedir ahora una consulta en vivo? Si no, por qué (para decírselo a quien atiende). */
export interface DisponibilidadHis {
  puede: boolean;
  /** En lenguaje de quien atiende. `null` si se puede. */
  razon: string | null;
}

/**
 * Una cita del paciente tal como la tiene el HIS. Solo citas del PACIENTE
 * consultado (las de otros documentos se descartan al recibirlas): nunca lleva
 * un dato de un tercero.
 */
export interface CitaHisMostrada {
  startIso: string;
  /** Etiqueta del médico si está en el catálogo; si no, su clave del HIS. */
  medico: string;
  estado: EstadoCitaHis;
}

/** Lo que devolvió la consulta en vivo, listo para mostrar. */
export interface ConsultaHisVista {
  consultadoIso: string;
  /** `null` = no se preguntó por las citas del paciente (solo por cupos concretos). */
  porDocumento: {
    desdeIso: string;
    hastaIso: string;
    citas: CitaHisMostrada[];
    /** Puede haber más citas de las que se muestran. */
    truncado: boolean;
  } | null;
  /** Cuántos cupos concretos se consultaron. */
  cuposConsultados: number;
}

/** Lo que la pantalla necesita para ofrecer y mostrar la consulta en vivo. */
export interface HisEnVivoVista {
  /** ¿Este rol y esta clínica la ofrecen? Si no, la pantalla ni muestra el botón. */
  visible: boolean;
  disponibilidad: DisponibilidadHis;
  /** `null` = no se ha consultado (o el resultado ya se purgó). */
  consulta: ConsultaHisVista | null;
  /** Una de las búsquedas falló y la otra no: el resultado es parcial. */
  aviso: string | null;
}

/** Lo que devuelve iniciar una consulta: qué peticiones sondear y cuánto esperar. */
export interface ConsultaHisIniciada {
  ids: string[];
  esperaMs: number;
}

/** Cómo va una consulta en curso. */
export interface ProgresoConsultaHis {
  estado: 'EN_CURSO' | 'LISTA' | 'FALLIDA';
  /** Motivo, si falló o quedó parcial. */
  detalle: string | null;
}

// ── Expediente A ────────────────────────────────────────────

export interface EventoSyncVista {
  seq: string;
  op: string;
  creadoIso: string;
  entregadoIso: string | null;
  intentos: number;
  rendido: boolean;
  ultimoError: string | null;
}

export interface CitaExpediente extends CitaRastreo {
  lineaDeVida: PasoLinea[];
  /** Solo quien puede reprocesar (ORG_ADMIN). */
  eventosSync: EventoSyncVista[] | null;
  /** ¿Se envió recordatorio? */
  recordatorioIso: string | null;
}

export interface IdentidadVista {
  pacienteId: string;
  nombre: string;
  /** Enmascarados: revelarlos queda registrado. */
  documento: string | null;
  whatsapp: string | null;
  bsuid: string | null;
  eps: string | null;
  regimen: string | null;
  creadoIso: string;
}

export interface HistorialVista {
  encuestas: { creadoIso: string; calificacion: number; resolucion: string }[];
  avisosMasivos: { citaIso: string; resultado: string; enviadoIso: string | null }[];
}

export interface ExpedienteA {
  modo: 'A';
  generadoIso: string;
  zonaHoraria: string;
  /** ¿La clínica tiene espejo con un HIS? Decide si hay pasos de sincronización. */
  conEspejo: boolean;
  sujeto: SujetoRastreo;
  identidad: IdentidadVista | null;
  /** Enmascarado; solo cuando no hay perfil (un remitente que nunca se identificó). */
  remitente: string | null;
  resultado: ResultadoRastreo;
  citas: CitaExpediente[];
  espera: EsperaRastreo[];
  historial: HistorialVista;
  conversacion: {
    nivel: NivelConversacion;
    resumen: ResumenConversacion | null;
    /** null si el rol no puede leer el texto. */
    mensajes: MensajeConversacion[] | null;
  };
  espejo: SaludEspejo | null;
  verInternos: boolean;
  capturaIndicada: boolean;
  hisEnVivo: HisEnVivoVista;
}

// ── Escenario B ─────────────────────────────────────────────

export interface OpcionMedico {
  /** Clave del médico en el HIS. */
  clave: string;
  etiqueta: string;
  /** ¿Está homologado con un médico de AgenIA? */
  homologado: boolean;
}

export interface ExpedienteB {
  modo: 'B';
  generadoIso: string;
  zonaHoraria: string;
  resultado: ResultadoRastreo;
  cupo: { medico: string; inicioIso: string; homologado: boolean };
  identidad: {
    encontrada: boolean;
    pacienteId: string | null;
    nombre: string | null;
    documento: string | null;
    coincidencia: 'EXACTA' | 'SIN_CEROS' | null;
    perfilesConVariante: number;
    conWhatsapp: boolean;
  };
  auditorias: AuditoriaCupo[];
  espejo: SaludEspejo | null;
  hisEnVivo: HisEnVivoVista;
}

// ── Bitácora ────────────────────────────────────────────────

export interface FilaConsulta {
  id: string;
  creadoIso: string;
  actorEmail: string | null;
  actorRol: string;
  modo: string;
  /** CEDULA, PHONE, BSUID, NAME, OPEN o REVEAL. */
  tipo: string;
  busqueda: string;
  motivo: string;
  nota: string | null;
  candidatos: number;
  abrioExpediente: boolean;
  /** La consulta incluye lo que el HIS respondió en vivo. */
  enVivo: boolean;
  veredictos: string[];
}

export interface ListaConsultas {
  filas: FilaConsulta[];
  total: number;
  pagina: number;
  paginas: number;
}
