/**
 * ══════════════════════════════════════════════════════════════════════════
 * CLASIFICADOR DE VEREDICTOS DEL RASTREO DE PACIENTE
 * (docs/PLAN_RASTREO_PACIENTE.md §3)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Función PURA: entra un paquete de evidencia (citas, estado del outbox,
 * conversación, lista de espera, salud del espejo...) y salen veredictos de una
 * lista cerrada, cada uno con los hechos que lo sostienen, LO QUE NO SE SABE y
 * la acción sugerida. No toca la base ni el reloj: `ahoraIso` viene en la
 * evidencia, así que se prueba con tablas de casos.
 *
 * Vive en `@agenia/shared` para que haya UNA sola fuente de verdad sobre qué
 * significa "una cita atascada": la pantalla de rastreo la usa hoy y el
 * vigilante de la Fase 3 usará el mismo criterio.
 *
 * REGLAS DE LENGUAJE (§3.3). El sistema nunca dice que el paciente miente. Cada
 * veredicto declara su fuente y lo que NO sabe. `SIN_RASTRO` significa "AgenIA
 * no tiene registro", jamás "no agendó": el paciente pudo usar otro número u
 * otra cédula.
 */
import {
  formatAppointmentCompact,
  formatAppointmentShort,
} from './date-format';
import {
  mismoInstante,
  ocupanteDelCupo,
  type EstadoCitaHis,
  type EvidenciaHis,
} from './his-lookup';

// ─────────────────────────────────────────────────────────────
// Veredictos
// ─────────────────────────────────────────────────────────────

/**
 * Lista cerrada. Códigos en ASCII (van a la bitácora `PatientLookupLog.verdicts`
 * y a la base): el plan los escribe con tilde solo en la prosa.
 *
 * Los cuatro que necesitan la consulta en vivo al HIS (`CONFIRMADA_EN_EL_HIS`,
 * `ENTREGADA_PERO_AUSENTE`, `OTRA_IDENTIDAD`, `NO_ESTA_EN_EL_HIS`) solo salen
 * cuando la evidencia trae `his`. `TEXTO_VEREDICTO` es un `Record` exhaustivo,
 * así que olvidar el texto de un código nuevo no compila.
 */
export const VEREDICTO = {
  // Escenario A — "agendé por WhatsApp y el HIS no la tiene"
  NUNCA_CONFIRMO: 'NUNCA_CONFIRMO',
  EN_LISTA_DE_ESPERA: 'EN_LISTA_DE_ESPERA',
  CANCELADA: 'CANCELADA',
  CONFIRMADA_NO_LLEGO: 'CONFIRMADA_NO_LLEGO',
  EN_CAMINO_AL_HIS: 'EN_CAMINO_AL_HIS',
  ENTREGADA_SIN_VERIFICAR: 'ENTREGADA_SIN_VERIFICAR',
  CITA_VIGENTE: 'CITA_VIGENTE',
  FUERA_DE_ALCANCE: 'FUERA_DE_ALCANCE',
  SIN_RASTRO: 'SIN_RASTRO',
  // Con la consulta en vivo al HIS (Fase 2)
  CONFIRMADA_EN_EL_HIS: 'CONFIRMADA_EN_EL_HIS',
  ENTREGADA_PERO_AUSENTE: 'ENTREGADA_PERO_AUSENTE',
  OTRA_IDENTIDAD: 'OTRA_IDENTIDAD',
  NO_ESTA_EN_EL_HIS: 'NO_ESTA_EN_EL_HIS',
  HORA_ILEGIBLE_EN_EL_HIS: 'HORA_ILEGIBLE_EN_EL_HIS',
  // Escenario B — "la agendaron en el HIS y no sale en WhatsApp"
  MEDICO_NO_ESPEJADO: 'MEDICO_NO_ESPEJADO',
  SIN_CUPO: 'SIN_CUPO',
  CITA_DEL_HIS_NO_ESPEJADA: 'CITA_DEL_HIS_NO_ESPEJADA',
  EVENTO_DEL_HIS_NO_APLICADO: 'EVENTO_DEL_HIS_NO_APLICADO',
  SIN_EVENTO_DEL_HIS: 'SIN_EVENTO_DEL_HIS',
  IDENTIDAD_NO_COINCIDE: 'IDENTIDAD_NO_COINCIDE',
} as const;

export type CodigoVeredicto = (typeof VEREDICTO)[keyof typeof VEREDICTO];

export type Severidad = 'ok' | 'info' | 'warn' | 'bad';

/** De dónde sale lo que sostiene el veredicto. */
export type FuenteVeredicto = 'AGENIA' | 'HIS_EN_VIVO' | 'AGENIA_Y_HIS';

/** Por qué una cita confirmada en AgenIA no ha llegado al HIS. */
export type CausaNoLlego =
  | 'DEAD_LETTER'
  | 'RETRYING'
  | 'PENDING_STALE'
  | 'AGENT_SILENT'
  | 'HIS_UNREACHABLE'
  | 'MIRROR_OFF'
  | 'PUSH_OFF'
  | 'NO_EVENT';

export interface Veredicto {
  codigo: CodigoVeredicto;
  severidad: Severidad;
  fuente: FuenteVeredicto;
  titulo: string;
  /** Una frase que responde la pregunta del funcionario. */
  resumen: string;
  /** Los hechos que lo sostienen, uno por línea. */
  evidencia: string[];
  /** Lo que este veredicto NO puede afirmar. Nunca se omite. */
  noSabemos: string[];
  accion: string;
  /** Cita a la que se refiere (null en los veredictos que hablan de la ausencia de citas). */
  citaId: string | null;
  causa?: CausaNoLlego;
}

export interface ResultadoRastreo {
  /** El que se muestra arriba. */
  principal: Veredicto;
  /** Todos, el principal primero. */
  veredictos: Veredicto[];
  /** Observaciones que no son un veredicto (la captura no coincide, hay citas ocultas...). */
  notas: string[];
}

/** Título y severidad por defecto de cada código. */
export const TEXTO_VEREDICTO: Record<
  CodigoVeredicto,
  { titulo: string; severidad: Severidad }
> = {
  NUNCA_CONFIRMO: {
    titulo: 'AgenIA no registra una cita confirmada',
    severidad: 'info',
  },
  EN_LISTA_DE_ESPERA: {
    titulo: 'Está en lista de espera, no tiene una cita',
    severidad: 'info',
  },
  CANCELADA: { titulo: 'La cita fue cancelada', severidad: 'info' },
  CONFIRMADA_NO_LLEGO: {
    titulo: 'Confirmada en AgenIA, pero NO ha llegado al HIS',
    severidad: 'bad',
  },
  EN_CAMINO_AL_HIS: {
    titulo: 'La cita va en camino al HIS',
    severidad: 'info',
  },
  ENTREGADA_SIN_VERIFICAR: {
    titulo: 'AgenIA la entregó al hospital; falta verificar que esté ahí',
    severidad: 'info',
  },
  CITA_VIGENTE: { titulo: 'La cita existe en AgenIA', severidad: 'ok' },
  FUERA_DE_ALCANCE: {
    titulo: 'Hay citas de este paciente fuera de tu alcance',
    severidad: 'warn',
  },
  SIN_RASTRO: { titulo: 'AgenIA no tiene registro', severidad: 'info' },
  CONFIRMADA_EN_EL_HIS: {
    titulo: 'La cita está en AgenIA y en el HIS',
    severidad: 'ok',
  },
  ENTREGADA_PERO_AUSENTE: {
    titulo: 'AgenIA la entregó al hospital, pero el HIS no la tiene',
    severidad: 'bad',
  },
  OTRA_IDENTIDAD: {
    titulo: 'El HIS tiene esa hora a nombre de otro documento',
    severidad: 'warn',
  },
  NO_ESTA_EN_EL_HIS: {
    titulo: 'El HIS no tiene ninguna cita en ese cupo',
    severidad: 'warn',
  },
  HORA_ILEGIBLE_EN_EL_HIS: {
    titulo: 'El hospital respondió algo que no se pudo leer',
    severidad: 'warn',
  },
  MEDICO_NO_ESPEJADO: {
    titulo: 'Ese médico no está en el espejo de AgenIA',
    severidad: 'info',
  },
  SIN_CUPO: { titulo: 'Falta el cupo en AgenIA', severidad: 'warn' },
  CITA_DEL_HIS_NO_ESPEJADA: {
    titulo: 'El hospital agendó ese cupo y AgenIA no creó la cita',
    severidad: 'warn',
  },
  EVENTO_DEL_HIS_NO_APLICADO: {
    titulo: 'AgenIA recibió el evento del hospital y no pudo aplicarlo',
    severidad: 'warn',
  },
  SIN_EVENTO_DEL_HIS: {
    titulo: 'AgenIA no recibió ningún evento del hospital para ese cupo',
    severidad: 'warn',
  },
  IDENTIDAD_NO_COINCIDE: {
    titulo: 'El documento no coincide con el perfil de AgenIA',
    severidad: 'warn',
  },
};

/**
 * Orden de importancia al elegir el veredicto principal (menor = primero).
 * Lo accionable va delante de lo que ya está bien.
 */
