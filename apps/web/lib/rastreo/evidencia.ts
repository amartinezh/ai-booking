/**
 * De filas de la base a la evidencia que entiende el clasificador
 * (`@agenia/shared`, `patient-trace`).
 *
 * Todo aquí es PURO: recibe filas ya leídas y devuelve datos. No hay Prisma ni
 * reloj, así que cada regla se prueba con una tabla de casos. El servicio
 * (`servicio.ts`) solo lee y llama a estas funciones.
 *
 * Los tipos de entrada son estructurales (lo mínimo que se lee de cada fila),
 * no los de Prisma: así una consulta con `select` distinto sigue encajando.
 */
import { leerCancelacionPersonal } from '@agenia/shared';
import type {
  CancelacionCita,
  EsperaRastreo,
  EstadoMensaje,
  EstadoSync,
  MensajeConfirmacion,
  ResumenConversacion,
  SaludEspejo,
} from '@agenia/shared';
import { partesLocales } from './zona-horaria';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ─────────────────────────────────────────────────────────────
// Estado del envío de una cita al HIS
// ─────────────────────────────────────────────────────────────

export interface FilaOutbox {
  seq: bigint | string;
  op: string;
  createdAt: Date;
  deliveredAt: Date | null;
  attempts: number;
  deadLettered: boolean;
  nextAttemptAt: Date | null;
  lastError: string | null;
}

/**
 * El estado de TODOS los eventos de una cita, resumido en uno: el peor.
 *
 * Una cita tiene varios (el alta, luego un reagendamiento o una cancelación).
 * Basta uno rendido para que el hospital tenga la cita en un estado distinto al
 * de AgenIA, así que el orden es dead-letter > reintentando > en cola > entregado.
 * Sin ningún evento: el trigger solo registra eventos con el espejo ENCENDIDO,
 * de modo que una cita creada antes de activarlo (o con él apagado) no tiene.
 */
