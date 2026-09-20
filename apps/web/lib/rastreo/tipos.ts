/**
 * Lo que cruza del servidor al cliente en el rastreo de paciente. Todo es
 * serializable (fechas como ISO, sin bigint) y NADA lleva un dato personal sin
 * enmascarar salvo lo que el permiso del rol autoriza explícitamente.
 */
import type {
  AuditoriaCupo,
  CitaRastreo,
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
  veredictos: string[];
}

export interface ListaConsultas {
  filas: FilaConsulta[];
  total: number;
  pagina: number;
  paginas: number;
}
