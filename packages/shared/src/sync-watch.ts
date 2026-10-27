/**
 * El vigilante de la sincronización y su bandeja de excepciones
 * (docs/PLAN_RASTREO_PACIENTE.md §10 #2 y #3, Fase 3).
 *
 * Lógica PURA, compartida por las dos puntas:
 *   · la API, que VIGILA (un cron revisa el outbox y la auditoría, abre excepciones
 *     y avisa al agendador);
 *   · la web, que MUESTRA la bandeja y deja trabajarlas.
 *
 * Tienen que clasificar igual —es el riesgo que el plan §13 nombra: «el vigilante y
 * la pantalla clasifican distinto»—, por eso la clasificación (`derivarSync`, las
 * constantes de umbral) sale de un solo sitio y esto no lee ni escribe nada.
 */
import { formatAppointmentCompact } from './date-format';
import {
  COLA_ATASCADA_MIN,
  MAX_INTENTOS_ENTREGA,
  type EstadoSync,
} from './patient-trace';
import { derivarSync, type FilaOutbox } from './sync-state';

// ─────────────────────────────────────────────────────────────
// Vocabulario
// ─────────────────────────────────────────────────────────────

/**
 * Qué clase de problema es una excepción.
 *
 *  · `CITA_NO_ENTREGADA` — una cita de AgenIA (WhatsApp o del personal) cuyo envío al
 *    hospital lleva demasiado sin entregarse o se rindió, y aún no ha llegado la hora.
 *  · `EVENTO_RENDIDO`    — un cambio que no es de una cita (cupo, médico…) se rindió.
 *  · `CONFLICTO_SYNC` / `ERROR_SYNC` — lo que la auditoría registró como conflicto o error.
 *  · `DERIVA_EN_HIS`     — la reconciliación no encontró en el hospital una cita que
 *    AgenIA da por hecha (el paciente cree que tiene cita y allá no está).
 *  · `IDENTIDAD_AMBIGUA` — llegó una cita del hospital y hay más de un paciente de
 *    AgenIA que podría ser esa persona (el mismo documento escrito con ceros a la
 *    izquierda distintos). No se da de alta: elegir mal mezcla dos historias
 *    (docs/PLAN_ALTA_EN_CALIENTE.md, D3).
 *
 * Y dos que no son de la sincronización sino lo que un paciente le dijo al bot y
 * alguien del hospital tiene que atender (2026-10-15). AgenIA no escribe NADA en el
 * hospital por ellas: solo deja el caso para el personal.
 *
 *  · `AVISO_INASISTENCIA`  — el paciente avisó que no irá o pidió otra fecha, con
 *    cancelar o cambiar fecha apagados en el bot. Se cierra sola si la cita se
 *    cancela o cambia de hora.
 *  · `TELEFONO_EQUIVOCADO` — quien contestó dice que ese número no es del paciente.
 *    El bot ya no le manda recordatorios; falta corregir el teléfono en el hospital.
 *
 * Y una de la escritura en el hospital (2026-10-15):
 *
 *  · `CANCELACION_NO_APLICADA` — AgenIA canceló una cita, pero en el hospital esa
 *    hora del médico tiene la cita de OTRO paciente: el agente no borró nada (borrar
 *    habría dejado sin cita a otra persona). Alguien tiene que mirar dónde quedó la
 *    cita de este paciente en el hospital.
 *
 * Y dos de lo que hace el hospital con una cita del asistente (2026-10-22: el
 * hospital anuló una cita que una paciente agendó por WhatsApp y nadie le avisó).
 * AgenIA le avisa al paciente (si WhatsApp lo permite) y deja el caso para que una
 * persona confirme que quedó enterado:
 *
 *  · `CITA_CANCELADA_POR_HOSPITAL` — el hospital canceló en su sistema una cita
 *    futura que el paciente agendó con el asistente.
 *  · `CITA_MOVIDA_POR_HOSPITAL`    — el hospital la cambió de hora: canceló esa y
 *    le dio otra al mismo paciente.
 *
 * Y una de lo que el paciente dijo de una cita que el asistente le acaba de agendar
 * (2026-10-23: una paciente que venía por ecografías quedó con una cita de medicina
 * general y nadie se enteró). AgenIA no toca la cita: una persona confirma con el
 * paciente si la necesita. Se cierra sola si la cita se cancela o cambia de hora.
 *
 *  · `REVISAR_CITA_ASISTENTE` — poco después de agendar, el paciente preguntó si la
 *    cita era para otro servicio, dijo que no era la que necesitaba, o la confirmó
 *    después de preguntar por otro servicio.
 *
 * Y dos de los médicos del hospital (2026-10-24: la médica RU68 volvió a tener
 * turnos sin estar en AgenIA y sus pacientes no recibían recordatorio):
 *
 *  · `MEDICO_SIN_HOMOLOGAR`   — un médico del hospital con citas de un servicio que
 *    AgenIA maneja no está homologado. El administrador lo crea y homologa con un
 *    botón. Se cierra sola cuando queda homologado o ya no tiene esas citas.
 *  · `MEDICO_AGREGADO_AUTO`   — AgenIA lo creó y homologó solo (Configuración, apagado
 *    de fábrica): para que una persona lo revise y decida su WhatsApp.
 *
 * Y una de lo que el paciente pidió y no terminó (2026-10-26: una paciente escribió
 * «Cancelar esta cita por favor», nunca respondió el SÍ y la cita siguió en pie sin
 * que nadie se enterara). AgenIA no la cancela: una persona confirma con el paciente.
 *
 *  · `CANCELACION_SIN_CONFIRMAR` — el paciente pidió cancelar por el chat, el
 *    asistente le preguntó si la cancelaba y pasó la hora sin un SÍ ni un NO. Lo abre
 *    el vigilante; se cierra sola si la cita se cancela o cambia de hora.
 */