const PRIORIDAD: Record<CodigoVeredicto, number> = {
  CONFIRMADA_NO_LLEGO: 1,
  EVENTO_DEL_HIS_NO_APLICADO: 1,
  ENTREGADA_PERO_AUSENTE: 1,
  OTRA_IDENTIDAD: 2,
  SIN_CUPO: 2,
  NO_ESTA_EN_EL_HIS: 3,
  // Va antes que «no está»: es MÁS específico y, sobre todo, lo contradice.
  HORA_ILEGIBLE_EN_EL_HIS: 2,
  CITA_DEL_HIS_NO_ESPEJADA: 3,
  SIN_EVENTO_DEL_HIS: 4,
  ENTREGADA_SIN_VERIFICAR: 5,
  EN_CAMINO_AL_HIS: 6,
  FUERA_DE_ALCANCE: 7,
  CANCELADA: 8,
  MEDICO_NO_ESPEJADO: 9,
  IDENTIDAD_NO_COINCIDE: 10,
  CITA_VIGENTE: 11,
  CONFIRMADA_EN_EL_HIS: 11,
  EN_LISTA_DE_ESPERA: 12,
  NUNCA_CONFIRMO: 13,
  SIN_RASTRO: 14,
};

// ─────────────────────────────────────────────────────────────
// Evidencia — entrada del clasificador
// ─────────────────────────────────────────────────────────────

export type EstadoCita = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type Asistencia = 'PENDING' | 'ATTENDED' | 'NO_SHOW';
export type OrigenCita = 'MANUAL' | 'WHATSAPP' | 'MIRROR';

/** Dónde está una cita creada en AgenIA respecto a su envío al HIS. */
export interface EstadoSync {
  estado: 'NO_EVENT' | 'PENDING' | 'RETRYING' | 'DEAD_LETTER' | 'DELIVERED';
  attempts: number;
  lastError: string | null;
  /** Cuándo se creó el evento de envío. */
  creadoIso: string | null;
  /** El más viejo aún no entregado (para medir cuánto lleva atascado). */
  oldestPendingIso: string | null;
  nextAttemptIso: string | null;
  deliveredAtIso: string | null;
  /** `SyncOutbox.seq` del evento dead-letter, para el botón de reprocesar (solo ORG_ADMIN). */
  seq: string | null;
}

export type EstadoMensaje =
  | 'ACCEPTED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED';

export interface MensajeConfirmacion {
  status: EstadoMensaje;
  /** Cuándo aceptó Meta el envío. */
  enviadoIso: string;
  /** Cuándo ocurrió `status`. */
  estadoIso: string;
  errorDetalle: string | null;
}

export interface CancelacionCita {
  por: 'PACIENTE_WHATSAPP' | 'HIS' | 'PERSONAL' | 'DESCONOCIDO';
  atIso: string | null;
  motivo: string | null;
  /**
   * Solo si `por` es `PERSONAL`: quién, ya redactado para mostrar
   * ("agente de reservas · agente@clinica.co"). Lo compone quien arma la
   * evidencia porque decide QUÉ puede ver el rol que consulta: a algunos solo se
   * les dice el rol, no la persona.
   */
  actor?: string | null;
}

export interface CitaRastreo {
  id: string;
  status: EstadoCita;
  attendance: Asistencia;
  origin: OrigenCita;
  createdAtIso: string;
  startIso: string;
  doctor: string;
  /**
   * La clave del médico en el HIS (`MirrorEntityMap`). Es lo que permite ubicar
   * la cita en lo que devuelve la consulta en vivo; `null`/ausente = el médico
   * no está homologado y esa cita no se puede buscar en el HIS.
   */
  doctorExternalKey?: string | null;
  service: string;
  eps: string | null;
  cancelacion: CancelacionCita | null;
  /** null = la clínica no tiene espejo, o este rol no ve el estado de sync. */
  sync: EstadoSync | null;
  /** null = sin registro en el libro de mensajes. */
  confirmacion: MensajeConfirmacion | null;
  /** ¿Hay un BOOKING_CONFIRMED de esta cita en la conversación? null = no visible. */
  confirmadaEnConversacion: boolean | null;
  /** null = no se indicaron datos de la captura. */
  coincideConCaptura: boolean | null;
}

export interface SaludEspejo {
  enabled: boolean;
  /** AgenIA → HIS. */
  pushEnabled: boolean;
  /** HIS → AgenIA. */
  pullEnabled: boolean;
  lastHeartbeatIso: string | null;
  hisReachable: boolean | null;
  hisDetail: string | null;
}

export interface ResumenConversacion {
  mensajes: number;
  primerMensajeIso: string | null;
  ultimoMensajeIso: string | null;
  /** Fallos y abandonos registrados, el más reciente primero. `motivo` es el código de `FailureReason` o `ABANDONED`. */
  fallos: { motivo: string; atIso: string }[];
  ultimoResultado:
    | 'CONFIRMADA'
    | 'FALLO'
    | 'ABANDONADA'
    | 'LISTA_DE_ESPERA'
    | 'OTRO'
    | null;
}

export interface EsperaRastreo {
  status: 'WAITING' | 'NOTIFIED' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  servicio: string;
  desdeIso: string;
  avisadoIso: string | null;
}

export interface EvidenciaRastreoA {
  ahoraIso: string;
  zonaHoraria?: string;
  /** false = solo hay un remitente de WhatsApp sin perfil (nunca terminó de identificarse). */
  pacienteEncontrado: boolean;
  /** Solo las citas que el actor puede ver. */
  citas: CitaRastreo[];
  /** Citas del paciente que el scope del actor esconde (BOOKING_AGENT con EPS o médico asignados). */
  citasOcultas: number;
  espera: EsperaRastreo[];
  /** null = este rol no ve ni el resumen de la conversación. */
  conversacion: ResumenConversacion | null;
  /** null = la clínica no tiene espejo, o este rol no ve el estado de sync. */
  espejo: SaludEspejo | null;
  capturaIndicada: boolean;
  /** Lo que el HIS respondió en vivo (Fase 2). Ausente = no se consultó. */
  his?: EvidenciaHis | null;
}

// ─────────────────────────────────────────────────────────────
// Constantes de criterio
// ─────────────────────────────────────────────────────────────

const MS_MIN = 60_000;
const MS_HORA = 60 * MS_MIN;
const MS_DIA = 24 * MS_HORA;

/** Solo son "relevantes" las citas de los últimos 30 días en adelante (más viejas son historia). */
export const VENTANA_CITAS_DIAS = 30;
/** Igual que el semáforo del panel del espejo: más de 5 min sin latido = el agente no da señales. */
export const AGENTE_SIN_SENAL_MIN = 5;
/** Un evento que lleva más de esto en cola sin que el agente lo tome ya no es "en camino". */
export const COLA_ATASCADA_MIN = 10;
/** Igual que `MAX_DELIVERY_ATTEMPTS` del despacho. */
export const MAX_INTENTOS_ENTREGA = 10;

// ─────────────────────────────────────────────────────────────
// Ayudas de texto
// ─────────────────────────────────────────────────────────────

type Ctx = { tz?: string; ahoraMs: number };

const cuando = (iso: string, ctx: Ctx) =>
  formatAppointmentCompact(iso, { timeZone: ctx.tz });
const cuandoExacto = (iso: string, ctx: Ctx) =>
  formatAppointmentShort(iso, { timeZone: ctx.tz });

function hace(iso: string | null, ahoraMs: number): string {
  if (!iso) return 'un tiempo';
  const ms = Math.max(0, ahoraMs - Date.parse(iso));
  if (ms < 90 * 1000) return 'menos de 2 min';
  if (ms < MS_HORA) return `${Math.round(ms / MS_MIN)} min`;
  if (ms < 2 * MS_DIA) return `${Math.round(ms / MS_HORA)} h`;
  return `${Math.round(ms / MS_DIA)} días`;
}

const ORIGEN_TEXTO: Record<OrigenCita, string> = {
  WHATSAPP: 'WhatsApp',
  MANUAL: 'el personal (agendamiento manual)',
  MIRROR: 'el hospital (espejo del HIS)',
};

/** Frases para los motivos de fallo del bot que explican por qué no se llegó a confirmar. */
const MOTIVO_FALLO: Record<string, string> = {
  SLOT_TAKEN: 'el horario ya lo había tomado otro paciente',
  EPS_REGIME_NOT_BILLABLE:
    'la EPS y el régimen del paciente no tienen convenio para agendar por este medio',
  EPS_NOT_ENROLLED: 'la cédula no figura en el padrón de la EPS elegida',
  MAX_RETRIES: 'se agotaron los reintentos de la conversación',
  ABANDONED: 'la conversación se abandonó',
  SESSION_EXPIRED: 'la sesión expiró antes de confirmar',
  NO_AGENDA: 'no había agenda disponible',
  PATIENT_NOT_FOUND: 'no se encontró al paciente por la cédula dada',
  DOCTOR_NOT_FOUND: 'no se encontró al médico pedido',
  EPS_NOT_FOUND: 'no se reconoció la EPS',
  EPS_INACTIVE: 'la EPS elegida está inactiva',
};

function textoFallo(motivo: string): string {
  return MOTIVO_FALLO[motivo] ?? `motivo registrado: ${motivo}`;
}