export function derivarSync(eventos: FilaOutbox[]): EstadoSync {
  if (eventos.length === 0) {
    return {
      estado: 'NO_EVENT',
      attempts: 0,
      lastError: null,
      creadoIso: null,
      oldestPendingIso: null,
      nextAttemptIso: null,
      deliveredAtIso: null,
      seq: null,
    };
  }

  const porFecha = [...eventos].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const creadoIso = iso(porFecha[0].createdAt);
  const pendientes = porFecha.filter((e) => !e.deliveredAt);

  const base = {
    creadoIso,
    oldestPendingIso: null as string | null,
    nextAttemptIso: null as string | null,
    deliveredAtIso: null as string | null,
    seq: null as string | null,
  };

  const rendido = pendientes.find((e) => e.deadLettered);
  if (rendido) {
    return {
      ...base,
      estado: 'DEAD_LETTER',
      attempts: rendido.attempts,
      lastError: rendido.lastError,
      seq: String(rendido.seq),
      oldestPendingIso: iso(rendido.createdAt),
    };
  }

  const reintentando = pendientes
    .filter((e) => e.attempts > 0)
    .sort((a, b) => b.attempts - a.attempts)[0];
  if (reintentando) {
    return {
      ...base,
      estado: 'RETRYING',
      attempts: reintentando.attempts,
      lastError: reintentando.lastError,
      nextAttemptIso: iso(reintentando.nextAttemptAt),
      oldestPendingIso: iso(pendientes[0].createdAt),
    };
  }

  if (pendientes.length > 0) {
    return {
      ...base,
      estado: 'PENDING',
      attempts: 0,
      lastError: null,
      oldestPendingIso: iso(pendientes[0].createdAt),
    };
  }

  const entregadoEn = porFecha
    .map((e) => e.deliveredAt!.getTime())
    .sort((a, b) => b - a)[0];
  return {
    ...base,
    estado: 'DELIVERED',
    attempts: 0,
    lastError: null,
    deliveredAtIso: new Date(entregadoEn).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// Mensaje de confirmación (libro de mensajes)
// ─────────────────────────────────────────────────────────────

export interface FilaMensaje {
  status: EstadoMensaje;
  createdAt: Date;
  statusAt: Date;
  errorCode: string | null;
  errorDetail: string | null;
}

const RANGO_MENSAJE: Record<EstadoMensaje, number> = {
  FAILED: 0,
  ACCEPTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
};

/**
 * La confirmación de una cita puede haber salido varias veces (en modo voz: un
 * audio Y un resumen escrito). Lo que importa es si el paciente RECIBIÓ alguna:
 * se toma la de mejor estado, y a igualdad la más reciente. Un audio fallido no
 * puede tapar el texto que sí llegó.
 */
export function elegirConfirmacion(
  mensajes: FilaMensaje[],
): MensajeConfirmacion | null {
  if (mensajes.length === 0) return null;
  const mejor = [...mensajes].sort(
    (a, b) =>
      RANGO_MENSAJE[b.status] - RANGO_MENSAJE[a.status] ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  return {
    status: mejor.status,
    enviadoIso: mejor.createdAt.toISOString(),
    estadoIso: mejor.statusAt.toISOString(),
    errorDetalle:
      mejor.errorDetail ?? (mejor.errorCode ? `código ${mejor.errorCode}` : null),
  };
}

// ─────────────────────────────────────────────────────────────
// Conversación con el bot
// ─────────────────────────────────────────────────────────────

export interface FilaLog {
  createdAt: Date;
  status: string;
  failureReason: string | null;
  userMessage: string | null;
  botReply: string | null;
  metadata: unknown;
}

export interface MensajeConversacion {
  atIso: string;
  estado: string;
  motivoFallo: string | null;
  paciente: string | null;
  bot: string | null;
}

function metadataComoObjeto(m: unknown): Record<string, unknown> {
  return m && typeof m === 'object' && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

const RESULTADO_POR_ESTADO: Record<string, ResumenConversacion['ultimoResultado']> = {
  BOOKING_CONFIRMED: 'CONFIRMADA',
  FAILED: 'FALLO',
  ABANDONED: 'ABANDONADA',
  WAITLIST_JOINED: 'LISTA_DE_ESPERA',
};

export interface AnalisisConversacion {
  resumen: ResumenConversacion;
  /** `appointmentId` de cada BOOKING_CONFIRMED: qué citas confirmó el bot. */
  confirmadas: Set<string>;
  /** Cancelaciones hechas por el paciente en WhatsApp: cita → cuándo. */
  canceladasPorPaciente: Map<string, Date>;
}

export function analizarConversacion(logs: FilaLog[]): AnalisisConversacion {
  const recientesPrimero = [...logs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const confirmadas = new Set<string>();
  const canceladasPorPaciente = new Map<string, Date>();
  const fallos: ResumenConversacion['fallos'] = [];

  for (const log of recientesPrimero) {
    const meta = metadataComoObjeto(log.metadata);
    const citaId = typeof meta.appointmentId === 'string' ? meta.appointmentId : null;

    if (log.status === 'BOOKING_CONFIRMED' && citaId) confirmadas.add(citaId);
    if (meta.event === 'APPOINTMENT_CANCELLED' && citaId) {
      canceladasPorPaciente.set(citaId, log.createdAt);
    }
    if (log.status === 'FAILED' || log.status === 'ABANDONED') {
      fallos.push({
        motivo: log.failureReason ?? log.status,
        atIso: log.createdAt.toISOString(),
      });
    }
  }

  const masNuevo = recientesPrimero[0];
  const masViejo = recientesPrimero[recientesPrimero.length - 1];
  return {
    resumen: {
      mensajes: logs.length,
      primerMensajeIso: iso(masViejo?.createdAt),
      ultimoMensajeIso: iso(masNuevo?.createdAt),
      fallos,
      ultimoResultado: masNuevo
        ? (RESULTADO_POR_ESTADO[masNuevo.status] ?? 'OTRO')
        : null,
    },
    confirmadas,
    canceladasPorPaciente,
  };
}

/** Lo que se dijeron, para quien tiene permiso de leerlo (más nuevo primero). */
export function filasDeConversacion(
  logs: FilaLog[],
  maximo = 100,
): MensajeConversacion[] {
  return [...logs]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, maximo)
    .map((l) => ({
      atIso: l.createdAt.toISOString(),
      estado: l.status,
      motivoFallo: l.failureReason,
      paciente: l.userMessage,
      bot: l.botReply,
    }));
}

// ─────────────────────────────────────────────────────────────
// Cancelación: quién y cuándo
// ─────────────────────────────────────────────────────────────

const ROL_PERSONAL: Record<string, string> = {
  ORG_ADMIN: 'administrador',
  BOOKING_AGENT: 'agente de reservas',
  DOCTOR: 'médico',
  SUPER_ADMIN: 'súper administrador',
};

/**
 * "agente de reservas · agente@clinica.co", o solo el rol cuando quien consulta
 * no puede ver identidades (`identidad` = null). Un rol desconocido o ausente se
 * dice "personal": es mejor que inventar uno o dejar un hueco en la frase.
 */
export function etiquetaActorPersonal(
  role: string | null | undefined,
  identidad: string | null,
): string {
  const rol = (role && ROL_PERSONAL[role]) || 'personal';
  return identidad ? `${rol} · ${identidad}` : rol;
}

/**
 * Quién canceló una cita, con lo que AgenIA registra:
 *
 *  · el hospital deja `metaLog.cancelledBy = 'MIRROR'` (y un SyncAudit con la hora);
 *  · el personal desde el panel deja `metaLog.cancelledBy = 'STAFF'` con el id, el
 *    rol y la hora (`@agenia/shared`, `appointment-cancel`);
 *  · el paciente por WhatsApp deja un InteractionLog `APPOINTMENT_CANCELLED`;
 *  · una cancelación del panel ANTERIOR a que se guardara la constancia no dejó
 *    nada, y `Appointment` no tiene `updatedAt`: ni quién ni cuándo se pueden
 *    reconstruir. Se dice así.
 *
 * `actorPersonal` ya viene redactado por quien conoce el permiso del rol que
 * consulta (`etiquetaActorPersonal`); aquí solo se coloca.
 */
export function derivarCancelacion(datos: {
  metaLog: unknown;
  canceladaPorPacienteEn?: Date | null;
  auditoriaHisEn?: Date | null;
  actorPersonal?: string | null;
}): CancelacionCita {
  const meta = metadataComoObjeto(datos.metaLog);
  if (meta.cancelledBy === 'MIRROR') {
    const motivo =
      typeof meta.reason === 'string' && meta.reason.trim()
        ? meta.reason.trim()
        : typeof meta.observations === 'string' && meta.observations.trim()
          ? meta.observations.trim()
          : null;
    return { por: 'HIS', atIso: iso(datos.auditoriaHisEn), motivo };
  }
  const personal = leerCancelacionPersonal(datos.metaLog);
  if (personal) {
    return {
      por: 'PERSONAL',
      atIso: personal.atIso,
      motivo: null,
      actor: datos.actorPersonal ?? etiquetaActorPersonal(personal.role, null),
    };
  }
  if (datos.canceladaPorPacienteEn) {
    return {
      por: 'PACIENTE_WHATSAPP',
      atIso: iso(datos.canceladaPorPacienteEn),
      motivo: null,
    };
  }
  return { por: 'DESCONOCIDO', atIso: null, motivo: null };
}

// ─────────────────────────────────────────────────────────────
// La captura de pantalla
// ─────────────────────────────────────────────────────────────

export interface DatosCaptura {
  /** `YYYY-MM-DD`, en la zona de la clínica. */
  fecha?: string;
  /** `HH:mm`, 24 h. */
  hora?: string;
  /** Texto libre: parte del nombre del médico o del servicio. */
  medico?: string;
}

/** Minúsculas y sin tildes: "María" y "maria" son lo mismo para comparar. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** ¿El funcionario indicó algo de la captura? */
export function hayCaptura(c: DatosCaptura | undefined | null): boolean {
  return !!(c && (c.fecha?.trim() || c.hora?.trim() || c.medico?.trim()));
}

/**
 * ¿Esta cita es la que muestra la captura? Cada dato indicado tiene que
 * coincidir; los que no se indicaron no cuentan. `null` = no se indicó nada.
 */
export function coincideConCaptura(
  cita: { startIso: string; doctor: string; service: string },
  captura: DatosCaptura | undefined | null,
  zonaHoraria: string,
): boolean | null {
  if (!hayCaptura(captura)) return null;
  const c = captura!;
  const local = partesLocales(cita.startIso, zonaHoraria);
  if (!local) return false;

  if (c.fecha?.trim() && local.fecha !== c.fecha.trim()) return false;
  if (c.hora?.trim() && local.hora !== c.hora.trim()) return false;
  if (c.medico?.trim()) {
    const buscado = normalizarTexto(c.medico);
    const donde = normalizarTexto(`${cita.doctor} ${cita.service}`);
    if (!donde.includes(buscado)) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Nombre de un médico
// ─────────────────────────────────────────────────────────────

/**
 * `Dr(a). X`, salvo que el perfil sea una agenda funcional del HIS («MEDICO
 * ATENCIÓN HTA 2»), que no es una persona. Misma regla que `doctorLabel` de la
 * API: ahí lee el paciente, aquí lee el funcionario, y los dos deben ver el
 * mismo nombre para hablar de la misma cita.
 */
export function etiquetaMedico(
  fullName: string | null | undefined,
  esAgendaFuncional?: boolean | null,
): string {
  const nombre = (fullName ?? '').trim();
  if (!nombre) return '';
  return esAgendaFuncional ? nombre : `Dr(a). ${nombre}`;
}

// ─────────────────────────────────────────────────────────────
// Lista de espera y salud del espejo
// ─────────────────────────────────────────────────────────────

export function mapearEspera(
  filas: {
    status: EsperaRastreo['status'];
    createdAt: Date;
    notifiedAt: Date | null;
    service: { name: string } | null;
  }[],
): EsperaRastreo[] {
  return filas.map((f) => ({
    status: f.status,
    servicio: f.service?.name ?? 'un servicio',
    desdeIso: f.createdAt.toISOString(),
    avisadoIso: iso(f.notifiedAt),
  }));
}

export function saludDelEspejo(
  config: {
    enabled: boolean;
    pushEnabled: boolean;
    pullEnabled: boolean;
    lastHeartbeatAt: Date | null;
    lastHisReachable: boolean | null;
    lastHisDetail: string | null;
  } | null,
): SaludEspejo | null {
  if (!config) return null;
  return {
    enabled: config.enabled,
    pushEnabled: config.pushEnabled,
    pullEnabled: config.pullEnabled,
    lastHeartbeatIso: iso(config.lastHeartbeatAt),
    hisReachable: config.lastHisReachable,
    hisDetail: config.lastHisDetail,
  };
}