export const TIPOS_EXCEPCION = [
  'CITA_NO_ENTREGADA',
  'EVENTO_RENDIDO',
  'CONFLICTO_SYNC',
  'ERROR_SYNC',
  'DERIVA_EN_HIS',
  'IDENTIDAD_AMBIGUA',
  'AVISO_INASISTENCIA',
  'TELEFONO_EQUIVOCADO',
  'CANCELACION_NO_APLICADA',
  'CITA_CANCELADA_POR_HOSPITAL',
  'CITA_MOVIDA_POR_HOSPITAL',
  'REVISAR_CITA_ASISTENTE',
  'MEDICO_SIN_HOMOLOGAR',
  'MEDICO_AGREGADO_AUTO',
  'CANCELACION_SIN_CONFIRMAR',
] as const;
export type TipoExcepcion = (typeof TIPOS_EXCEPCION)[number];

/**
 * De cuáles se le avisa al agendador por WhatsApp, con la plantilla «Aviso al
 * agendador» (`SYNC_EXCEPTION_ALERT`), apenas aparecen. Las técnicas van solo a la
 * bandeja: son para quien administra.
 */
export const TIPOS_CON_AVISO: readonly TipoExcepcion[] = [
  'CITA_NO_ENTREGADA',
  'DERIVA_EN_HIS',
];

/**
 * Lo que pidió un paciente y nadie atendió, con su cita cerca (2026-10-27): se le
 * avisa al agendador con su propia plantilla (`PATIENT_REQUEST_ALERT`), porque el
 * texto fijo de la otra habla de citas que no llegaron al hospital. Solo cuando a
 * la cita le faltan `urgenciaAltaHoras` o menos: antes, la bandeja basta.
 *
 * El 26-oct una paciente pidió cancelar, no confirmó, el caso se abrió hora y media
 * antes de su cita, nadie lo vio y el cupo se perdió.
 */
export const TIPOS_CON_AVISO_PACIENTE: readonly TipoExcepcion[] = [
  'CANCELACION_SIN_CONFIRMAR',
  'AVISO_INASISTENCIA',
];

/** ¿Va con la plantilla de pedidos de pacientes y no con la de la sincronización? */
export function esAvisoDePaciente(kind: TipoExcepcion): boolean {
  return TIPOS_CON_AVISO_PACIENTE.includes(kind);
}

export const TITULO_EXCEPCION: Record<TipoExcepcion, string> = {
  CITA_NO_ENTREGADA: 'Cita que el hospital aún no tiene',
  EVENTO_RENDIDO: 'Un cambio se rindió sin llegar al hospital',
  CONFLICTO_SYNC: 'Conflicto entre AgenIA y el hospital',
  ERROR_SYNC: 'Error al aplicar un cambio',
  DERIVA_EN_HIS: 'El hospital no tiene una cita que AgenIA da por hecha',
  IDENTIDAD_AMBIGUA: 'Cita del hospital con un documento ambiguo',
  AVISO_INASISTENCIA: 'Un paciente avisó que no irá o pide otra fecha',
  TELEFONO_EQUIVOCADO: 'El teléfono de un paciente es de otra persona',
  CANCELACION_NO_APLICADA: 'Cancelación que el hospital no aplicó',
  CITA_CANCELADA_POR_HOSPITAL: 'El hospital canceló una cita agendada por el asistente',
  CITA_MOVIDA_POR_HOSPITAL: 'El hospital cambió la hora de una cita agendada por el asistente',
  REVISAR_CITA_ASISTENTE: 'Revisar una cita agendada por el asistente',
  MEDICO_SIN_HOMOLOGAR: 'Médico del hospital con citas que aún no está en AgenIA',
  MEDICO_AGREGADO_AUTO: 'Médico del hospital agregado automáticamente',
  CANCELACION_SIN_CONFIRMAR: 'Un paciente pidió cancelar y no confirmó',
};

