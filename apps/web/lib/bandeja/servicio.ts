/**
 * Bandeja de excepciones de sincronización: lo que lee y escribe en la base
 * (docs/PLAN_RASTREO_PACIENTE.md §10 #3, Fase 3).
 *
 * TRES REGLAS QUE ATRAVIESAN TODO EL ARCHIVO
 *
 *  1. **El tenant en TODA consulta.** `actor.organizationId` sale del token: ninguna
 *     función recibe una organización del cliente. Una excepción de otra clínica
 *     responde igual que una inexistente («no encontrada»), para no ser un oráculo.
 *  2. **El alcance del agente, en la lectura Y en la escritura.** Un BOOKING_AGENT con
 *     EPS o médico asignados ve y trabaja SOLO lo suyo, con la misma regla que su
 *     lista de citas (`alcance-agente.ts`). La lista solo esconde botones: la acción
 *     lo vuelve a comprobar, porque una pestaña vieja llega igual. Una excepción sin
 *     EPS o sin médico conocidos queda FUERA para un agente acotado (falla cerrado).
 *  3. **Todo cambio de estado es un compare-and-set con su constancia.** El `updateMany`
 *     condicionado al estado y al dueño que se leyeron, y la línea de historial, van
 *     en UNA transacción: dos personas pulsando a la vez no se pisan, y no queda un
 *     cambio sin su constancia ni una constancia sin su cambio.
 *
 * Recibe `db` como parámetro (no importa el cliente global): así se prueba con un
 * doble y se verifica contra un Postgres real sin montar Next.
 */
import type { Prisma, PrismaClient } from '@agenia/database';
import {
  ESTADOS_ACTIVOS,
  ORDEN_SEVERIDAD_EXCEPCION,
  SEVERIDADES_EXCEPCION,
  SYNC_AUDIT_DIRECTION,
  TIPOS_EXCEPCION,
  enmascararIdentificadorWhatsapp,
  normalizePhoneToE164Co,
  type AccionExcepcion,
  type EstadoExcepcion,
  type SeveridadExcepcion,
} from '@agenia/shared';
import { citaFueraDeAlcance } from '../alcance-agente';
import { SIN_PERMISOS, type ActorBandeja } from './acceso';
import type {
  EstadoAvisos,
  ExcepcionDetalle,
  FiltrosBandeja,
  FiltroEstado,
  ListaExcepciones,
  Resultado,
  ResumenBandeja,
} from './tipos';
import {
  evaluarAccion,
  mapearExcepcion,
  mapearHistorial,
  type ContextoVista,
  type FilaExcepcion,
  type FilaHistorial,
} from './vista';

type Db = PrismaClient;

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────

export const TAMANO_PAGINA = 25;
/** Tope de excepciones activas que se traen para ordenarlas por urgencia. */
export const MAX_ACTIVAS = 500;
const MAX_HISTORIAL = 200;
export const MAX_NOTA = 500;

export const MSG_NO_ENCONTRADA = 'Excepción no encontrada.';
export const MSG_ACCION_INVALIDA = 'Acción no válida.';
export const MSG_CAMBIO_CONCURRENTE =
  'Alguien acaba de cambiar esta excepción. Actualiza la lista y revisa cómo quedó.';
export const MSG_NO_GUARDADA = 'No se pudo guardar el cambio. Intenta de nuevo.';
export const MSG_NOTA_LARGA = `La nota es demasiado larga (máximo ${MAX_NOTA} caracteres).`;
export const MSG_NUMERO_INVALIDO =
  'Escribe un celular colombiano válido: 10 dígitos, empieza por 3 (ej. 300 123 4567).';
export const MSG_SIN_ESPEJO =
  'El espejo con el hospital no está configurado para esta clínica.';
export const MSG_RESPALDO_SIN_AGENDADOR =
  'El respaldo recibe los recordatorios que no atendió el agendador: primero escribe el número del agendador.';
export const MSG_RESPALDO_IGUAL =
  'El respaldo debe ser OTRO número: es a quien se escala cuando el agendador no atiende el aviso.';

const ESTADOS_CERRADOS: EstadoExcepcion[] = ['RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA', 'VENCIDA'];
const ACCIONES: readonly AccionExcepcion[] = [
  'TOMAR',
  'SOLTAR',
  'RESOLVER',
  'DESCARTAR',
  'REABRIR',
];