function veredicto(
  codigo: CodigoVeredicto,
  campos: Omit<Veredicto, 'codigo' | 'severidad' | 'titulo' | 'citaId'> & {
    severidad?: Severidad;
    titulo?: string;
    citaId?: string | null;
  },
): Veredicto {
  const base = TEXTO_VEREDICTO[codigo];
  return {
    codigo,
    severidad: campos.severidad ?? base.severidad,
    titulo: campos.titulo ?? base.titulo,
    citaId: campos.citaId ?? null,
    fuente: campos.fuente,
    resumen: campos.resumen,
    evidencia: campos.evidencia,
    noSabemos: campos.noSabemos,
    accion: campos.accion,
    ...(campos.causa ? { causa: campos.causa } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// Lo que respondió el HIS en vivo (Fase 2)
// ─────────────────────────────────────────────────────────────

/** Qué tiene el HIS en el cupo de una cita, visto desde AgenIA. */
export type PresenciaHis =
  | { tipo: 'PRESENTE'; estado: EstadoCitaHis; consultadoIso: string }
  | { tipo: 'AUSENTE'; consultadoIso: string }
  /**
   * El HIS contestó por ese cupo, pero su respuesta no se pudo leer entera (una hora
   * en formato ilegible, o un recorte). NO es ausencia: es no saber.
   */
  | { tipo: 'ILEGIBLE'; consultadoIso: string }
  | {
      tipo: 'OTRA_PERSONA';
      estado: EstadoCitaHis;
      /** Enmascarado; `null` si la fila del HIS no trae documento. */
      documentoTercero: string | null;
      mismoConCeros: boolean;
      consultadoIso: string;
    };

function presenciaDelCupo(
  his: EvidenciaHis,
  doctorExternalKey: string,
  startIso: string,
): PresenciaHis | null {
  const cupo = his.cupos.find(
    (c) =>
      c.doctorExternalKey === doctorExternalKey &&
      mismoInstante(c.startIso, startIso),
  );
  // Ese cupo no se preguntó: no se puede afirmar nada, ni que esté ni que falte.
  if (!cupo) return null;
  const consultadoIso = his.consultadoIso;
  const o = ocupanteDelCupo(cupo.filas);
  if (o.tipo === 'NADIE') {
    // Sin filas legibles Y con la respuesta incompleta, «no hay nada» sería mentira:
    // pudo venir una cita cuya hora el hospital guardó de forma ilegible.
    return cupo.incompleto
      ? { tipo: 'ILEGIBLE', consultadoIso }
      : { tipo: 'AUSENTE', consultadoIso };
  }
  if (o.tipo === 'PACIENTE') {
    return { tipo: 'PRESENTE', estado: o.estado, consultadoIso };
  }
  return {
    tipo: 'OTRA_PERSONA',
    estado: o.estado,
    documentoTercero: o.documentoTercero,
    mismoConCeros: o.mismoConCeros,
    consultadoIso,
  };
}

/**
 * ¿Está la cita en el HIS? `null` = no se sabe (no se consultó, o el médico no
 * está homologado y no hay clave con la que buscar su cupo).
 */
export function presenciaEnHis(
  cita: { doctorExternalKey?: string | null; startIso: string },
  his: EvidenciaHis | null | undefined,
): PresenciaHis | null {
  if (!his || !cita.doctorExternalKey) return null;
  return presenciaDelCupo(his, cita.doctorExternalKey, cita.startIso);
}

const ESTADO_HIS_TEXTO: Record<EstadoCitaHis, string> = {
  SCHEDULED: 'vigente',
  ATTENDED: 'ya atendida',
  NO_SHOW: 'con inasistencia registrada',
  OTHER: 'en un estado que AgenIA no reconoce',
};

/**
 * Las citas del paciente en el HIS con el MISMO médico en las 24 h alrededor del
 * cupo: la pista más útil cuando "no está a esa hora" (quedó en otra).
 */
function citasCercanasEnHis(
  his: EvidenciaHis,
  doctorExternalKey: string,
  startIso: string,
  ctx: Ctx,
): string[] {
  const centro = Date.parse(startIso);
  return (his.porDocumento?.citas ?? [])
    .filter(
      (c) =>
        c.titular === 'PACIENTE' &&
        c.doctorExternalKey === doctorExternalKey &&
        !mismoInstante(c.startIso, startIso) &&
        Math.abs(Date.parse(c.startIso) - centro) <= MS_DIA,
    )
    .slice(0, 3)
    .map(
      (c) =>
        `El HIS sí tiene al paciente con ese médico el ${cuando(c.startIso, ctx)} (${ESTADO_HIS_TEXTO[c.status]}).`,
    );
}

function textoEstadoSync(s: EstadoSync): string {
  switch (s.estado) {
    case 'DEAD_LETTER':
      return `rendido tras ${s.attempts} intento(s)`;
    case 'RETRYING':
      return `en reintento (intento ${s.attempts} de ${MAX_INTENTOS_ENTREGA})`;
    case 'PENDING':
      return 'en cola';
    case 'NO_EVENT':
      return 'inexistente';
    default:
      return 'entregado';
  }
}

/** Cómo se dice, en una frase, que el documento del HIS no es el del paciente. */
function frasePorOtroDocumento(
  p: Extract<PresenciaHis, { tipo: 'OTRA_PERSONA' }>,
): string {
  const doc = p.documentoTercero ? ` (${p.documentoTercero})` : '';
  return p.mismoConCeros
    ? `el mismo número de documento pero con ceros a la izquierda distintos${doc}`
    : `otro documento${doc}`;
}

/**
 * Notas del escenario A con lo que el HIS tiene del paciente: sus citas que
 * AgenIA no conoce (típicamente las de ventanilla) y las que AgenIA canceló y
 * el HIS conserva.
 */
function notasHisA(ev: EvidenciaRastreoA, ctx: Ctx): string[] {
  const doc = ev.his?.porDocumento;
  if (!doc) return [];
  const notas: string[] = [];
  const coincide = (
    h: { doctorExternalKey: string; startIso: string },
    c: CitaRastreo,
  ) =>
    !!c.doctorExternalKey &&
    c.doctorExternalKey === h.doctorExternalKey &&
    mismoInstante(c.startIso, h.startIso);

  const propias = doc.citas.filter((h) => h.titular === 'PACIENTE');
  const desconocidas = propias.filter(
    (h) => !ev.citas.some((c) => coincide(h, c)),
  );
  if (desconocidas.length > 0) {
    const lista = desconocidas
      .slice(0, 3)
      .map((h) => `${cuando(h.startIso, ctx)} (${ESTADO_HIS_TEXTO[h.status]})`)
      .join('; ');
    notas.push(
      `El HIS tiene ${desconocidas.length} cita(s) de este paciente que AgenIA no tiene registradas (por ejemplo, agendadas en ventanilla): ${lista}${desconocidas.length > 3 ? ' y otras' : ''}.`,
    );
  }

  // Canceladas en AgenIA que el hospital sigue teniendo vigentes: la cancelación no llegó.
  for (const h of propias.filter((x) => x.status === 'SCHEDULED')) {
    const canceladaAqui = ev.citas.find(
      (c) => c.status === 'CANCELLED' && coincide(h, c),
    );
    if (canceladaAqui) {
      notas.push(
        `La cita del ${cuando(h.startIso, ctx)} figura cancelada en AgenIA, pero el HIS la conserva vigente: la cancelación no llegó al hospital.`,
      );
    }
  }

  if (doc.truncado) {
    notas.push(
      'La lista de citas del HIS se recortó al máximo: puede haber más.',
    );
  }
  return notas;
}

// ─────────────────────────────────────────────────────────────
// Escenario A
// ─────────────────────────────────────────────────────────────

/**
 * Clasifica lo que AgenIA sabe de un paciente para el escenario A:
 * "dice que agendó por WhatsApp y el HIS no la tiene".
 *
 * Orden (§3.3): ¿hay cita relevante? → sí: un veredicto por cita
 * (`CANCELADA` → causa técnica de sync → vigente); no: ausencia
 * (`FUERA_DE_ALCANCE` → lista de espera → conversación sin cita → sin rastro).
 * Lo barato (la base de AgenIA) va antes que lo caro (el HIS en vivo, Fase 2).
 */
export function clasificarRastreoA(ev: EvidenciaRastreoA): ResultadoRastreo {
  const ctx: Ctx = { tz: ev.zonaHoraria, ahoraMs: Date.parse(ev.ahoraIso) };
  const notas: string[] = [];

  const relevantes = ordenarCitas(
    ev.citas.filter((c) => esRelevante(c, ctx.ahoraMs)),
    ctx.ahoraMs,
  );

  let veredictos: Veredicto[];
  if (relevantes.length > 0) {
    veredictos = relevantes.map((c) => veredictoDeCita(c, ev, ctx));
    if (ev.citasOcultas > 0) {
      notas.push(
        `Hay ${ev.citasOcultas} cita(s) de este paciente fuera de tu alcance (EPS o médico asignados) que no se muestran.`,
      );
    }
  } else {
    veredictos = [veredictoSinCitas(ev, ctx)];
  }

  if (ev.capturaIndicada) {
    const coinciden = ev.citas.filter((c) => c.coincideConCaptura === true);
    if (coinciden.length > 0) {
      notas.push(
        `La captura coincide con la cita del ${cuando(coinciden[0].startIso, ctx)}.`,
      );
    } else {
      notas.push(
        'Ninguna cita registrada del paciente coincide con la fecha, la hora o el médico que muestra la captura.',
      );
    }
  }

  notas.push(...notasHisA(ev, ctx));

  // El principal: primero lo que coincide con la captura; luego lo más accionable.
  const idsCaptura = new Set(
    ev.citas.filter((c) => c.coincideConCaptura === true).map((c) => c.id),
  );
  const ordenados = [...veredictos].sort((a, b) => {
    const ca = a.citaId && idsCaptura.has(a.citaId) ? 0 : 1;
    const cb = b.citaId && idsCaptura.has(b.citaId) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return PRIORIDAD[a.codigo] - PRIORIDAD[b.codigo];
  });

  return { principal: ordenados[0], veredictos: ordenados, notas };
}

function esRelevante(c: CitaRastreo, ahoraMs: number): boolean {
  if (c.coincideConCaptura === true) return true;
  const desde = ahoraMs - VENTANA_CITAS_DIAS * MS_DIA;
  if (Date.parse(c.startIso) < desde) return false;
  return c.status === 'SCHEDULED' || c.status === 'CANCELLED';
}

/** Lo que viene primero y luego lo ya pasado, del más reciente al más viejo. */
function ordenarCitas(citas: CitaRastreo[], ahoraMs: number): CitaRastreo[] {
  const futuras = citas
    .filter((c) => Date.parse(c.startIso) >= ahoraMs)
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
  const pasadas = citas
    .filter((c) => Date.parse(c.startIso) < ahoraMs)
    .sort((a, b) => Date.parse(b.startIso) - Date.parse(a.startIso));
  return [...futuras, ...pasadas];
}

// ── Sin citas relevantes ────────────────────────────────────

function veredictoSinCitas(ev: EvidenciaRastreoA, ctx: Ctx): Veredicto {
  if (ev.citasOcultas > 0) {
    return veredicto('FUERA_DE_ALCANCE', {
      fuente: 'AGENIA',
      resumen:
        'El paciente sí tiene citas, pero están fuera de tu alcance de EPS o médico, así que no puedes concluir que no tiene cita.',
      evidencia: [`Hay ${ev.citasOcultas} cita(s) que tu perfil no puede ver.`],
      noSabemos: ['Qué citas son ni en qué estado están.'],
      accion:
        'Pídele a un administrador de la clínica que lo consulte. No le digas al paciente que no tiene cita.',
    });
  }

  const activa = ev.espera.find(
    (e) => e.status === 'WAITING' || e.status === 'NOTIFIED',
  );
  if (activa) {
    const avisado = activa.status === 'NOTIFIED' && activa.avisadoIso;
    return veredicto('EN_LISTA_DE_ESPERA', {
      fuente: 'AGENIA',
      resumen: avisado
        ? 'Se le avisó de un cupo y está pendiente de que responda: todavía no tiene cita.'
        : 'Quedó en lista de espera de un servicio: eso no es una cita.',
      evidencia: [
        `Lista de espera de ${activa.servicio} desde el ${cuandoExacto(activa.desdeIso, ctx)}.`,
        ...(avisado
          ? [`Se le avisó de un cupo el ${cuandoExacto(activa.avisadoIso!, ctx)}.`]
          : []),
      ],
      noSabemos: [],
      accion: avisado
        ? 'Decirle que debe responder SÍ al aviso de WhatsApp antes de que expire para quedarse con el cupo.'
        : 'Aclararle que "te avisamos si se libera un cupo" no es una cita confirmada. Si prefiere, agendar en otro horario.',
    });
  }

  if (ev.conversacion && ev.conversacion.mensajes > 0) {
    const conv = ev.conversacion;
    const evidencia = [
      `Hay ${conv.mensajes} mensaje(s) con el bot entre el ${cuandoExacto(conv.primerMensajeIso ?? conv.ultimoMensajeIso!, ctx)} y el ${cuandoExacto(conv.ultimoMensajeIso!, ctx)}.`,
      'Ninguno de esos intercambios terminó en una cita confirmada.',
    ];
    if (conv.fallos.length > 0) {
      const f = conv.fallos[0];
      evidencia.push(
        `Lo último que registró el bot fue un fallo el ${cuandoExacto(f.atIso, ctx)}: ${textoFallo(f.motivo)}.`,
      );
    }
    return veredicto('NUNCA_CONFIRMO', {
      fuente: 'AGENIA',
      resumen:
        'Conversó con el bot, pero AgenIA no registra que haya llegado a confirmar una cita.',
      evidencia,
      noSabemos: [
        'Lo que el paciente vio en su teléfono: solo consta lo que el bot registró.',
      ],
      accion:
        'Ofrecer agendar ahora. Pedirle que muestre la captura: suele ser el menú de opciones o un mensaje anterior a la confirmación.',
    });
  }

  const evidencia = [
    ev.pacienteEncontrado
      ? `El paciente existe, pero no tiene citas de los últimos ${VENTANA_CITAS_DIAS} días.`
      : 'No hay un perfil con ese dato en esta clínica.',
    'No hay lista de espera activa ni conversación con el bot.',
  ];
  const noSabemos = [
    'Esto no prueba que no haya agendado: pudo usar otro número u otra cédula, o ser un registro anterior.',
  ];
  if (ev.conversacion === null) {
    noSabemos.push('Tu perfil no muestra la conversación con el bot.');
  }
  return veredicto('SIN_RASTRO', {
    fuente: 'AGENIA',
    resumen: 'AgenIA no tiene registro de una cita reciente ni de una conversación.',
    evidencia,
    noSabemos,
    accion:
      'Pedirle el número de WhatsApp desde el que escribió, la fecha aproximada y el documento con el que se identificó, y buscar de nuevo.',
  });
}

// ── Un veredicto por cita ───────────────────────────────────

function veredictoDeCita(
  c: CitaRastreo,
  ev: EvidenciaRastreoA,
  ctx: Ctx,
): Veredicto {
  const descripcion = `Cita del ${cuando(c.startIso, ctx)} con ${c.doctor} (${c.service})`;

  if (c.status === 'CANCELLED') return veredictoCancelada(c, descripcion, ctx);

  const evidencia = [
    `${descripcion}.`,
    `Creada por ${ORIGEN_TEXTO[c.origin]} el ${cuandoExacto(c.createdAtIso, ctx)}.`,
  ];
  const noSabemos: string[] = [];
  const conf = lineasConfirmacion(c, ctx);
  evidencia.push(...conf.evidencia);
  noSabemos.push(...conf.noSabemos);

  // Una cita que ya se atendió (o en la que el hospital registró la inasistencia)
  // no necesita explicar su envío: si el paciente asistió, el hospital la tenía.
  // Y el desenlace es justo lo que se discute en una reclamación.
  if (c.status === 'COMPLETED' || c.attendance !== 'PENDING') {
    evidencia.push(
      c.attendance === 'NO_SHOW'
        ? 'El hospital registró que el paciente no asistió a esta cita.'
        : 'El hospital registró que el paciente asistió a esta cita.',
    );
    return veredicto('CITA_VIGENTE', {
      fuente: 'AGENIA',
      resumen:
        c.attendance === 'NO_SHOW'
          ? 'La cita existió y quedó registrada como inasistencia.'
          : 'La cita existió y ya se atendió.',
      evidencia,
      noSabemos,
      accion: 'No hay nada que corregir del lado de AgenIA.',
      citaId: c.id,
    });
  }

  // ¿Aplica el envío al HIS? Solo a citas nacidas en AgenIA y si este rol ve el sync.
  const aplicaSync = ev.espejo !== null && c.sync !== null && c.origin !== 'MIRROR';
  if (!aplicaSync) {
    return veredicto('CITA_VIGENTE', {
      fuente: 'AGENIA',
      resumen:
        c.origin === 'MIRROR'
          ? 'La cita nació en el HIS y AgenIA la tiene registrada.'
          : 'La cita existe y está vigente en AgenIA.',
      evidencia,
      noSabemos,
      accion: 'No hay nada que corregir del lado de AgenIA.',
      citaId: c.id,
    });
  }

  const s = c.sync!;
  const e = ev.espejo!;
  const salud = saludDelEspejo(e, ctx);

  // ── Con la consulta en vivo, el HIS tiene la última palabra ──
  const presencia = presenciaEnHis(c, ev.his);
  const horaHis = ev.his ? cuandoExacto(ev.his.consultadoIso, ctx) : '';
  if (presencia?.tipo === 'PRESENTE') {
    evidencia.push(
      `Consulta en vivo al HIS (${horaHis}): el cupo figura a nombre del paciente, ${ESTADO_HIS_TEXTO[presencia.estado]}.`,
    );
    if (s.estado !== 'DELIVERED') {
      evidencia.push(
        `AgenIA todavía muestra el evento de envío como ${textoEstadoSync(s)}, pero el hospital ya la tiene.`,
      );
    }
    return veredicto('CONFIRMADA_EN_EL_HIS', {
      fuente: 'AGENIA_Y_HIS',
      resumen:
        'La cita está en AgenIA y también en el hospital, a nombre del paciente: los dos sistemas coinciden.',
      evidencia,
      noSabemos,
      accion:
        'Si el paciente o el hospital dicen no verla, comparar cómo la buscan: el HIS la tiene con el documento del paciente, en ese médico y esa hora.',
      citaId: c.id,
    });
  }
  if (presencia?.tipo === 'OTRA_PERSONA') {
    evidencia.push(
      `Consulta en vivo al HIS (${horaHis}): ese médico y esa hora existen en el HIS y figuran a nombre de ${frasePorOtroDocumento(presencia)}.`,
    );
    return veredicto('OTRA_IDENTIDAD', {
      fuente: 'AGENIA_Y_HIS',
      resumen: presencia.mismoConCeros
        ? 'El hospital tiene esa hora a nombre del mismo número de documento, pero escrito con ceros a la izquierda distintos: casi seguro es la misma persona mal digitada en uno de los dos sistemas.'
        : 'El hospital tiene esa hora a nombre de otro documento: puede ser un error de digitación al agendar, o que la reservara un familiar.',
      evidencia,
      noSabemos: [
        ...noSabemos,
        'AgenIA no puede saber a quién pertenece el otro documento ni cuál de los dos sistemas tiene el dato correcto.',
      ],
      accion: presencia.mismoConCeros
        ? 'Corregir el documento (la misma cadena, sin ceros de más) en el sistema donde esté mal escrito.'
        : 'Confirmar en ventanilla con quién se agendó esa hora. Si fue un error de digitación, corregir el documento en el HIS; si esa persona no es el paciente, reubicarlo.',
      citaId: c.id,
    });
  }
  // El HIS contestó por el cupo pero su respuesta no se pudo leer: NO es ausencia.
  // Se deja dicho en la evidencia y la cita se queda «sin verificar», que es la verdad.
  if (presencia?.tipo === 'ILEGIBLE') {
    evidencia.push(
      `Consulta en vivo al HIS (${horaHis}): la respuesta sobre ese cupo llegó incompleta y no se pudo verificar si la cita está allá.`,
    );
  }
  const lineasAusente =
    presencia?.tipo === 'AUSENTE'
      ? [
          `Consulta en vivo al HIS (${horaHis}): no hay ninguna cita en ese médico y esa hora.`,
          ...citasCercanasEnHis(ev.his!, c.doctorExternalKey!, c.startIso, ctx),
        ]
      : [];
  const fuente: FuenteVeredicto = presencia ? 'AGENIA_Y_HIS' : 'AGENIA';

  if (s.estado === 'DELIVERED') {
    evidencia.push(
      `AgenIA la entregó al agente del hospital el ${cuandoExacto(s.deliveredAtIso ?? s.creadoIso ?? c.createdAtIso, ctx)}.`,
    );
    if (presencia?.tipo === 'AUSENTE') {
      evidencia.push(...lineasAusente);
      return veredicto('ENTREGADA_PERO_AUSENTE', {
        fuente: 'AGENIA_Y_HIS',
        resumen:
          'AgenIA entregó la cita al hospital, pero el HIS no la tiene en ese cupo: los dos sistemas no coinciden.',
        evidencia,
        noSabemos: [
          ...noSabemos,
          'AgenIA no sabe por qué desapareció: pudo cancelarla el hospital sin que llegara el aviso, o no haberse escrito nunca en su sistema.',
        ],
        accion:
          'Escalar: es una deriva entre los dos sistemas. Mientras tanto, agendar al paciente directamente en el HIS y avisarle. Un administrador puede revisar los conflictos y la última reconciliación en el panel del espejo.',
        citaId: c.id,
      });
    }
    return veredicto('ENTREGADA_SIN_VERIFICAR', {
      fuente: 'AGENIA',
      resumen:
        'AgenIA hizo su parte: la cita salió hacia el hospital. Si el HIS no la muestra, el problema está del lado del hospital o del documento.',
      evidencia,
      noSabemos: [
        ...noSabemos,
        'AgenIA no puede ver el HIS: no verifica que la cita siga ahí ni a nombre de quién quedó (eso lo dará la consulta en vivo).',
      ],
      accion:
        'Pedir en ventanilla que busquen por el documento y por el médico y la hora exactos: puede haber quedado a nombre de otro documento. Si sigue sin aparecer, escalar.',
      citaId: c.id,
    });
  }

  // No entregada: hay que decir por qué.
  const causa = causaNoLlego(s, e, ctx);
  if (causa === 'EN_CAMINO') {
    evidencia.push(
      `El evento de envío lleva ${hace(s.oldestPendingIso ?? s.creadoIso, ctx.ahoraMs)} en cola y el agente está al día.`,
    );
    evidencia.push(...lineasAusente);
    return veredicto('EN_CAMINO_AL_HIS', {
      fuente,
      resumen:
        'La cita se acaba de crear y va en camino al HIS: es normal que tarde unos segundos.',
      evidencia,
      noSabemos,
      accion: 'Esperar unos minutos y volver a consultar.',
      citaId: c.id,
    });
  }

  evidencia.push(...detalleDeCausa(causa, s, ctx));
  evidencia.push(...salud);
  evidencia.push(...lineasAusente);
  return veredicto('CONFIRMADA_NO_LLEGO', {
    fuente,
    resumen:
      'El paciente tiene la cita confirmada en AgenIA, pero el hospital NO la tiene todavía. Su versión es coherente con lo registrado.',
    evidencia,
    noSabemos: [
      ...noSabemos,
      ...(causa === 'NO_EVENT'
        ? ['Puede ser una cita anterior a la activación del espejo, o creada mientras estaba apagado: en ese caso el trigger no genera evento.']
        : []),
    ],
    accion: accionDeCausa(causa),
    citaId: c.id,
    causa,
  });
}

function veredictoCancelada(
  c: CitaRastreo,
  descripcion: string,
  ctx: Ctx,
): Veredicto {
  const evidencia = [`${descripcion}.`];
  const noSabemos: string[] = [];
  const can = c.cancelacion;

  if (can?.por === 'PACIENTE_WHATSAPP') {
    evidencia.push(
      `La canceló el paciente por WhatsApp${can.atIso ? ` el ${cuandoExacto(can.atIso, ctx)}` : ''}.`,
    );
  } else if (can?.por === 'HIS') {
    evidencia.push(
      `La canceló el hospital desde su sistema${can.atIso ? ` el ${cuandoExacto(can.atIso, ctx)}` : ''}${can.motivo ? ` (motivo: ${can.motivo})` : ''}.`,
    );
  } else if (can?.por === 'PERSONAL') {
    evidencia.push(
      `La canceló el personal de la clínica${can.actor ? ` (${can.actor})` : ''}${can.atIso ? ` el ${cuandoExacto(can.atIso, ctx)}` : ''}.`,
    );
    if (!can.atIso) {
      noSabemos.push('La constancia de la cancelación no trae una fecha legible.');
    }
  } else {
    evidencia.push('AgenIA no tiene registro de quién la canceló.');
    // Solo las cancelaciones ANTERIORES a que el panel dejara constancia caen
    // aquí; las de ahora en adelante salen como `PERSONAL`. Se dice así para no
    // dar a entender que el panel sigue sin registrar nada.
    noSabemos.push(
      'Las cancelaciones hechas desde el panel del personal antes de que se registrara quién las hacía no dejan constancia de quién ni cuándo.',
    );
  }

  return veredicto('CANCELADA', {
    fuente: 'AGENIA',
    resumen:
      'La cita ya no está vigente: por eso no aparece en el hospital ni en WhatsApp.',
    evidencia,
    noSabemos,
    accion:
      can?.por === 'PERSONAL'
        ? 'Decirle que la canceló el personal de la clínica y cuándo. Si el paciente asegura que no lo pidió, revisarlo con quien la canceló; si aún necesita la cita, agendar de nuevo.'
        : 'Decirle quién y cuándo se canceló. Si aún necesita la cita, agendar de nuevo.',
    citaId: c.id,
  });
}

// ── Mensaje de confirmación ─────────────────────────────────

function lineasConfirmacion(
  c: CitaRastreo,
  ctx: Ctx,
): { evidencia: string[]; noSabemos: string[] } {
  const evidencia: string[] = [];
  const noSabemos: string[] = [];
  const m = c.confirmacion;

  if (!m) {
    if (c.origin === 'WHATSAPP') {
      noSabemos.push(
        'No hay registro de la confirmación por WhatsApp (los mensajes enviados antes de que existiera el libro de mensajes no quedaron registrados).',
      );
    }
  } else {
    const enviado = cuandoExacto(m.enviadoIso, ctx);
    switch (m.status) {
      case 'READ':
        evidencia.push(
          `La confirmación por WhatsApp se envió el ${enviado} y Meta la reporta LEÍDA el ${cuandoExacto(m.estadoIso, ctx)}.`,
        );
        break;
      case 'DELIVERED':
        evidencia.push(
          `La confirmación por WhatsApp se envió el ${enviado} y Meta la reporta ENTREGADA el ${cuandoExacto(m.estadoIso, ctx)}.`,
        );
        break;
      case 'FAILED':
        evidencia.push(
          `La confirmación por WhatsApp NO se entregó: Meta la marcó como fallida${m.errorDetalle ? ` (${m.errorDetalle})` : ''}.`,
        );
        break;
      default:
        evidencia.push(
          `Meta aceptó la confirmación por WhatsApp el ${enviado}, pero no ha reportado su entrega.`,
        );
    }
  }

  if (c.confirmadaEnConversacion === false && c.origin === 'WHATSAPP') {
    noSabemos.push(
      'La conversación con el bot no tiene el registro de confirmación de esta cita.',
    );
  }
  return { evidencia, noSabemos };
}

// ── Causa de que no haya llegado ────────────────────────────

type CausaInterna = CausaNoLlego | 'EN_CAMINO';

function agenteSilencioso(e: SaludEspejo, ahoraMs: number): boolean {
  if (!e.lastHeartbeatIso) return true;
  return ahoraMs - Date.parse(e.lastHeartbeatIso) > AGENTE_SIN_SENAL_MIN * MS_MIN;
}

function causaNoLlego(s: EstadoSync, e: SaludEspejo, ctx: Ctx): CausaInterna {
  if (s.estado === 'DEAD_LETTER') return 'DEAD_LETTER';
  if (s.estado === 'RETRYING') return 'RETRYING';
  if (!e.enabled) return 'MIRROR_OFF';
  if (!e.pushEnabled) return 'PUSH_OFF';
  if (s.estado === 'NO_EVENT') return 'NO_EVENT';
  // PENDING
  if (agenteSilencioso(e, ctx.ahoraMs)) return 'AGENT_SILENT';
  if (e.hisReachable === false) return 'HIS_UNREACHABLE';
  const desde = s.oldestPendingIso ?? s.creadoIso;
  if (desde && ctx.ahoraMs - Date.parse(desde) > COLA_ATASCADA_MIN * MS_MIN) {
    return 'PENDING_STALE';
  }
  return 'EN_CAMINO';
}

function detalleDeCausa(
  causa: CausaNoLlego,
  s: EstadoSync,
  ctx: Ctx,
): string[] {
  switch (causa) {
    case 'DEAD_LETTER':
      return [
        `El evento de envío se rindió tras ${s.attempts} intento(s): nadie lo reintentará solo.`,
        s.lastError
          ? `Motivo que reportó el agente: ${s.lastError}`
          : 'El motivo no quedó registrado (el evento es anterior a que se guardaran los motivos de fallo).',
      ];
    case 'RETRYING':
      return [
        `El agente lo está reintentando: intento ${s.attempts} de ${MAX_INTENTOS_ENTREGA}${s.nextAttemptIso ? `, próximo reintento a las ${cuandoExacto(s.nextAttemptIso, ctx)}` : ''}.`,
        ...(s.lastError ? [`Último motivo: ${s.lastError}`] : []),
      ];
    case 'PENDING_STALE':
      return [
        `El evento lleva ${hace(s.oldestPendingIso ?? s.creadoIso, ctx.ahoraMs)} en cola sin que el agente lo tome.`,
      ];
    case 'AGENT_SILENT':
      return [
        'El evento está en cola y el agente del hospital no está tomándolo.',
      ];
    case 'HIS_UNREACHABLE':
      return ['El evento está en cola y el agente no alcanza el sistema del hospital.'];
    case 'MIRROR_OFF':
      return [
        'El espejo con el HIS está apagado para esta clínica: ninguna cita se está enviando al hospital.',
      ];
    case 'PUSH_OFF':
      return [
        'El envío de AgenIA hacia el hospital está apagado (interruptor de emergencia): las citas no salen.',
      ];
    case 'NO_EVENT':
      return [
        'AgenIA no tiene ningún evento de envío al HIS para esta cita.',
      ];
  }
}

/** Contexto de la salud del agente, que aplica aunque la causa sea otra. */
function saludDelEspejo(e: SaludEspejo, ctx: Ctx): string[] {
  const lineas: string[] = [];
  if (e.enabled && agenteSilencioso(e, ctx.ahoraMs)) {
    lineas.push(
      e.lastHeartbeatIso
        ? `El agente no da señales desde hace ${hace(e.lastHeartbeatIso, ctx.ahoraMs)}.`
        : 'El agente nunca ha dado señales.',
    );
  }
  if (e.hisReachable === false) {
    lineas.push(
      `El agente está vivo pero no alcanza el HIS${e.hisDetail ? `: ${e.hisDetail}` : ''}.`,
    );
  }
  return lineas;
}

function accionDeCausa(causa: CausaNoLlego): string {
  switch (causa) {
    case 'DEAD_LETTER':
      return 'Mirar el motivo. Si es un cupo ya vendido en el HIS, reubicar al paciente: el hospital gana. Si es un dato faltante o el HIS estuvo caído, un administrador puede reprocesar el evento desde el panel del espejo.';
    case 'RETRYING':
      return 'Esperar el próximo reintento: si el HIS estuvo caído, se resuelve solo. Si sigue fallando, se rendirá tras 10 intentos y aparecerá en el panel del espejo.';
    case 'PENDING_STALE':
    case 'AGENT_SILENT':
      return 'Avisar a TI del hospital: el agente del espejo no está funcionando. Mientras tanto, agendar al paciente directamente en el HIS.';
    case 'HIS_UNREACHABLE':
      return 'Avisar a TI del hospital: el agente está vivo pero no llega al sistema. Mientras tanto, agendar al paciente directamente en el HIS.';
    case 'MIRROR_OFF':
    case 'PUSH_OFF':
      return 'Un administrador debe reactivar el espejo o el envío desde el panel del espejo. Mientras tanto, agendar al paciente directamente en el HIS.';
    case 'NO_EVENT':
      return 'Escalar: una cita creada con el espejo activo debería tener su evento. Mientras tanto, agendar al paciente directamente en el HIS.';
  }
}

// ─────────────────────────────────────────────────────────────
// Escenario B
// ─────────────────────────────────────────────────────────────

/** Un evento del HIS que AgenIA auditó para ese cupo (`SyncAudit`, dirección INBOUND). */
export interface AuditoriaCupo {
  resultado: 'OK' | 'SKIPPED' | 'ERROR' | 'CONFLICT';
  op: string;
  /** El detalle de la auditoría, sin la clave `cupo=…`. */
  nota: string;
  atIso: string;
}

export interface EvidenciaRastreoB {
  ahoraIso: string;
  zonaHoraria?: string;
  /** "Dr(a). X, mar 22 sep, 10:00 a. m.": el cupo que el HIS dice tener. */
  cupoDescripcion: string;
  /** El cupo consultado (médico del HIS y hora): con él se ubica la respuesta en vivo. */
  cupo?: { doctorExternalKey: string; startIso: string } | null;
  paciente: {
    perfilEncontrado: boolean;
    /** Cómo se halló el perfil: el documento tal cual o sin ceros a la izquierda. */
    coincidencia: 'EXACTA' | 'SIN_CEROS' | null;
    /** Otros perfiles cuyo documento difiere del escrito solo por ceros a la izquierda. */
    perfilesConVariante: number;
    conWhatsapp: boolean;
  };
  cupoEnAgenIA: {
    medicoHomologado: boolean;
    cupoExiste: boolean;
    auditorias: AuditoriaCupo[];
    /** ¿AgenIA tiene una cita vigente de ESTE paciente en ese cupo? */
    citaDelPacienteEnAgenIA: boolean;
  };
  /** null = la clínica no tiene espejo. */
  espejo: SaludEspejo | null;
  /** Lo que el HIS respondió en vivo (Fase 2). Ausente = no se consultó. */
  his?: EvidenciaHis | null;
}

/**
 * La marca que el espejo deja en la auditoría cuando ocupa el cupo pero NO crea la
 * cita. Se **exporta** para que quien la escribe (`MirrorApplyService`) y quien la
 * lee (el veredicto de aquí abajo) usen la misma cadena: cuando eran dos literales
 * sueltos, el alta en caliente reescribió la nota y el veredicto dejó de reconocerla
 * en silencio — sin fallar ninguna prueba, porque cada lado probaba su propio texto.
 */
export const NOTA_SIN_APPOINTMENT = 'no se creó Appointment';
const NOTA_FALTA_CUPO = 'falta generar el cupo';

/**
 * Clasifica el escenario B: "la agendaron en el HIS y no le aparece en
 * WhatsApp". Sin la consulta en vivo (Fase 2) AgenIA no puede afirmar que la
 * cita EXISTA en el HIS ni a nombre de quién está: solo sabe qué evento del
 * hospital recibió para ese cupo. Cada veredicto lo dice en `noSabemos`.
 */
export function clasificarRastreoB(ev: EvidenciaRastreoB): ResultadoRastreo {
  const ctx: Ctx = { tz: ev.zonaHoraria, ahoraMs: Date.parse(ev.ahoraIso) };
  const notas: string[] = [];
  const veredictos: Veredicto[] = [veredictoDelCupo(ev, ctx)];

  const p = ev.paciente;
  if (p.perfilesConVariante > 0 || (p.perfilEncontrado && p.coincidencia === 'SIN_CEROS')) {
    veredictos.push(
      veredicto('IDENTIDAD_NO_COINCIDE', {
        fuente: 'AGENIA',
        resumen:
          'El documento escrito no coincide exactamente con el del perfil de AgenIA: probablemente es la misma persona con el documento guardado de otra forma.',
        evidencia: [
          p.coincidencia === 'SIN_CEROS'
            ? 'El perfil se encontró solo al quitar los ceros a la izquierda del documento.'
            : `Hay ${p.perfilesConVariante} perfil(es) cuyo documento solo difiere por ceros a la izquierda.`,
        ],
        noSabemos: [
          'No se sabe cuál de los dos formatos tiene el HIS: el documento tiene que coincidir tal cual en ambos sistemas.',
        ],
        accion:
          'Comparar el documento del HIS con el de AgenIA y corregirlo en el sistema que corresponda (misma cadena, sin ceros de más).',
      }),
    );
  } else if (!p.perfilEncontrado) {
    notas.push(
      'El paciente no tiene perfil en AgenIA con ese documento: nunca escribió al bot de esta clínica, o lo hizo con otra cédula.',
    );
  } else if (!p.conWhatsapp) {
    notas.push(
      'El perfil existe pero no tiene un WhatsApp asociado: el bot no puede reconocerlo por su número.',
    );
  }

  const ordenados = aplicarHisB(ev, veredictos, ctx).sort(
    (a, b) => PRIORIDAD[a.codigo] - PRIORIDAD[b.codigo],
  );
  return { principal: ordenados[0], veredictos: ordenados, notas };
}

/**
 * Con la consulta en vivo (Fase 2), lo que el HIS dice del cupo pasa por encima
 * de lo que AgenIA solo puede deducir de sus eventos:
 *
 *  · nadie lo ocupa → `NO_ESTA_EN_EL_HIS`, y la ausencia de evento en AgenIA
 *    deja de ser un hallazgo aparte (la explica esto);
 *  · lo ocupa otro documento → `OTRA_IDENTIDAD`, sin quitar el resto;
 *  · lo ocupa el paciente → los veredictos de AgenIA se confirman con el HIS y
 *    dejan de decir "no sé a nombre de quién".
 */
function aplicarHisB(
  ev: EvidenciaRastreoB,
  veredictos: Veredicto[],
  ctx: Ctx,
): Veredicto[] {
  const his = ev.his;
  const cupoBuscado = ev.cupo;
  if (!his || !cupoBuscado) return veredictos;
  const presencia = presenciaDelCupo(
    his,
    cupoBuscado.doctorExternalKey,
    cupoBuscado.startIso,
  );
  if (!presencia) return veredictos;

  const hora = cuandoExacto(his.consultadoIso, ctx);
  const cupo = ev.cupoDescripcion;

  if (presencia.tipo === 'AUSENTE') {
    const nuevo = veredicto('NO_ESTA_EN_EL_HIS', {
      fuente: 'HIS_EN_VIVO',
      resumen:
        'El HIS no tiene ninguna cita en ese médico y esa hora: no hay una cita en ese cupo que el paciente pueda ver, ni en AgenIA ni en el hospital.',
      evidencia: [
        `${cupo}.`,
        `Consulta en vivo al HIS (${hora}): no hay ninguna cita en ese cupo.`,
        ...citasCercanasEnHis(
          his,
          cupoBuscado.doctorExternalKey,
          cupoBuscado.startIso,
          ctx,
        ),
      ],
      noSabemos: [
        'Por qué no está: pudo cancelarse, agendarse en otro cupo (mira las citas del paciente en el HIS, si aparecen arriba) o no haberse registrado nunca.',
      ],
      accion:
        'Confirmar en ventanilla la fecha, la hora y el médico exactos con el paciente. Si tiene un comprobante del hospital, la cita pudo cancelarse: revisar en el HIS quién y cuándo.',
    });
    // Que AgenIA no haya recibido un evento ya no es un hallazgo aparte: lo explica esto.
    return [nuevo, ...veredictos.filter((v) => v.codigo !== 'SIN_EVENTO_DEL_HIS')];
  }

  if (presencia.tipo === 'OTRA_PERSONA') {
    const nuevo = veredicto('OTRA_IDENTIDAD', {
      fuente: 'HIS_EN_VIVO',
      resumen: presencia.mismoConCeros
        ? 'El hospital tiene esa hora a nombre del mismo número de documento, pero escrito con ceros a la izquierda distintos: casi seguro es la misma persona mal digitada en uno de los dos sistemas.'
        : 'El hospital tiene esa hora a nombre de otro documento: puede ser un error de digitación al agendar, o que la reservara un familiar.',
      evidencia: [
        `${cupo}.`,
        `Consulta en vivo al HIS (${hora}): ese cupo existe y figura a nombre de ${frasePorOtroDocumento(presencia)}.`,
      ],
      noSabemos: [
        'AgenIA no puede saber a quién pertenece el otro documento ni cuál de los dos sistemas tiene el dato correcto.',
      ],
      accion: presencia.mismoConCeros
        ? 'Corregir el documento (la misma cadena, sin ceros de más) en el sistema donde esté mal escrito.'
        : 'Confirmar en ventanilla con quién se agendó esa hora. Si fue un error de digitación, corregir el documento en el HIS.',
    });
    return [nuevo, ...veredictos];
  }

  if (presencia.tipo === 'ILEGIBLE') {
    const nuevo = veredicto('HORA_ILEGIBLE_EN_EL_HIS', {
      fuente: 'HIS_EN_VIVO',
      resumen:
        'El hospital contestó por ese cupo, pero su respuesta no se pudo leer entera: puede haber una cita ahí. NO se puede afirmar que no exista.',
      evidencia: [
        `${cupo}.`,
        `Consulta en vivo al HIS (${hora}): la respuesta llegó incompleta (una hora guardada en un formato que AgenIA no puede interpretar, o un recorte por tope de filas).`,
      ],
      noSabemos: [
        'Si hay o no una cita en ese cupo. La consulta compara la hora exacta, y una hora que el hospital guardó en otro formato no coincide.',
      ],
      accion:
        'Mirar ese cupo directamente en la aplicación del hospital antes de concluir nada. Si se repite, avisar a soporte: es un dato del HIS que AgenIA no puede leer.',
    });
    return [nuevo, ...veredictos];
  }

  // PRESENTE: el HIS la tiene a nombre del paciente.
  const lineaHis = `Consulta en vivo al HIS (${hora}): el cupo figura a nombre del paciente, ${ESTADO_HIS_TEXTO[presencia.estado]}.`;
  return veredictos.map((v) => {
    switch (v.codigo) {
      case 'CITA_VIGENTE':
        return veredicto('CONFIRMADA_EN_EL_HIS', {
          fuente: 'AGENIA_Y_HIS',
          resumen:
            'La cita del paciente está en AgenIA y también en el HIS, en ese cupo: los dos sistemas coinciden.',
          evidencia: [...v.evidencia, lineaHis],
          noSabemos: [],
          accion: v.accion,
        });
      case 'SIN_EVENTO_DEL_HIS':
        return {
          ...v,
          fuente: 'AGENIA_Y_HIS',
          resumen:
            'El HIS sí tiene la cita a nombre del paciente, pero AgenIA no recibió del hospital ningún aviso de ella.',
          evidencia: [...v.evidencia, lineaHis],
          noSabemos: [],
          accion:
            'Escalar: el agente del espejo no reportó esa cita al servidor. Revisar el estado del agente y la última reconciliación en el panel del espejo.',
        };
      case 'CITA_DEL_HIS_NO_ESPEJADA':
      case 'MEDICO_NO_ESPEJADO':
      case 'SIN_CUPO':
      case 'EVENTO_DEL_HIS_NO_APLICADO':
        return {
          ...v,
          fuente: 'AGENIA_Y_HIS',
          evidencia: [...v.evidencia, lineaHis],
          // La consulta en vivo respondió lo que AgenIA no podía saber.
          noSabemos: v.noSabemos.filter((n) => !n.startsWith('A nombre de quién')),
        };
      default:
        return v;
    }
  });
}

function veredictoDelCupo(ev: EvidenciaRastreoB, ctx: Ctx): Veredicto {
  const c = ev.cupoEnAgenIA;
  const cupo = ev.cupoDescripcion;
  const auditorias = [...c.auditorias].sort(
    (a, b) => Date.parse(b.atIso) - Date.parse(a.atIso),
  );
  const lineaAuditoria = (a: AuditoriaCupo) =>
    `El ${cuandoExacto(a.atIso, ctx)} AgenIA registró un evento del HIS (${a.op}, ${a.resultado}): ${a.nota || 'sin nota'}.`;

  if (c.citaDelPacienteEnAgenIA) {
    return veredicto('CITA_VIGENTE', {
      fuente: 'AGENIA',
      resumen:
        'AgenIA sí tiene la cita de este paciente en ese cupo: el bot debería mostrársela.',
      evidencia: [`${cupo}.`, 'Hay una cita vigente del paciente en ese cupo.'],
      noSabemos: [],
      accion:
        'Pedirle que consulte "cancelar o reprogramar" en el bot con la misma cédula con la que se identificó.',
    });
  }

  if (!c.medicoHomologado) {
    return veredicto('MEDICO_NO_ESPEJADO', {
      fuente: 'AGENIA',
      resumen:
        'Ese médico no está en el espejo de AgenIA: sus citas no llegan al bot ni a los recordatorios. La cita del hospital es válida.',
      evidencia: [
        `${cupo}.`,
        'El médico del HIS no está homologado con ningún médico de AgenIA.',
        ...auditorias.filter((a) => a.resultado === 'SKIPPED').slice(0, 1).map(lineaAuditoria),
      ],
      noSabemos: [],
      accion:
        'Es por diseño: AgenIA solo espeja un subconjunto de la agenda del hospital. Decirle al paciente que su cita del hospital sigue vigente aunque el bot no la muestre.',
    });
  }

  if (!c.cupoExiste) {
    return veredicto('SIN_CUPO', {
      fuente: 'AGENIA',
      resumen:
        'El médico está en el espejo, pero AgenIA no tiene generado ese cupo: es una laguna real.',
      evidencia: [
        `${cupo}.`,
        'El médico está homologado y AgenIA no tiene un cupo a esa hora.',
        ...auditorias.filter((a) => a.resultado === 'ERROR').slice(0, 1).map(lineaAuditoria),
      ],
      noSabemos: [],
      accion:
        'Escalar: revisar la importación de agenda de ese médico (modo SHADOW/ON) y generar el cupo. Mientras tanto, la cita del hospital sigue siendo válida.',
    });
  }

  const sinCita = auditorias.find(
    (a) => a.resultado === 'OK' && a.nota.includes(NOTA_SIN_APPOINTMENT),
  );
  if (sinCita) {
    return veredicto('CITA_DEL_HIS_NO_ESPEJADA', {
      fuente: 'AGENIA',
      resumen:
        'El hospital agendó ese cupo y AgenIA lo ocupó para no volver a venderlo, pero no crea la cita del paciente: por eso el bot no se la muestra.',
      evidencia: [
        `${cupo}.`,
        lineaAuditoria(sinCita),
        'Cuando el paciente no está homologado, AgenIA solo marca el cupo como ocupado.',
      ],
      noSabemos: [
        'A nombre de quién está la cita en el HIS: AgenIA no guarda el documento (la consulta en vivo lo confirmaría).',
      ],
      accion:
        'Decirle que la cita del hospital es válida y que el bot no la muestra por esta razón. Ofrecerle la confirmación por WhatsApp: botón «Enviar confirmación por WhatsApp» de esta pantalla.',
    });
  }

  const noAplicado = auditorias.find(
    (a) => a.resultado === 'ERROR' || a.resultado === 'CONFLICT',
  );
  if (noAplicado) {
    const conflicto = noAplicado.resultado === 'CONFLICT';
    return veredicto('EVENTO_DEL_HIS_NO_APLICADO', {
      fuente: 'AGENIA',
      resumen: conflicto
        ? 'El hospital vendió un cupo que AgenIA ya tenía ocupado: hay doble agenda.'
        : 'AgenIA recibió el evento del hospital pero falló al aplicarlo.',
      evidencia: [`${cupo}.`, lineaAuditoria(noAplicado)],
      noSabemos: [],
      accion: conflicto
        ? 'Avisar al agendador: alguien tiene la misma hora en los dos sistemas. El hospital gana, hay que reubicar al paciente de AgenIA.'
        : 'Escalar con el detalle de la auditoría: es un fallo del motor del espejo, no del paciente.',
    });
  }

  if (auditorias.length > 0) {
    return veredicto('CITA_DEL_HIS_NO_ESPEJADA', {
      fuente: 'AGENIA',
      resumen:
        'AgenIA recibió el evento del hospital para ese cupo, pero no tiene la cita del paciente.',
      evidencia: [`${cupo}.`, lineaAuditoria(auditorias[0])],
      noSabemos: [
        'A nombre de quién está la cita en el HIS: AgenIA no guarda el documento.',
      ],
      accion:
        'Decirle que la cita del hospital es válida. Ofrecerle la confirmación por WhatsApp: botón «Enviar confirmación por WhatsApp» de esta pantalla.',
    });
  }

  const evidencia = [
    `${cupo}.`,
    'AgenIA no tiene ningún evento del HIS registrado para ese cupo.',
  ];
  if (ev.espejo) {
    if (!ev.espejo.enabled) {
      evidencia.push('El espejo está apagado para esta clínica.');
    } else if (!ev.espejo.pullEnabled) {
      evidencia.push(
        'La recepción de eventos del HIS hacia AgenIA está apagada (interruptor de emergencia).',
      );
    }
    evidencia.push(...saludDelEspejo(ev.espejo, ctx));
  }
  return veredicto('SIN_EVENTO_DEL_HIS', {
    fuente: 'AGENIA',
    resumen:
      'AgenIA no recibió del hospital ningún aviso de esa cita: no puede confirmar que exista.',
    evidencia,
    noSabemos: [
      'Si la cita existe en el HIS: el agente puede no haberla detectado aún, el evento puede ser anterior a que AgenIA dejara rastro, o la cita puede no existir.',
    ],
    accion:
      'Confirmar en ventanilla la fecha, la hora y el médico exactos. Si el agente no da señales, avisar a TI del hospital.',
  });
}

// ─────────────────────────────────────────────────────────────
// Línea de vida de una cita (§4.3)
// ─────────────────────────────────────────────────────────────

export type EstadoPaso = 'ok' | 'fail' | 'pending' | 'unknown' | 'na';

export interface PasoLinea {
  clave:
    | 'conversacion'
    | 'confirmacion_enviada'
    | 'confirmacion_entregada'
    | 'cita_creada'
    | 'evento_en_cola'
    | 'entregado_al_agente'
    | 'presente_en_el_his';
  etiqueta: string;
  estado: EstadoPaso;
  atIso: string | null;
  detalle: string | null;
}

/**
 * Los pasos por los que pasa una cita creada en AgenIA:
 * `Conversación → Confirmación enviada → Confirmación entregada → Cita creada →
 * Evento en cola → Entregado al agente → Presente en el HIS`.
 *
 * Cada paso dice qué se sabe: ✓ ok, ✗ falló, ⏳ pendiente, ? sin registro y
 * "na" cuando no aplica a esta cita o el rol no lo ve. El último paso queda
 * "sin verificar" hasta que se haga la consulta en vivo al HIS (Fase 2); con
 * ella pasa a ✓ (está a nombre del paciente) o ✗ (no está, o es de otro).
 */
export function construirLineaDeVida(
  c: CitaRastreo,
  opciones: { espejo: SaludEspejo | null; his?: EvidenciaHis | null },
): PasoLinea[] {
  const pasos: PasoLinea[] = [];
  const paso = (
    clave: PasoLinea['clave'],
    etiqueta: string,
    estado: EstadoPaso,
    atIso: string | null = null,
    detalle: string | null = null,
  ) => pasos.push({ clave, etiqueta, estado, atIso, detalle });

  // 1. Conversación
  if (c.origin !== 'WHATSAPP') {
    paso(
      'conversacion',
      'Conversación',
      'na',
      null,
      c.origin === 'MIRROR' ? 'Nació en el HIS.' : 'La agendó el personal.',
    );
  } else if (c.confirmadaEnConversacion === null) {
    paso('conversacion', 'Conversación', 'na', null, 'Tu perfil no ve la conversación.');
  } else if (c.confirmadaEnConversacion) {
    paso('conversacion', 'Conversación', 'ok', c.createdAtIso, 'El bot registró la confirmación.');
  } else {
    paso('conversacion', 'Conversación', 'unknown', null, 'La conversación no tiene el registro de confirmación.');
  }

  // 2 y 3. Mensaje de confirmación
  const m = c.confirmacion;
  if (!m) {
    paso('confirmacion_enviada', 'Confirmación enviada', 'unknown', null, 'Sin registro en el libro de mensajes.');
    paso('confirmacion_entregada', 'Confirmación entregada', 'unknown', null, 'Sin registro en el libro de mensajes.');
  } else {
    paso('confirmacion_enviada', 'Confirmación enviada', 'ok', m.enviadoIso);
    if (m.status === 'FAILED') {
      paso('confirmacion_entregada', 'Confirmación entregada', 'fail', m.estadoIso, m.errorDetalle ?? 'Meta la marcó como fallida.');
    } else if (m.status === 'DELIVERED' || m.status === 'READ') {
      paso('confirmacion_entregada', 'Confirmación entregada', 'ok', m.estadoIso, m.status === 'READ' ? 'Leída.' : null);
    } else {
      paso('confirmacion_entregada', 'Confirmación entregada', 'pending', null, 'Meta no ha reportado la entrega.');
    }
  }

  // 4. Cita creada
  paso('cita_creada', 'Cita creada', 'ok', c.createdAtIso);

  // 5, 6 y 7. Hacia el HIS
  const s = c.sync;
  if (!opciones.espejo || c.origin === 'MIRROR' || s === null) {
    const detalle = c.origin === 'MIRROR' ? 'Nació en el HIS.' : opciones.espejo ? 'Tu perfil no ve el estado de sync.' : 'Esta clínica no tiene espejo con un HIS.';
    paso('evento_en_cola', 'Evento en cola', 'na', null, detalle);
    paso('entregado_al_agente', 'Entregado al agente', 'na', null, detalle);
    paso('presente_en_el_his', 'Presente en el HIS', 'na', null, detalle);
    return pasos;
  }

  if (s.estado === 'NO_EVENT') {
    paso('evento_en_cola', 'Evento en cola', 'fail', null, 'AgenIA no tiene un evento de envío para esta cita.');
    paso('entregado_al_agente', 'Entregado al agente', 'unknown');
  } else {
    paso('evento_en_cola', 'Evento en cola', 'ok', s.creadoIso);
    if (s.estado === 'DELIVERED') {
      paso('entregado_al_agente', 'Entregado al agente', 'ok', s.deliveredAtIso);
    } else if (s.estado === 'DEAD_LETTER') {
      paso('entregado_al_agente', 'Entregado al agente', 'fail', null, s.lastError ?? `Se rindió tras ${s.attempts} intentos.`);
    } else if (s.estado === 'RETRYING') {
      paso('entregado_al_agente', 'Entregado al agente', 'pending', s.nextAttemptIso, `Intento ${s.attempts} de ${MAX_INTENTOS_ENTREGA}${s.lastError ? `: ${s.lastError}` : ''}`);
    } else {
      paso('entregado_al_agente', 'Entregado al agente', 'pending', null, 'En cola.');
    }
  }
  const presencia = presenciaEnHis(c, opciones.his);
  if (!presencia) {
    paso(
      'presente_en_el_his',
      'Presente en el HIS',
      'unknown',
      null,
      opciones.his
        ? 'Este cupo no se pudo consultar en el HIS (el médico no está homologado).'
        : 'Sin verificar: requiere la consulta en vivo al HIS.',
    );
  } else if (presencia.tipo === 'PRESENTE') {
    paso(
      'presente_en_el_his',
      'Presente en el HIS',
      'ok',
      presencia.consultadoIso,
      'Consultado en vivo: figura a nombre del paciente.',
    );
  } else if (presencia.tipo === 'AUSENTE') {
    paso(
      'presente_en_el_his',
      'Presente en el HIS',
      'fail',
      presencia.consultadoIso,
      'Consultado en vivo: el HIS no tiene esa cita.',
    );
  } else if (presencia.tipo === 'ILEGIBLE') {
    paso(
      'presente_en_el_his',
      'Presente en el HIS',
      'unknown',
      presencia.consultadoIso,
      'Consultado en vivo: el hospital contestó, pero su respuesta no se pudo leer entera.',
    );
  } else {
    paso(
      'presente_en_el_his',
      'Presente en el HIS',
      'fail',
      presencia.consultadoIso,
      `Consultado en vivo: el HIS la tiene a nombre de ${frasePorOtroDocumento(presencia)}.`,
    );
  }
  return pasos;
}