export const SEVERIDADES_EXCEPCION = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export type SeveridadExcepcion = (typeof SEVERIDADES_EXCEPCION)[number];
export const ORDEN_SEVERIDAD_EXCEPCION: Record<SeveridadExcepcion, number> = {
  BAJA: 0,
  MEDIA: 1,
  ALTA: 2,
  CRITICA: 3,
};

/**
 * `ABIERTA` (nadie la trabaja) → `EN_REVISION` (tiene dueño) → un cierre:
 * `RESUELTA` / `DESCARTADA` (lo decidió una persona, con nota), `AUTO_RESUELTA`
 * (la condición dejó de cumplirse sola: ya llegó al hospital, se canceló…) o
 * `VENCIDA` (la cita pasó hace días y nadie la cerró: §12 #15, `debeVencer`).
 *
 * `VENCIDA` no es `AUTO_RESUELTA`: el problema NO se resolvió, solo dejó de tener
 * sentido perseguirlo. Por eso se nombra aparte, para que quien revise el historial
 * no lo confunda con «ya llegó».
 */
export const ESTADOS_EXCEPCION = [
  'ABIERTA',
  'EN_REVISION',
  'RESUELTA',
  'DESCARTADA',
  'AUTO_RESUELTA',
  'VENCIDA',
] as const;
export type EstadoExcepcion = (typeof ESTADOS_EXCEPCION)[number];
export const ESTADOS_ACTIVOS = ['ABIERTA', 'EN_REVISION'] as const;

export const UMBRALES_VIGILANTE = {
  /**
   * Minutos que un evento puede llevar sin entregarse antes de tratarlo como
   * retenido. Es LA MISMA constante con la que el rastreo dice «en camino» o «se
   * atascó» (`COLA_ATASCADA_MIN`): un único criterio para la pantalla y el aviso.
   */
  retencionMin: COLA_ATASCADA_MIN,
  /** A menos de esto de la cita, una excepción sube al menos a ALTA. */
  urgenciaAltaHoras: 24,
  /** A menos de esto de la cita, es CRÍTICA. */
  urgenciaCriticaHoras: 4,
  /** Solo se miran eventos del outbox de los últimos días: los viejos son historia. */
  eventosVentanaDias: 14,
  /** Cuánto atrás se re-lee la auditoría en cada vuelta (las excepciones se deduplican). */
  auditoriaVentanaHoras: 24,
  /** Un conflicto o error de auditoría sin nuevas ocurrencias en tanto tiempo se da por superado. */
  auditoriaSinRecurrenciaDias: 3,
  /**
   * §12 #14. Minutos tras un aviso sin que NADIE tome la excepción en la bandeja
   * antes de recordarlo. «Nadie la tomó» es la señal, no el «leído» de Meta: leer
   * el WhatsApp no es ocuparse, y el leído depende de que el agendador lo tenga
   * activado.
   */
  recordatorioMin: 30,
  /** Recordatorios por gravedad. Si la gravedad sube, es un aviso nuevo y vuelve a contar. */
  maxRecordatorios: 2,
  /**
   * §12 #15. Una excepción de una cita cuya hora pasó hace más de esto, y que nadie
   * tocó en ese tiempo, se cierra como `VENCIDA`. Una semana deja margen para
   * llamar al paciente y averiguar qué pasó (¿llegó y no lo atendieron?).
   */
  vencimientoDias: 7,
} as const;

// ─────────────────────────────────────────────────────────────
// ¿Está retenida esta cita?
// ─────────────────────────────────────────────────────────────

export type MotivoRetencion = 'RENDIDA' | 'REINTENTANDO' | 'EN_COLA';