/** La acción → el nombre de la línea de historial y el estado en que queda. */
const NOMBRE_EN_HISTORIAL: Record<AccionExcepcion, string> = {
  TOMAR: 'TOMADA',
  SOLTAR: 'SOLTADA',
  RESOLVER: 'RESUELTA',
  DESCARTAR: 'DESCARTADA',
  REABRIR: 'REABIERTA',
};

// ─────────────────────────────────────────────────────────────
// Alcance
// ─────────────────────────────────────────────────────────────

/**
 * Lo que este actor puede ver de la clínica: la clínica, y —si es un agente acotado— su
 * EPS y su médico. Un `epsId`/`doctorId` nulo en la fila NO coincide con ninguno: queda
 * fuera, que es lo que se quiere.
 */
export function alcanceDeExcepciones(
  actor: ActorBandeja,
): Prisma.SyncExceptionWhereInput {
  return {
    organizationId: actor.organizationId,
    ...(actor.scopeEpsId ? { epsId: actor.scopeEpsId } : {}),
    ...(actor.scopeDoctorId ? { doctorId: actor.scopeDoctorId } : {}),
  };
}

const alcanceDelActor = (actor: ActorBandeja) => ({
  epsId: actor.scopeEpsId,
  doctorId: actor.scopeDoctorId,
});

function filtroDeEstado(
  estado: FiltroEstado,
  actor: ActorBandeja,
): Prisma.SyncExceptionWhereInput {
  switch (estado) {
    case 'MIAS':
      return { status: 'EN_REVISION', assignedToUserId: actor.userId };
    case 'SIN_DUENO':
      return { status: 'ABIERTA' };
    case 'CERRADAS':
      return { status: { in: ESTADOS_CERRADOS } };
    default:
      return { status: { in: [...ESTADOS_ACTIVOS] } };
  }
}

const FILTROS_DE_ESTADO: readonly FiltroEstado[] = [
  'ACTIVAS',
  'MIAS',
  'SIN_DUENO',
  'CERRADAS',
];

// ─────────────────────────────────────────────────────────────
// Contexto de la vista
// ─────────────────────────────────────────────────────────────

const unicos = (xs: (string | null | undefined)[]): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
];

async function cargarUsuarios(
  db: Db,
  actor: ActorBandeja,
  ids: string[],
): Promise<ContextoVista['usuarios']> {
  if (ids.length === 0) return new Map();
  const filas = await db.user.findMany({
    where: { id: { in: ids }, organizationId: actor.organizationId },
    select: { id: true, email: true, role: true },
  });
  return new Map(filas.map((u) => [u.id, { email: u.email, role: u.role }]));
}

async function cargarContexto(
  db: Db,
  actor: ActorBandeja,
  filas: FilaExcepcion[],
  ahora: Date,
  idsUsuarioExtra: (string | null)[] = [],
): Promise<ContextoVista> {
  const org = actor.organizationId;
  const medicoIds = unicos(filas.map((f) => f.doctorId));
  const pacienteIds = unicos(filas.map((f) => f.patientId));
  const citaIds = unicos(filas.map((f) => f.appointmentId));
  const usuarioIds = unicos([
    ...filas.flatMap((f) => [f.assignedToUserId, f.resolvedByUserId]),
    ...idsUsuarioExtra,
  ]);

  const [medicos, pacientes, citas, usuarios] = await Promise.all([
    medicoIds.length
      ? db.doctorProfile.findMany({
          where: { id: { in: medicoIds }, organizationId: org },
          select: { id: true, fullName: true, isFunctionalAgenda: true },
        })
      : [],
    pacienteIds.length
      ? db.patientProfile.findMany({
          where: { id: { in: pacienteIds }, organizationId: org },
          select: { id: true, fullName: true, cedula: true },
        })
      : [],
    citaIds.length
      ? db.appointment.findMany({
          where: { id: { in: citaIds }, organizationId: org },
          select: { id: true, scheduleSlot: { select: { service: { select: { name: true } } } } },
        })
      : [],
    cargarUsuarios(db, actor, usuarioIds),
  ]);

  return {
    actor: { userId: actor.userId, permisos: actor.permisos },
    ahora,
    medicos: new Map(
      medicos.map((m) => [
        m.id,
        { fullName: m.fullName, isFunctionalAgenda: m.isFunctionalAgenda },
      ]),
    ),
    pacientes: new Map(
      pacientes.map((p) => [p.id, { fullName: p.fullName, cedula: p.cedula }]),
    ),
    citas: new Map(
      citas.map((c) => [c.id, { servicio: c.scheduleSlot?.service?.name ?? null }]),
    ),
    usuarios,
  };
}

