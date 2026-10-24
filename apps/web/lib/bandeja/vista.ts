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
  formatAppointmentCompact,
  resumenRetencion,
  TEMPLATE_CONTRACTS,
  transicionExcepcion,
  type AccionExcepcion,
  type EstadoExcepcion,
  type MotivoRetencion,
  type SeveridadExcepcion,
  type TemplateKind,
  type TipoExcepcion,
} from '@agenia/shared';
import { etiquetaActorPersonal, etiquetaMedico } from '../rastreo/evidencia';
import type { PermisosBandeja } from './acceso';
import type {
  EntradaHistorial,
  ExcepcionVista,
  MedicoNuevoVista,
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
  /**
   * 🏥 Estado de entrega (según Meta) del aviso de WhatsApp al paciente, por id de
   * excepción: solo de las de «el hospital canceló / cambió una cita del asistente».
   */
  entregas?: Map<string, string>;
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

/** Lo que escribió el paciente, entre comillas y sin saltos; vacío si no hay. */
function citaDelMensaje(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return ` Escribió: «${t.length > 200 ? `${t.slice(0, 200)}…` : t}».`;
}

const nombreCanal = (v: unknown): string =>
  v === 'TELEGRAM' ? 'Telegram' : 'WhatsApp';

/** Por qué no salió el aviso al paciente, en palabras (aviso-cambio-hospital.service.ts). */
const MOTIVO_SIN_AVISO: Record<string, string> = {
  SIN_CONTACTO: 'no tiene WhatsApp ni Telegram registrado',
  TELEFONO_EQUIVOCADO: 'su teléfono está marcado como de otra persona',
  FUERA_DE_VENTANA:
    'pasaron más de 24 horas desde su último mensaje y WhatsApp no permite escribirle sin una plantilla',
  SIN_PLANTILLA: 'falta registrar en Configuración la plantilla de WhatsApp aprobada en Meta',
  FALLO: 'el envío falló',
};

/** El estado de entrega de Meta, en palabras. */
const ESTADO_ENTREGA: Record<string, string> = {
  ACCEPTED: 'enviado',
  SENT: 'enviado',
  DELIVERED: 'entregado',
  READ: 'leído',
  FAILED: 'no se entregó',
};

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
    // Lo que el paciente le dijo al bot. El bot no tocó la cita ni escribió en el
    // hospital: lo hace una persona, y al cancelarse o moverse la cita se cierra sola.
    case 'AVISO_INASISTENCIA': {
      const canal = nombreCanal(meta.canal);
      const mensaje = citaDelMensaje(meta.mensaje);
      const varias = numero(meta.citasDelAviso);
      const otras =
        varias > 1
          ? ` El mismo mensaje dejó aviso en sus ${varias} citas recordadas: revise cada una.`
          : '';
      // 🩺 Cita con la que AgenIA no trabaja (otro servicio o médico sin WhatsApp
      // ON): al paciente se le pidió llamar al hospital; el aviso es para que no
      // se pierda.
      const fuera =
        meta.fueraDelAlcance === true
          ? ' Es una cita de un servicio o médico con el que AgenIA no trabaja: al paciente se le pidió comunicarse con el hospital.'
          : '';
      return meta.pide === 'MODIFICAR'
        ? `El paciente pidió por ${canal} cambiar la fecha de su cita${veces}.${mensaje}${otras}${fuera} El bot no la cambió: si corresponde, muévala en el hospital y avísele al paciente.`
        : `El paciente avisó por ${canal} que no podrá asistir${veces}.${mensaje}${otras}${fuera} El bot no canceló la cita: si corresponde, cancélela en el hospital para liberar el cupo.`;
    }
    case 'CANCELACION_NO_APLICADA':
      return 'AgenIA canceló esta cita, pero en el sistema del hospital esa hora del médico tiene la cita de OTRA persona: no se borró nada allá. La cita sigue cancelada en AgenIA. Busque en el hospital dónde quedó la cita de este paciente y cancélela allá si corresponde.';
    // 🏥 Lo que hizo el hospital con una cita del asistente (2026-10-22): AgenIA le
    // avisó al paciente (o dice por qué no) y una persona confirma que quedó enterado.
    case 'CITA_CANCELADA_POR_HOSPITAL':
    case 'CITA_MOVIDA_POR_HOSPITAL': {
      const agendo = nombreCanal(meta.canalDeLaCita);
      const canal = nombreCanal(meta.canal ?? meta.canalDeLaCita);
      const nueva =
        typeof meta.nuevaIso === 'string' && !Number.isNaN(Date.parse(meta.nuevaIso))
          ? formatAppointmentCompact(new Date(meta.nuevaIso))
          : null;
      const que =
        fila.kind === 'CITA_MOVIDA_POR_HOSPITAL'
          ? `El hospital cambió de hora en su sistema esta cita, que el paciente había agendado por ${agendo}${nueva ? `: ahora es el ${nueva}` : ''}.`
          : `El hospital canceló en su sistema esta cita, que el paciente había agendado por ${agendo}.`;
      // La plantilla que se usó (o que faltó), por su nombre en Configuración.
      const plantilla =
        typeof meta.plantilla === 'string' && meta.plantilla in TEMPLATE_CONTRACTS
          ? TEMPLATE_CONTRACTS[meta.plantilla as TemplateKind].label
          : null;
      const motivo =
        meta.motivo === 'SIN_PLANTILLA' && plantilla
          ? `falta registrar en Configuración la plantilla «${plantilla}», aprobada en Meta`
          : (MOTIVO_SIN_AVISO[String(meta.motivo)] ?? 'el envío falló');
      const aviso =
        meta.aviso === 'ENVIADO'
          ? `Se le avisó por ${canal}${meta.via === 'PLANTILLA' ? ` con la plantilla «${plantilla ?? 'de WhatsApp'}»` : ''}.`
          : meta.aviso === 'PENDIENTE'
            ? 'El aviso al paciente se estaba enviando.'
            : `No se le pudo avisar por ${canal}: ${motivo}. Comuníquese con el paciente.`;
      return `${que} ${aviso} Confirme que el paciente quedó enterado y cierre el caso.`;
    }
    // 🔎 Lo que dijo el paciente de una cita que el asistente le acababa de agendar
    // (2026-10-23). El bot no la tocó: una persona confirma con el paciente.
    case 'REVISAR_CITA_ASISTENTE': {
      const canal = nombreCanal(meta.canal);
      const mensaje = citaDelMensaje(meta.mensaje);
      const otro =
        typeof meta.servicioPedido === 'string' && meta.servicioPedido.trim()
          ? meta.servicioPedido.trim()
          : 'otro servicio';
      const que =
        meta.motivo === 'CONFIRMO_TRAS_PREGUNTAR'
          ? `Antes de confirmar esta cita por ${canal}, el paciente preguntó si era para ${otro}${veces}.${mensaje} El asistente le aclaró que no y el paciente la confirmó igual.`
          : meta.motivo === 'NO_LA_PIDIO'
            ? `Poco después de agendar esta cita por ${canal}, el paciente escribió que no era la que necesitaba${veces}.${mensaje}`
            : `Poco después de agendar esta cita por ${canal}, el paciente preguntó si era para ${otro}${veces}.${mensaje} La cita es de otro servicio.`;
      return `${que} El bot no la cambió: comuníquese con el paciente para confirmar si la necesita; si no, cancélela para liberar el cupo y oriéntelo. Se cierra sola si la cita se cancela o cambia de hora.`;
    }
    // 🩺 Los médicos del hospital que AgenIA aún no tiene (2026-10-24).
    case 'MEDICO_SIN_HOMOLOGAR':
    case 'MEDICO_AGREGADO_AUTO': {
      const nombre = typeof meta.nombre === 'string' && meta.nombre.trim() ? meta.nombre.trim() : 'sin nombre en el catálogo';
      const codigo = typeof meta.externalKey === 'string' ? meta.externalKey : '?';
      const citas = numero(meta.citas);
      const servicio = typeof meta.servicio === 'string' && meta.servicio ? meta.servicio : 'un servicio que AgenIA maneja';
      const desde =
        typeof meta.primeraIso === 'string' && !Number.isNaN(Date.parse(meta.primeraIso))
          ? `, desde el ${formatAppointmentCompact(new Date(meta.primeraIso))}`
          : '';
      const lasCitas = `${citas} cita${citas === 1 ? '' : 's'} de ${servicio}${desde}`;
      if (fila.kind === 'MEDICO_AGREGADO_AUTO') {
        return (
          `AgenIA creó y homologó sola a ${nombre} (código ${codigo} en el hospital), que tenía ${lasCitas}: sus citas ya entran a AgenIA. ` +
          (meta.whatsappOn === true
            ? 'Entró con WhatsApp ON: sus pacientes reciben recordatorios y el asistente ofrece sus cupos.'
            : 'Entró con WhatsApp OFF: sus pacientes no reciben recordatorios hasta que lo encienda en Médicos.') +
          ' Revise que sea correcto; si no, deshomológuelo en Espejo › Homologación.'
        );
      }
      const bloqueos = Array.isArray(meta.bloqueos) ? meta.bloqueos.filter((b): b is string => typeof b === 'string') : [];
      return (
        `${nombre} (código ${codigo} en el hospital) tiene ${lasCitas} y no está en AgenIA: sus pacientes no reciben recordatorios ni pueden gestionar esas citas por chat.` +
        (bloqueos.length > 0
          ? ' No se puede crear desde aquí; homológuelo a mano en Espejo › Homologación.'
          : ' El administrador lo crea y homologa con el botón de este caso.')
      );
    }
    case 'TELEFONO_EQUIVOCADO': {
      const varios = numero(meta.perfilesConElNumero);
      const otros =
        varios > 1 ? ` Ese número lo tienen ${varios} pacientes en AgenIA.` : '';
      const pausa =
        ' Mientras este caso esté abierto no se le envían recordatorios: corrija el teléfono en el hospital y en Pacientes de AgenIA, y ciérrelo (o descártelo si no era cierto).';
      if (meta.motivo === 'RESPUESTA_AUTOMATICA') {
        return `Al mensaje del hospital le contestó la contestadora automática de un negocio, no una persona${veces}.${citaDelMensaje(meta.mensaje)}${otros} Probablemente ese número no es del paciente; el bot no le respondió.${pausa}`;
      }
      return `Quien respondió por WhatsApp dice que ese número no es del paciente${veces}.${citaDelMensaje(meta.mensaje)}${otros}${pausa}`;
    }
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

/** Le suma al resumen cómo va el mensaje al paciente («entregado», «leído»…). */
function conEntrega(resumen: string, estado: string | undefined): string {
  const texto = estado ? ESTADO_ENTREGA[estado] : undefined;
  return texto ? `${resumen} Mensaje al paciente: ${texto}.` : resumen;
}

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
    resumen: conEntrega(resumenPublico(f, referenciaMs), ctx.entregas?.get(f.id)),
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
    medicoNuevo:
      f.kind === 'MEDICO_SIN_HOMOLOGAR' ? medicoNuevoDe(leerMeta(f.meta), activa, ctx.actor.permisos.administrar) : null,
  };
}

/** 🩺 El médico del caso, para el botón «Crear y homologar». */
function medicoNuevoDe(meta: Record<string, unknown>, activa: boolean, esAdmin: boolean): MedicoNuevoVista | null {
  if (typeof meta.externalKey !== 'string' || !meta.externalKey) return null;
  const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const bloqueos = textos(meta.bloqueos);
  return {
    codigo: meta.externalKey,
    nombre: texto(meta.nombre),
    cargo: texto(meta.cargo),
    cedulaFinal: texto(meta.cedulaFinal),
    servicio: texto(meta.servicio),
    citas: numero(meta.citas),
    primeraIso: texto(meta.primeraIso),
    bloqueos,
    advertencias: textos(meta.advertencias),
    puedeCrear: activa && esAdmin && bloqueos.length === 0,
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