export interface Retencion {
  motivo: MotivoRetencion;
  severidad: SeveridadExcepcion;
  /** Desde el evento MÁS VIEJO sin entregar. */
  minutosRetenida: number;
  /** Positivo: solo se evalúan citas que aún no han empezado. */
  minutosParaLaCita: number;
  attempts: number;
  lastError: string | null;
  /** `SyncOutbox.seq` del evento culpable, como texto: identifica el problema. */
  seq: string;
  /** Texto corto, neutro y sin datos personales, para la bandeja. */
  resumen: string;
  sync: EstadoSync;
}

const MS_MIN = 60_000;

/**
 * El evento que explica el estado de una cita: el rendido, si no el que más
 * reintenta, si no el pendiente más viejo. Es la misma precedencia de `derivarSync`,
 * y es lo que da IDENTIDAD a la excepción (ver `claveExcepcion`).
 */
export function eventoCulpable(eventos: FilaOutbox[]): FilaOutbox | null {
  const pendientes = eventos
    .filter((e) => !e.deliveredAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (pendientes.length === 0) return null;
  const rendido = pendientes.find((e) => e.deadLettered);
  if (rendido) return rendido;
  const reintentando = pendientes
    .filter((e) => e.attempts > 0)
    .sort((a, b) => b.attempts - a.attempts)[0];
  return reintentando ?? pendientes[0];
}

/** Sube la gravedad base según cuánto falta para la cita; nunca la baja. */
export function severidadPorCercania(
  base: SeveridadExcepcion,
  minutosParaLaCita: number,
): SeveridadExcepcion {
  if (minutosParaLaCita < UMBRALES_VIGILANTE.urgenciaCriticaHoras * 60) {
    return 'CRITICA';
  }
  if (minutosParaLaCita < UMBRALES_VIGILANTE.urgenciaAltaHoras * 60) {
    return ORDEN_SEVERIDAD_EXCEPCION[base] >= ORDEN_SEVERIDAD_EXCEPCION.ALTA ? base : 'ALTA';
  }
  return base;
}

/**
 * El resumen de una retención en una frase neutra y SIN datos técnicos ni personales.
 * Se exporta porque la web lo reconstruye desde `meta` para mostrárselo a quien no ve
 * el detalle técnico (el `detail` de la excepción lleva además el último error del
 * agente, que puede nombrar servidores del hospital).
 */
export function resumenRetencion(
  motivo: MotivoRetencion,
  minutos: number,
  attempts: number,
): string {
  switch (motivo) {
    case 'RENDIDA':
      return `El envío al hospital se rindió tras ${attempts} intentos y no se va a reintentar solo.`;
    case 'REINTENTANDO':
      return `El envío al hospital está fallando (intento ${attempts} de ${MAX_INTENTOS_ENTREGA}) desde hace ${minutos} min.`;
    default:
      return `Lleva ${minutos} min en la cola sin que el agente del hospital la tome.`;
  }
}

/**
 * ¿Esta cita está retenida antes de llegar al hospital? `null` si no hay nada que
 * vigilar: no está vigente, nació en el HIS, ya empezó (la alerta es para ANTES de
 * la hora), no tiene envío pendiente, o lleva menos del umbral.
 *
 * Un dead-letter NO espera al umbral: ya no se va a entregar solo.
 */
export function evaluarRetencion(entrada: {
  cita: { inicioIso: string; estado: string; origen: string };
  eventos: FilaOutbox[];
  ahoraIso: string;
  umbralMin?: number;
}): Retencion | null {
  const { cita, eventos } = entrada;
  if (cita.estado !== 'SCHEDULED' || cita.origen === 'MIRROR') return null;

  const ahora = Date.parse(entrada.ahoraIso);
  const inicio = Date.parse(cita.inicioIso);
  if (Number.isNaN(ahora) || Number.isNaN(inicio) || inicio <= ahora) return null;

  const sync = derivarSync(eventos);
  if (sync.estado === 'NO_EVENT' || sync.estado === 'DELIVERED') return null;

  const culpable = eventoCulpable(eventos);
  if (!culpable) return null;

  const desde = Date.parse(sync.oldestPendingIso ?? sync.creadoIso ?? '');
  const minutosRetenida = Number.isNaN(desde)
    ? 0
    : Math.max(0, Math.floor((ahora - desde) / MS_MIN));

  const motivo: MotivoRetencion =
    sync.estado === 'DEAD_LETTER'
      ? 'RENDIDA'
      : sync.estado === 'RETRYING'
        ? 'REINTENTANDO'
        : 'EN_COLA';
  if (
    motivo !== 'RENDIDA' &&
    minutosRetenida < (entrada.umbralMin ?? UMBRALES_VIGILANTE.retencionMin)
  ) {
    return null;
  }

  const minutosParaLaCita = Math.floor((inicio - ahora) / MS_MIN);
  return {
    motivo,
    severidad: severidadPorCercania(
      motivo === 'RENDIDA' ? 'ALTA' : 'MEDIA',
      minutosParaLaCita,
    ),
    minutosRetenida,
    minutosParaLaCita,
    attempts: sync.attempts,
    lastError: sync.lastError,
    seq: String(culpable.seq),
    resumen: resumenRetencion(motivo, minutosRetenida, sync.attempts),
    sync,
  };
}

// ─────────────────────────────────────────────────────────────
// Identidad de una excepción
// ─────────────────────────────────────────────────────────────

/**
 * Cada clave identifica el PROBLEMA, no la fila: el vigilante lo vuelve a encontrar
 * en cada vuelta y debe actualizar la MISMA excepción, no abrir otra.
 *
 * La de una cita lleva el evento culpable: si alguien la resuelve a mano («ya la
 * agendé en ventanilla»), el evento sigue sin entregarse y no debe reabrirse en cada
 * vuelta; pero un problema NUEVO de esa misma cita (otro evento que se rinde) sí es
 * otra excepción y sí debe avisar.
 */
export const claveExcepcion = {
  /** Una por documento y cupo: el mismo caso sin resolver no abre una fila por vuelta. */
  identidadAmbigua: (documentoEnmascarado: string, cupo: string) =>
    `identidad:${documentoEnmascarado}:${cupo}`,
  citaNoEntregada: (appointmentId: string, seq: bigint | string | number) =>
    `cita:${appointmentId}:${String(seq)}`,
  eventoRendido: (seq: bigint | string | number) => `evento:${String(seq)}`,
  derivaEnHis: (appointmentId: string) => `deriva:${appointmentId}`,
  /** Una por cita: el segundo «no puedo ir» de la misma cita suma una ocurrencia. */
  avisoInasistencia: (appointmentId: string) => `inasistencia:${appointmentId}`,
  /** Una por paciente: el número es el mismo en todas sus citas. */
  telefonoEquivocado: (patientId: string) => `telefono:${patientId}`,
  /** Una por cita: su cancelación no se pudo aplicar en el hospital. */
  cancelacionNoAplicada: (appointmentId: string) =>
    `cancelacion:${appointmentId}`,
  /** Una por cita: la segunda duda del paciente sobre la misma cita suma una ocurrencia. */
  revisarCitaAsistente: (appointmentId: string) =>
    `revisar-cita:${appointmentId}`,
  /** Una por código de médico del hospital. */
  medicoSinHomologar: (externalKey: string) =>
    `medico-sin-homologar:${externalKey}`,
  medicoAgregadoAuto: (externalKey: string) =>
    `medico-agregado:${externalKey}`,
  /** Una por cita: pedirlo otra vez sin confirmar no abre otro caso. */
  cancelacionSinConfirmar: (appointmentId: string) =>
    `cancelar-sin-confirmar:${appointmentId}`,
  auditoria: (a: {
    direction: string;
    entityType: string;
    entityId: string | null;
    /** `<médico>|<hora>` cuando la auditoría lo trae y no hay entidad. */
    cupo: string | null;
    outcome: string;
  }) =>
    `auditoria:${a.direction}:${a.entityType}:${a.entityId ?? a.cupo ?? '-'}:${a.outcome}`,
};

// ─────────────────────────────────────────────────────────────
// ¿Corresponde avisar?
// ─────────────────────────────────────────────────────────────

/**
 * ¿Es de las que se avisan, sigue sin dueño y su cita no ha pasado? Los pedidos de
 * pacientes, además, solo con la cita a `urgenciaAltaHoras` o menos (y con hora).
 */
function seAvisa(
  e: {
    kind: TipoExcepcion;
    status: EstadoExcepcion;
    appointmentStartIso: string | null;
  },
  ahoraIso: string,
): boolean {
  if (e.status !== 'ABIERTA') return false;
  const ahora = Date.parse(ahoraIso);
  const inicio = e.appointmentStartIso
    ? Date.parse(e.appointmentStartIso)
    : Number.NaN;
  if (!Number.isNaN(inicio) && inicio <= ahora) return false;
  if (TIPOS_CON_AVISO.includes(e.kind)) return true;
  return (
    esAvisoDePaciente(e.kind) &&
    !Number.isNaN(inicio) &&
    inicio - ahora <= UMBRALES_VIGILANTE.urgenciaAltaHoras * 60 * MS_MIN
  );
}

/**
 * ¿Hay que avisarle al agendador de esta excepción AHORA?
 *
 *  · solo de los tipos que le importan a él (`TIPOS_CON_AVISO`, y los pedidos de
 *    pacientes de `TIPOS_CON_AVISO_PACIENTE` cuando su cita está cerca);
 *  · solo si nadie la ha tomado (si alguien ya se ocupa, avisar es ruido);
 *  · solo ANTES de la hora de la cita: después, el aviso ya no sirve;
 *  · una vez por gravedad: vuelve a avisar únicamente si SUBE (la cita se acercó).
 */
export function requiereAviso(
  e: {
    kind: TipoExcepcion;
    severity: SeveridadExcepcion;
    status: EstadoExcepcion;
    notifiedSeverity: string | null;
    appointmentStartIso: string | null;
  },
  ahoraIso: string,
): boolean {
  if (!seAvisa(e, ahoraIso)) return false;
  if (!e.notifiedSeverity) return true;
  const previa = ORDEN_SEVERIDAD_EXCEPCION[e.notifiedSeverity as SeveridadExcepcion] ?? -1;
  return ORDEN_SEVERIDAD_EXCEPCION[e.severity] > previa;
}

/**
 * §12 #14. ¿Hay que RECORDAR el aviso? Solo cuando ya se avisó de esta gravedad y
 * nadie tomó la excepción en `recordatorioMin`, hasta `maxRecordatorios` veces. Las
 * mismas reglas del aviso (tipo, abierta, antes de la hora) siguen valiendo.
 *
 * Si la gravedad subió, no es un recordatorio: es un aviso nuevo (`requiereAviso`),
 * y los dos nunca coinciden para la misma excepción.
 */
export function requiereRecordatorio(
  e: {
    kind: TipoExcepcion;
    severity: SeveridadExcepcion;
    status: EstadoExcepcion;
    notifiedSeverity: string | null;
    notifiedAtIso: string | null;
    reminderCount: number;
    appointmentStartIso: string | null;
  },
  ahoraIso: string,
): boolean {
  if (!seAvisa(e, ahoraIso)) return false;
  if (!e.notifiedSeverity || !e.notifiedAtIso) return false;
  if (requiereAviso(e, ahoraIso)) return false;
  if (e.reminderCount >= UMBRALES_VIGILANTE.maxRecordatorios) return false;
  const ahora = Date.parse(ahoraIso);
  const avisada = Date.parse(e.notifiedAtIso);
  if (Number.isNaN(avisada)) return false;
  return ahora - avisada >= UMBRALES_VIGILANTE.recordatorioMin * MS_MIN;
}

// ─────────────────────────────────────────────────────────────
// ¿Ya venció?
// ─────────────────────────────────────────────────────────────

/**
 * §12 #15. ¿Se cierra esta excepción como `VENCIDA`? Solo si sigue activa, es de una
 * cita cuya hora pasó hace más de `vencimientoDias`, y NADIE la movió en ese tiempo
 * (`updatedAt`: tomarla, soltarla o reabrirla le da otra semana). Así quien la está
 * trabajando no la pierde de un día para otro, y reabrir una vencida sirve.
 *
 * Sin hora de cita no vence: un error de auditoría o un cambio de cupo no tienen un
 * «después» que lo vuelva inútil (y los de auditoría ya se cierran solos).
 */
export function debeVencer(
  e: { status: string; appointmentStartIso: string | null; updatedAtIso: string },
  ahoraIso: string,
): boolean {
  if (!(ESTADOS_ACTIVOS as readonly string[]).includes(e.status)) return false;
  if (!e.appointmentStartIso) return false;
  const ahora = Date.parse(ahoraIso);
  const inicio = Date.parse(e.appointmentStartIso);
  const movida = Date.parse(e.updatedAtIso);
  if ([ahora, inicio, movida].some(Number.isNaN)) return false;
  const limite = ahora - UMBRALES_VIGILANTE.vencimientoDias * 24 * 60 * MS_MIN;
  return inicio < limite && movida < limite;
}

/** La constancia de un vencimiento: la misma frase en el historial y en el cierre. */
export const NOTA_VENCIDA = `Venció sin resolución: la hora de la cita pasó hace más de ${UMBRALES_VIGILANTE.vencimientoDias} días y nadie la cerró.`;

// ─────────────────────────────────────────────────────────────
// La máquina de estados de la bandeja
// ─────────────────────────────────────────────────────────────

export type AccionExcepcion =
  | 'TOMAR'
  | 'SOLTAR'
  | 'RESOLVER'
  | 'DESCARTAR'
  | 'REABRIR';

export type ResultadoTransicion =
  | { ok: true; estado: EstadoExcepcion }
  | { ok: false; motivo: string };

const NOTA_MIN = 5;
const CERRADAS: readonly EstadoExcepcion[] = [
  'RESUELTA',
  'DESCARTADA',
  'AUTO_RESUELTA',
  'VENCIDA',
];

/**
 * Qué estado sigue si `accion` se aplica a una excepción en `estado`, o por qué no
 * se puede. No sabe quién es quién: recibe si el actor es el dueño o el
 * administrador, y quien llama (la web) lo resuelve contra la sesión.
 *
 * Cerrar (resolver o descartar) exige una NOTA: es la constancia de qué se hizo, y
 * lo único que le queda a quien revise el caso después.
 *
 * Una excepción EN_REVISION sin dueño (`hayDuenio` falso) es un estado imposible por
 * construcción —el dueño existe si y solo si está en revisión—, pero si un dato
 * llegara así no se deja trabada: cualquiera con permiso de trabajar puede tomarla,
 * soltarla o cerrarla, porque no hay a quién quitársela.
 */
export function transicionExcepcion(
  estado: EstadoExcepcion,
  accion: AccionExcepcion,
  ctx: { esDuenio: boolean; esAdmin: boolean; hayDuenio: boolean; nota?: string },
): ResultadoTransicion {
  const ok = (e: EstadoExcepcion): ResultadoTransicion => ({ ok: true, estado: e });
  const no = (motivo: string): ResultadoTransicion => ({ ok: false, motivo });
  // Solo se mira dentro de EN_REVISION: en otro estado no hay dueño que buscar.
  const huerfana = !ctx.hayDuenio;

  switch (accion) {
    case 'TOMAR':
      if (estado === 'ABIERTA') return ok('EN_REVISION');
      if (estado === 'EN_REVISION') {
        if (ctx.esDuenio) return no('Esta excepción ya la tienes tú.');
        if (ctx.esAdmin || huerfana) return ok('EN_REVISION');
        return no(
          'La excepción ya la tiene otra persona. Solo el administrador puede quitársela.',
        );
      }
      return no('Está cerrada: primero hay que reabrirla.');

    case 'SOLTAR':
      if (estado !== 'EN_REVISION') {
        return no('Solo se puede soltar una excepción que alguien tiene.');
      }
      return ctx.esDuenio || ctx.esAdmin || huerfana
        ? ok('ABIERTA')
        : no('Solo quien la tiene o el administrador puede soltarla.');

    case 'RESOLVER':
    case 'DESCARTAR': {
      if (estado !== 'ABIERTA' && estado !== 'EN_REVISION') {
        return no('Esta excepción ya está cerrada.');
      }
      if ((ctx.nota ?? '').trim().length < NOTA_MIN) {
        return no(
          `Escribe una nota (al menos ${NOTA_MIN} caracteres) de qué se hizo: es la constancia del cierre.`,
        );
      }
      if (estado === 'EN_REVISION' && !ctx.esDuenio && !ctx.esAdmin && !huerfana) {
        return no(
          'La excepción la tiene otra persona. Solo ella o el administrador pueden cerrarla.',
        );
      }
      return ok(accion === 'RESOLVER' ? 'RESUELTA' : 'DESCARTADA');
    }

    case 'REABRIR':
      return CERRADAS.includes(estado)
        ? ok('ABIERTA')
        : no('Esta excepción ya está activa.');

    default:
      return no('Acción desconocida.');
  }
}

// ─────────────────────────────────────────────────────────────
// El aviso al agendador
// ─────────────────────────────────────────────────────────────

export interface ItemAviso {
  /** Cómo se nombra al médico en el aviso (la API lo arma con el mismo criterio que la pantalla). */
  doctor: string;
  inicioIso: string;
  kind: TipoExcepcion;
  severity: SeveridadExcepcion;
}

/** Una variable de plantilla de Meta: una sola línea, sin saltos ni tabulaciones, acotada. */
function paraPlantilla(texto: string, max: number): string {
  const limpio = texto.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio;
}

/**
 * Las TRES variables de la plantilla de WhatsApp del aviso, en orden:
 *   {{1}} cuántas citas, {{2}} la más próxima (médico y hora), {{3}} la causa probable.
 *
 * 🔒 Sin datos del paciente: ni nombre, ni documento, ni teléfono. El aviso sale
 * hacia el teléfono personal de quien agenda y por una plantilla que pasa por Meta:
 * dice QUÉ pasa y cuándo, y el detalle se ve en la bandeja, tras la sesión.
 *
 * Un RECORDATORIO (§12 #14) usa la misma plantilla —no hace falta aprobar otra en
 * Meta— y lo dice al principio de la causa, que es texto libre: quien lo recibe
 * sabe que es la segunda vez y que nadie se ha ocupado.
 *
 * Devuelve `[]` si no hay nada que avisar: quien llama no debe enviar.
 */
export function parametrosPlantillaAviso(
  items: ItemAviso[],
  ctx: {
    agenteSinSenal: boolean;
    hisAlcanzable: boolean | null;
    timeZone: string;
    /** El número del recordatorio (1, 2…), o nada si es el primer aviso. */
    recordatorio?: number;
  },
): string[] {
  if (items.length === 0) return [];

  const proxima = [...items].sort(
    (a, b) => Date.parse(a.inicioIso) - Date.parse(b.inicioIso),
  )[0];

  const hayEnvio = items.some((i) => i.kind === 'CITA_NO_ENTREGADA');
  const hayDeriva = items.some((i) => i.kind === 'DERIVA_EN_HIS');

  const causas: string[] = [];
  if (hayEnvio) {
    causas.push(
      ctx.agenteSinSenal
        ? 'el agente del hospital no da señales'
        : ctx.hisAlcanzable === false
          ? 'el agente no puede comunicarse con el sistema del hospital'
          : 'el envío al hospital está fallando o rechazándose: revise el detalle',
    );
  }
  if (hayDeriva) {
    causas.push(
      hayEnvio
        ? 'además la comparación diaria no encontró citas en el hospital'
        : 'la comparación diaria con el hospital no encontró estas citas allá',
    );
  }

  if (ctx.recordatorio) {
    causas.unshift(
      `RECORDATORIO ${ctx.recordatorio} de ${UMBRALES_VIGILANTE.maxRecordatorios}: nadie la ha tomado en la bandeja`,
    );
  }

  const n = items.length;
  return [
    `${n} ${n === 1 ? 'cita' : 'citas'}`,
    `${paraPlantilla(proxima.doctor, 120)}, ${formatAppointmentCompact(proxima.inicioIso, { timeZone: ctx.timeZone })}`.slice(
      0,
      200,
    ),
    paraPlantilla(causas.join('; '), 200),
  ];
}

/** Qué pidió el paciente, en una frase para la variable {{3}}. */
const PEDIDO_DEL_PACIENTE: Partial<Record<TipoExcepcion, string>> = {
  CANCELACION_SIN_CONFIRMAR:
    'pidió cancelar por el chat y no confirmó; la cita sigue en pie',
  AVISO_INASISTENCIA: 'avisó por el chat que no irá o pide otra fecha',
};

/**
 * Las TRES variables de la plantilla del aviso de pedidos de pacientes
 * (`PATIENT_REQUEST_ALERT`, 2026-10-27), en orden:
 *   {{1}} cuántos casos, {{2}} la cita más próxima (médico y hora), {{3}} qué pidió.
 *
 * 🔒 Sin datos del paciente, igual que `parametrosPlantillaAviso`: el nombre, el
 * documento y lo que escribió se ven en la bandeja, tras la sesión. El recordatorio
 * usa la misma plantilla y lo dice al principio de {{3}}.
 *
 * Devuelve `[]` si no hay nada que avisar: quien llama no debe enviar.
 */
export function parametrosPlantillaAvisoPaciente(
  items: ItemAviso[],
  ctx: {
    timeZone: string;
    /** El número del recordatorio (1, 2…), o nada si es el primer aviso. */
    recordatorio?: number;
  },
): string[] {
  if (items.length === 0) return [];

  const proxima = [...items].sort(
    (a, b) => Date.parse(a.inicioIso) - Date.parse(b.inicioIso),
  )[0];

  const pedidos = [
    ...new Set(
      items
        .map((i) => PEDIDO_DEL_PACIENTE[i.kind])
        .filter((p): p is string => !!p),
    ),
  ];
  if (ctx.recordatorio) {
    pedidos.unshift(
      `RECORDATORIO ${ctx.recordatorio} de ${UMBRALES_VIGILANTE.maxRecordatorios}: nadie lo ha tomado en la bandeja`,
    );
  }

  const n = items.length;
  return [
    `${n} ${n === 1 ? 'caso' : 'casos'}`,
    `${paraPlantilla(proxima.doctor, 120)}, ${formatAppointmentCompact(proxima.inicioIso, { timeZone: ctx.timeZone })}`.slice(
      0,
      200,
    ),
    paraPlantilla(pedidos.join('; '), 200),
  ];
}