// ─────────────────────────────────────────────────────────────
// Resumen y lista
// ─────────────────────────────────────────────────────────────

export async function resumenBandeja(
  db: Db,
  actor: ActorBandeja,
): Promise<ResumenBandeja> {
  if (!actor.permisos.ver) throw new Error(SIN_PERMISOS);
  const alcance = alcanceDeExcepciones(actor);

  const [grupos, mias] = await Promise.all([
    db.syncException.groupBy({
      by: ['status', 'severity'],
      where: { ...alcance, status: { in: [...ESTADOS_ACTIVOS] } },
      _count: { _all: true },
    }),
    db.syncException.count({
      where: { ...alcance, status: 'EN_REVISION', assignedToUserId: actor.userId },
    }),
  ]);

  const porGravedad = Object.fromEntries(
    SEVERIDADES_EXCEPCION.map((s) => [s, 0]),
  ) as Record<SeveridadExcepcion, number>;
  let activas = 0;
  let sinDueno = 0;
  for (const g of grupos) {
    const n = g._count._all;
    activas += n;
    if (g.status === 'ABIERTA') sinDueno += n;
    if (g.severity in porGravedad) porGravedad[g.severity as SeveridadExcepcion] += n;
  }
  return { activas, sinDueno, mias, criticas: porGravedad.CRITICA, porGravedad };
}

/** Cuántas esperan a alguien (abiertas, sin dueño): la cifra del menú. */
export async function contarPendientes(
  db: Db,
  actor: ActorBandeja,
): Promise<number> {
  if (!actor.permisos.ver) return 0;
  return db.syncException.count({
    where: { ...alcanceDeExcepciones(actor), status: 'ABIERTA' },
  });
}

const rango = (s: string): number =>
  ORDEN_SEVERIDAD_EXCEPCION[s as SeveridadExcepcion] ?? -1;

export async function listarExcepciones(
  db: Db,
  actor: ActorBandeja,
  filtros: FiltrosBandeja = {},
  ahora: Date = new Date(),
): Promise<Resultado<ListaExcepciones>> {
  if (!actor.permisos.ver) return { success: false, error: SIN_PERMISOS };

  const estado: FiltroEstado = FILTROS_DE_ESTADO.includes(
    filtros.estado as FiltroEstado,
  )
    ? (filtros.estado as FiltroEstado)
    : 'ACTIVAS';
  const tipo = (TIPOS_EXCEPCION as readonly string[]).includes(filtros.tipo ?? '')
    ? filtros.tipo
    : undefined;
  const gravedad = (SEVERIDADES_EXCEPCION as readonly string[]).includes(
    filtros.gravedad ?? '',
  )
    ? filtros.gravedad
    : undefined;

  const where: Prisma.SyncExceptionWhereInput = {
    ...alcanceDeExcepciones(actor),
    ...filtroDeEstado(estado, actor),
    ...(tipo ? { kind: tipo } : {}),
    ...(gravedad ? { severity: gravedad } : {}),
  };

  const resumen = await resumenBandeja(db, actor);
  let filas: FilaExcepcion[];
  let total: number;
  let pagina = Math.max(1, Math.floor(Number(filtros.pagina)) || 1);

  if (estado === 'CERRADAS') {
    total = await db.syncException.count({ where });
    pagina = Math.min(pagina, Math.max(1, Math.ceil(total / TAMANO_PAGINA)));
    filas = await db.syncException.findMany({
      where,
      orderBy: [{ resolvedAt: 'desc' }, { lastSeenAt: 'desc' }],
      skip: (pagina - 1) * TAMANO_PAGINA,
      take: TAMANO_PAGINA,
    });
  } else {
    // Lo activo se ordena por urgencia: gravedad primero, y dentro de cada gravedad la
    // cita más próxima. La gravedad no es ordenable en SQL (es texto), así que se trae
    // ordenado por hora de cita y se ordena en memoria por gravedad (estable: dentro de
    // la misma gravedad sigue mandando la hora).
    const traidas = await db.syncException.findMany({
      where,
      orderBy: [
        { appointmentStartAt: { sort: 'asc', nulls: 'last' } },
        { firstSeenAt: 'asc' },
      ],
      take: MAX_ACTIVAS,
    });
    traidas.sort((a, b) => rango(b.severity) - rango(a.severity));
    total = traidas.length;
    pagina = Math.min(pagina, Math.max(1, Math.ceil(total / TAMANO_PAGINA)));
    filas = traidas.slice((pagina - 1) * TAMANO_PAGINA, pagina * TAMANO_PAGINA);
  }

  const ctx = await cargarContexto(db, actor, filas, ahora);
  return {
    success: true,
    data: {
      filas: filas.map((f) => mapearExcepcion(f, ctx)),
      total,
      pagina,
      paginas: Math.max(1, Math.ceil(total / TAMANO_PAGINA)),
      resumen,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Detalle
// ─────────────────────────────────────────────────────────────

/**
 * La excepción de ESTA clínica y dentro del alcance del actor, o `null`. Se filtra en
 * la consulta Y se vuelve a comprobar con `citaFueraDeAlcance`: la regla del agente es
 * una sola y no debe depender de que la consulta la haya aplicado bien.
 */
async function cargarAlcanzable(db: Db, actor: ActorBandeja, id: unknown) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
  const fila = await db.syncException.findFirst({
    where: { id, ...alcanceDeExcepciones(actor) },
  });
  if (!fila) return null;
  if (citaFueraDeAlcance(alcanceDelActor(actor), fila)) return null;
  return fila;
}

export async function detalleExcepcion(
  db: Db,
  actor: ActorBandeja,
  id: unknown,
  ahora: Date = new Date(),
): Promise<Resultado<ExcepcionDetalle>> {
  if (!actor.permisos.ver) return { success: false, error: SIN_PERMISOS };
  const fila = await cargarAlcanzable(db, actor, id);
  if (!fila) return { success: false, error: MSG_NO_ENCONTRADA };

  const logs: FilaHistorial[] = await db.syncExceptionLog.findMany({
    where: { exceptionId: fila.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORIAL,
  });
  const ctx = await cargarContexto(
    db,
    actor,
    [fila],
    ahora,
    logs.map((l) => l.actorUserId),
  );
  return {
    success: true,
    data: {
      ...mapearExcepcion(fila, ctx),
      historial: mapearHistorial(logs, ctx),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Trabajar una excepción
// ─────────────────────────────────────────────────────────────

const esAccion = (a: unknown): a is AccionExcepcion =>
  (ACCIONES as readonly unknown[]).includes(a);

/** Lo que cambia en la fila según la acción. Quien la cierra o la suelta deja de ser su dueño. */
function cambiosDeAccion(
  accion: AccionExcepcion,
  actor: ActorBandeja,
  nota: string,
  ahora: Date,
): Prisma.SyncExceptionUncheckedUpdateManyInput {
  switch (accion) {
    case 'TOMAR':
      return {
        status: 'EN_REVISION',
        assignedToUserId: actor.userId,
        assignedAt: ahora,
      };
    case 'SOLTAR':
      return { status: 'ABIERTA', assignedToUserId: null, assignedAt: null };
    case 'RESOLVER':
    case 'DESCARTAR':
      return {
        status: accion === 'RESOLVER' ? 'RESUELTA' : 'DESCARTADA',
        assignedToUserId: null,
        assignedAt: null,
        resolvedAt: ahora,
        resolvedByUserId: actor.userId,
        resolutionNote: nota,
      };
    case 'REABRIR':
      return {
        status: 'ABIERTA',
        assignedToUserId: null,
        assignedAt: null,
        resolvedAt: null,
        resolvedByUserId: null,
        resolutionNote: null,
      };
  }
}

export async function aplicarAccion(
  db: Db,
  actor: ActorBandeja,
  entrada: { id: unknown; accion: unknown; nota?: unknown },
  ahora: Date = new Date(),
): Promise<Resultado<{ estado: EstadoExcepcion }>> {
  if (!actor.permisos.trabajar) return { success: false, error: SIN_PERMISOS };
  if (!esAccion(entrada.accion)) {
    return { success: false, error: MSG_ACCION_INVALIDA };
  }
  const accion = entrada.accion;

  const nota = typeof entrada.nota === 'string' ? entrada.nota.trim() : '';
  if (nota.length > MAX_NOTA) return { success: false, error: MSG_NOTA_LARGA };

  const fila = await cargarAlcanzable(db, actor, entrada.id);
  if (!fila) return { success: false, error: MSG_NO_ENCONTRADA };

  const esDuenio = !!fila.assignedToUserId && fila.assignedToUserId === actor.userId;
  const transicion = evaluarAccion(fila.status, accion, {
    esDuenio,
    hayDuenio: !!fila.assignedToUserId,
    permisos: actor.permisos,
    nota,
  });
  if (!transicion.ok) return { success: false, error: transicion.motivo };

  // Un administrador que toma la excepción de otra persona es una REASIGNACIÓN, y así
  // debe leerse en el historial.
  const reasigna =
    accion === 'TOMAR' &&
    fila.status === 'EN_REVISION' &&
    !!fila.assignedToUserId &&
    !esDuenio;
  const nombre = reasigna ? 'REASIGNADA' : NOMBRE_EN_HISTORIAL[accion];

  try {
    return await db.$transaction(async (tx) => {
      const { count } = await tx.syncException.updateMany({
        where: {
          id: fila.id,
          organizationId: actor.organizationId,
          status: fila.status,
          assignedToUserId: fila.assignedToUserId,
        },
        data: cambiosDeAccion(accion, actor, nota, ahora),
      });
      if (count !== 1) {
        return { success: false as const, error: MSG_CAMBIO_CONCURRENTE };
      }
      await tx.syncExceptionLog.create({
        data: {
          exceptionId: fila.id,
          action: nombre,
          actorUserId: actor.userId,
          actorRole: actor.role,
          note: nota || null,
        },
      });
      return { success: true as const, data: { estado: transicion.estado } };
    });
  } catch (error: unknown) {
    console.error('[bandeja] no se pudo aplicar la acción', {
      accion,
      exceptionId: fila.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: MSG_NO_GUARDADA };
  }
}

// ─────────────────────────────────────────────────────────────
// Avisos al agendador
// ─────────────────────────────────────────────────────────────

/**
 * ¿Están saliendo los avisos? Si no, POR QUÉ: un aviso que no sale en silencio es
 * peor que uno que no existe (el agendador cree estar cubierto). El vigilante y la
 * bandeja funcionan igual; lo que falta es el empujón por WhatsApp.
 */
export async function estadoAvisos(
  db: Db,
  actor: ActorBandeja,
): Promise<Resultado<EstadoAvisos>> {
  if (!actor.permisos.ver) return { success: false, error: SIN_PERMISOS };
  const [config, plantilla] = await Promise.all([
    db.hospitalMirrorConfig.findUnique({
      where: { organizationId: actor.organizationId },
      select: {
        enabled: true,
        conflictAlertsEnabled: true,
        agendadorWhatsapp: true,
        agendadorRespaldoWhatsapp: true,
      },
    }),
    db.whatsappTemplate.findFirst({
      where: {
        organizationId: actor.organizationId,
        kind: 'SYNC_EXCEPTION_ALERT',
        isActive: true,
      },
      select: { id: true },
    }),
  ]);

  const alertasActivas = !!config?.conflictAlertsEnabled;
  const tieneNumero = !!config?.agendadorWhatsapp;
  const tienePlantilla = !!plantilla;

  let razon: string | null = null;
  if (!config?.enabled) {
    razon = 'El espejo con el hospital está apagado para esta clínica.';
  } else if (!alertasActivas) {
    razon = 'Los avisos por WhatsApp están apagados.';
  } else if (!tieneNumero) {
    razon = 'Falta el número de WhatsApp del agendador.';
  } else if (!tienePlantilla) {
    razon =
      'Falta la plantilla «Aviso al agendador» aprobada en Meta: sin ella el mensaje no sale.';
  }

  return {
    success: true,
    data: {
      salen: razon === null,
      razon,
      alertasActivas,
      plantilla: tienePlantilla,
      tieneNumero,
      tieneRespaldo: !!config?.agendadorRespaldoWhatsapp,
      // Los números completos, solo para quien los configura.
      numero: actor.permisos.configurarAvisos
        ? (config?.agendadorWhatsapp ?? null)
        : null,
      respaldo: actor.permisos.configurarAvisos
        ? (config?.agendadorRespaldoWhatsapp ?? null)
        : null,
    },
  };
}

/** Un celular del formulario → como lo espera el envío (solo dígitos, con el 57); `''` = ninguno. */
function leerCelular(valor: unknown): { ok: true; numero: string | null } | { ok: false } {
  const crudo = typeof valor === 'string' ? valor.trim() : '';
  if (!crudo) return { ok: true, numero: null };
  const e164 = normalizePhoneToE164Co(crudo);
  return e164 ? { ok: true, numero: e164.replace(/\D/g, '') } : { ok: false };
}

/**
 * Configura a quién se le avisa y si se avisa (solo ORG_ADMIN). Deja constancia en la
 * bitácora del espejo, con los números enmascarados: son teléfonos personales.
 *
 *  · `numero`: el agendador. Vacío = sin destinatario (los avisos dejan de salir, la
 *    bandeja sigue).
 *  · `respaldo` (§12 #14): a quién se escala cuando nadie toma la excepción tras el
 *    aviso; recibe los recordatorios junto con el agendador. Opcional, y nunca sin
 *    agendador ni igual a él (sería el mismo teléfono, no un escalamiento).
 */
export async function guardarAvisos(
  db: Db,
  actor: ActorBandeja,
  entrada: { numero: unknown; activos: unknown; respaldo?: unknown },
): Promise<
  Resultado<{ numero: string | null; respaldo: string | null; activos: boolean }>
> {
  if (!actor.permisos.configurarAvisos) {
    return { success: false, error: SIN_PERMISOS };
  }
  if (typeof entrada.activos !== 'boolean') {
    return { success: false, error: 'Indica si los avisos están activos.' };
  }
  const principal = leerCelular(entrada.numero);
  if (!principal.ok) return { success: false, error: MSG_NUMERO_INVALIDO };
  const segundo = leerCelular(entrada.respaldo);
  if (!segundo.ok) return { success: false, error: MSG_NUMERO_INVALIDO };
  const numero = principal.numero;
  const respaldo = segundo.numero;
  if (respaldo && !numero) return { success: false, error: MSG_RESPALDO_SIN_AGENDADOR };
  if (respaldo && respaldo === numero) return { success: false, error: MSG_RESPALDO_IGUAL };

  try {
    return await db.$transaction(async (tx) => {
      const { count } = await tx.hospitalMirrorConfig.updateMany({
        where: { organizationId: actor.organizationId },
        data: {
          agendadorWhatsapp: numero,
          agendadorRespaldoWhatsapp: respaldo,
          conflictAlertsEnabled: entrada.activos as boolean,
        },
      });
      if (count !== 1) return { success: false as const, error: MSG_SIN_ESPEJO };
      await tx.syncAudit.create({
        data: {
          organizationId: actor.organizationId,
          direction: SYNC_AUDIT_DIRECTION.CONFIG,
          entityType: 'HospitalMirrorConfig',
          op: 'ALERT_SETTINGS_CHANGE',
          outcome: 'OK',
          detail: `Avisos al agendador: ${entrada.activos ? 'activos' : 'apagados'}, destino ${
            numero ? enmascararIdentificadorWhatsapp(numero) : 'sin número'
          }, respaldo ${
            respaldo ? enmascararIdentificadorWhatsapp(respaldo) : 'sin número'
          } (cambiado desde el panel por ${actor.role}).`,
        },
      });
      return {
        success: true as const,
        data: { numero, respaldo, activos: entrada.activos as boolean },
      };
    });
  } catch (error: unknown) {
    console.error('[bandeja] no se pudo guardar la configuración de avisos', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: MSG_NO_GUARDADA };
  }
}
