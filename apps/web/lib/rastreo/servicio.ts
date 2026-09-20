/**
 * Rastreo de paciente: lo que lee de la base y arma para la pantalla
 * (docs/PLAN_RASTREO_PACIENTE.md §4–§6).
 *
 * TRES REGLAS QUE ATRAVIESAN TODO EL ARCHIVO
 *
 *  1. **El tenant en TODA consulta.** `actor.organizationId` sale del token (o de
 *     la organización que SUPER_ADMIN eligió y se validó): ninguna función recibe
 *     una organización del cliente. Un paciente de otra clínica responde igual
 *     que uno inexistente, para no ser un oráculo de existencia.
 *  2. **Fallar cerrado al registrar.** Cada consulta se anota en
 *     `PatientLookupLog` ANTES de devolver datos. Si no se puede anotar, no se
 *     muestra nada: un buscador de datos de salud sin bitácora es la puerta ideal
 *     para curiosear.
 *  3. **Cada rol ve lo suyo.** El servicio nunca decide por sí solo qué puede
 *     ver quien pregunta: lo dice `actor.permisos` (`acceso.ts`) y aquí solo se
 *     aplica. Lo que un rol no puede ver ni siquiera se lee.
 *
 * Recibe `db` como parámetro (no importa el cliente global): así se prueba con
 * un doble y se verifica contra un Postgres real sin montar Next.
 */
import { Prisma, type PrismaClient } from '@agenia/database';
import {
  DEFAULT_TIMEZONE,
  MAX_NOTA_MOTIVO,
  SYNC_AUDIT_DIRECTION,
  clasificarBusqueda,
  clasificarRastreoA,
  clasificarRastreoB,
  construirLineaDeVida,
  enmascararDocumento,
  enmascararIdentificadorWhatsapp,
  enmascararNombre,
  escaparLike,
  esMotivoConsulta,
  formatAppointmentCompact,
  leerCancelacionPersonal,
  type AuditoriaCupo,
  type CitaRastreo,
  type EvidenciaRastreoA,
  type EvidenciaRastreoB,
  type MotivoConsulta,
  type ResultadoRastreo,
} from '@agenia/shared';
import { aUtc } from './zona-horaria';
import { SIN_PERMISOS, type ActorRastreo } from './acceso';
import {
  analizarConversacion,
  coincideConCaptura,
  derivarCancelacion,
  derivarSync,
  elegirConfirmacion,
  etiquetaActorPersonal,
  etiquetaMedico,
  filasDeConversacion,
  hayCaptura,
  mapearEspera,
  saludDelEspejo,
  type DatosCaptura,
  type FilaLog,
  type FilaMensaje,
  type FilaOutbox,
} from './evidencia';
import type {
  CandidatoRastreo,
  CitaExpediente,
  EventoSyncVista,
  ExpedienteA,
  ExpedienteB,
  FilaConsulta,
  HistorialVista,
  IdentidadVista,
  ListaConsultas,
  OpcionMedico,
  Resultado,
  ResultadoBusqueda,
  SujetoRastreo,
} from './tipos';

type Db = PrismaClient;

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────

/** Cuántos candidatos se devuelven como máximo. */
export const MAX_CANDIDATOS = 10;
const MAX_CITAS = 100;
const DIAS_CONVERSACION = 90;
const DIAS_AUDITORIA_HIS = 120;
const TAMANO_PAGINA = 25;

const MS_DIA = 86_400_000;

/** Los `queryKind` que cuentan como BÚSQUEDA para el límite de tasa. */
const TIPOS_DE_BUSQUEDA = ['CEDULA', 'PHONE', 'BSUID', 'NAME'];

export const MSG_LIMITE =
  'Hiciste demasiadas búsquedas seguidas. Espera unos minutos e intenta de nuevo.';
export const MSG_NO_REGISTRADA =
  'No se pudo registrar la consulta y, por seguridad, no se muestran datos. Intenta de nuevo.';
const MSG_PACIENTE_NO_ENCONTRADO = 'Paciente no encontrado.';

/**
 * Límite de tasa por usuario (§6, punto 5): 30 búsquedas en 10 minutos por
 * defecto. Se lee al llamar, no al cargar el módulo: afinarlo no debe costar un
 * despliegue ni un reinicio de pruebas.
 */
export function limitesDeBusqueda(): { max: number; ventanaMin: number } {
  return {
    max: Number(process.env.RASTREO_MAX_BUSQUEDAS) || 30,
    ventanaMin: Number(process.env.RASTREO_VENTANA_MIN) || 10,
  };
}

// ─────────────────────────────────────────────────────────────
// Ayudas comunes
// ─────────────────────────────────────────────────────────────

function validarMotivo(
  motivo: unknown,
  nota: unknown,
): Resultado<{ motivo: MotivoConsulta; nota: string | null }> {
  if (!esMotivoConsulta(motivo)) {
    return { success: false, error: 'Elige el motivo de la consulta.' };
  }
  const texto = typeof nota === 'string' ? nota.trim() : '';
  if (motivo === 'OTRO' && texto.length < 5) {
    return {
      success: false,
      error: 'Explica el motivo en la nota (al menos 5 caracteres).',
    };
  }
  if (texto.length > MAX_NOTA_MOTIVO) {
    return {
      success: false,
      error: `La nota no puede pasar de ${MAX_NOTA_MOTIVO} caracteres.`,
    };
  }
  return { success: true, data: { motivo, nota: texto || null } };
}

interface FilaBitacora {
  mode: 'A' | 'B';
  queryKind: string;
  queryMasked: string;
  reason: MotivoConsulta;
  reasonNote: string | null;
  candidateIds: string[];
  openedPatientId: string | null;
  verdicts?: { codigo: string; citaId: string | null }[];
}

/** Anota la consulta. Devuelve false si no se pudo: el llamador NO debe entregar datos. */
async function registrar(
  db: Db,
  actor: ActorRastreo,
  fila: FilaBitacora,
): Promise<boolean> {
  try {
    await db.patientLookupLog.create({
      data: {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        mode: fila.mode,
        queryKind: fila.queryKind,
        queryMasked: fila.queryMasked,
        reason: fila.reason,
        reasonNote: fila.reasonNote,
        candidateIds: fila.candidateIds,
        openedPatientId: fila.openedPatientId,
        verdicts: fila.verdicts,
        liveHisRequested: false,
      },
    });
    return true;
  } catch (error) {
    console.error('PatientLookupLog: no se pudo registrar la consulta', error);
    return false;
  }
}

async function superaElLimite(db: Db, actor: ActorRastreo): Promise<boolean> {
  const { max, ventanaMin } = limitesDeBusqueda();
  const recientes = await db.patientLookupLog.count({
    where: {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      queryKind: { in: TIPOS_DE_BUSQUEDA },
      createdAt: { gte: new Date(Date.now() - ventanaMin * 60_000) },
    },
  });
  return recientes >= max;
}

/** DOCTOR: solo pacientes con los que tiene una cita suya (misma regla que `TenantRbacGuard`). */
function filtroRelacion(actor: ActorRastreo): Prisma.PatientProfileWhereInput {
  if (!actor.permisos.soloConRelacionTerapeutica) return {};
  return {
    appointments: {
      some: {
        organizationId: actor.organizationId,
        scheduleSlot: { doctorId: actor.scopeDoctorId ?? '__sin_medico__' },
      },
    },
  };
}

/** El alcance que limita las CITAS visibles (BOOKING_AGENT: su EPS y su médico; DOCTOR: las suyas). */
function alcanceDeCitas(
  actor: ActorRastreo,
): Prisma.AppointmentWhereInput | null {
  const w: Prisma.AppointmentWhereInput = {};
  if (actor.permisos.aplicaScopeAgente && actor.scopeEpsId) {
    w.epsId = actor.scopeEpsId;
  }
  if (actor.scopeDoctorId) w.scheduleSlot = { doctorId: actor.scopeDoctorId };
  return Object.keys(w).length > 0 ? w : null;
}

/** Sin `actor.scopeDoctorId` un DOCTOR no tiene a quién ver: falla cerrado. */
function actorIncoherente(actor: ActorRastreo): boolean {
  return actor.permisos.soloConRelacionTerapeutica && !actor.scopeDoctorId;
}

async function zonaHorariaDe(db: Db, organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return org?.timezone || DEFAULT_TIMEZONE;
}

const SELECCION_PACIENTE = {
  eps: { select: { name: true } },
  _count: { select: { appointments: true } },
} as const;

type PacienteConEps = Prisma.PatientProfileGetPayload<{
  include: typeof SELECCION_PACIENTE;
}>;

function aCandidato(
  p: PacienteConEps,
  por: CandidatoRastreo['coincidePor'],
): CandidatoRastreo {
  return {
    tipo: 'PACIENTE',
    id: p.id,
    nombre: enmascararNombre(p.fullName),
    documento: enmascararDocumento(p.cedula),
    contacto: enmascararIdentificadorWhatsapp(p.whatsappId ?? p.bsuid),
    eps: p.eps?.name ?? null,
    citas: p._count.appointments,
    coincidePor: por,
  };
}

// ─────────────────────────────────────────────────────────────
// Búsqueda de candidatos
// ─────────────────────────────────────────────────────────────

export async function buscarCandidatos(
  db: Db,
  actor: ActorRastreo,
  entrada: { consulta: unknown; motivo: unknown; nota?: unknown },
): Promise<Resultado<ResultadoBusqueda>> {
  if (!actor.permisos.buscar || actorIncoherente(actor)) {
    return { success: false, error: SIN_PERMISOS };
  }
  const motivo = validarMotivo(entrada.motivo, entrada.nota);
  if (!motivo.success) return motivo;

  const busqueda = clasificarBusqueda(
    typeof entrada.consulta === 'string' ? entrada.consulta : '',
  );
  if (busqueda.tipo === 'INVALIDA') {
    return { success: false, error: busqueda.motivo };
  }

  if (await superaElLimite(db, actor)) {
    return { success: false, error: MSG_LIMITE };
  }

  const org = actor.organizationId;
  const relacion = filtroRelacion(actor);
  const veRemitentes = actor.permisos.conversacion !== 'NINGUNA';
  let pacientes: { p: PacienteConEps; por: CandidatoRastreo['coincidePor'] }[] = [];
  let remitentes: string[] = [];
  let queryKind: string;
  let queryMasked: string;

  if (busqueda.tipo === 'DOCUMENTO_O_TELEFONO') {
    queryKind = busqueda.documentos.length > 0 ? 'CEDULA' : 'PHONE';
    queryMasked = enmascararDocumento(busqueda.digitos) ?? '';

    if (busqueda.documentos.length > 0) {
      let porCedula = await db.patientProfile.findMany({
        where: { organizationId: org, cedula: { in: busqueda.documentos }, ...relacion },
        include: SELECCION_PACIENTE,
        take: MAX_CANDIDATOS + 1,
      });
      if (porCedula.length === 0) {
        // Segundo intento (§4.2): el documento guardado con ceros a la izquierda
        // que el paciente no escribió (Excel se los come). Solo como respaldo de
        // lectura, nunca como primera pasada.
        const sinCeros = busqueda.documentos[busqueda.documentos.length - 1];
        const ids = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM "PatientProfile"
          WHERE "organizationId" = ${org}
            AND regexp_replace("cedula", '^0+', '') = ${sinCeros}
          LIMIT ${MAX_CANDIDATOS + 1}`);
        if (ids.length > 0) {
          porCedula = await db.patientProfile.findMany({
            where: { organizationId: org, id: { in: ids.map((r) => r.id) }, ...relacion },
            include: SELECCION_PACIENTE,
          });
        }
      }
      pacientes.push(...porCedula.map((p) => ({ p, por: 'CEDULA' as const })));
    }

    if (busqueda.telefonos.length > 0) {
      const porTelefono = await db.patientProfile.findMany({
        where: { organizationId: org, whatsappId: { in: busqueda.telefonos }, ...relacion },
        include: SELECCION_PACIENTE,
        take: MAX_CANDIDATOS + 1,
      });
      pacientes.push(...porTelefono.map((p) => ({ p, por: 'TELEFONO' as const })));

      if (veRemitentes) {
        remitentes = await remitentesSinPerfil(db, org, busqueda.telefonos);
      }
    }
  } else if (busqueda.tipo === 'BSUID') {
    queryKind = 'BSUID';
    queryMasked = enmascararIdentificadorWhatsapp(busqueda.valor) ?? '';
    const porBsuid = await db.patientProfile.findMany({
      where: { organizationId: org, bsuid: busqueda.valor, ...relacion },
      include: SELECCION_PACIENTE,
      take: MAX_CANDIDATOS + 1,
    });
    pacientes.push(...porBsuid.map((p) => ({ p, por: 'BSUID' as const })));
    if (veRemitentes) remitentes = await remitentesSinPerfil(db, org, [busqueda.valor]);
  } else {
    queryKind = 'NAME';
    queryMasked = enmascararNombre(busqueda.palabras.join(' '));
    const ids = await idsPorNombre(db, actor, busqueda.palabras);
    if (ids.length > 0) {
      const porNombre = await db.patientProfile.findMany({
        where: { organizationId: org, id: { in: ids }, ...relacion },
        include: SELECCION_PACIENTE,
        orderBy: { fullName: 'asc' },
      });
      pacientes.push(...porNombre.map((p) => ({ p, por: 'NOMBRE' as const })));
    }
  }

  // Sin repetidos (una cédula que también es un teléfono no debe salir dos veces).
  const vistos = new Set<string>();
  pacientes = pacientes.filter(({ p }) => !vistos.has(p.id) && !!vistos.add(p.id));
  const conocidos = new Set(pacientes.flatMap(({ p }) => [p.whatsappId, p.bsuid]));
  remitentes = remitentes.filter((r) => !conocidos.has(r));

  const todos: CandidatoRastreo[] = [
    ...pacientes.map(({ p, por }) => aCandidato(p, por)),
    ...remitentes.map(
      (id): CandidatoRastreo => ({
        tipo: 'REMITENTE',
        id,
        nombre: '',
        documento: null,
        contacto: enmascararIdentificadorWhatsapp(id),
        eps: null,
        citas: 0,
        coincidePor: busqueda.tipo === 'BSUID' ? 'BSUID' : 'TELEFONO',
      }),
    ),
  ];
  const hayMas = todos.length > MAX_CANDIDATOS;
  const candidatos = todos.slice(0, MAX_CANDIDATOS);

  const registrada = await registrar(db, actor, {
    mode: 'A',
    queryKind,
    queryMasked,
    reason: motivo.data.motivo,
    reasonNote: motivo.data.nota,
    // Solo ids de perfil; un remitente sin perfil se anota enmascarado.
    candidateIds: candidatos.map((c) =>
      c.tipo === 'PACIENTE' ? c.id : `remitente:${c.contacto ?? ''}`,
    ),
    openedPatientId: null,
  });
  if (!registrada) return { success: false, error: MSG_NO_REGISTRADA };

  return {
    success: true,
    data: { candidatos, hayMas, interpretadoComo: busqueda.tipo },
  };
}

/** Números que escribieron al bot y NO tienen perfil: solo existen en `InteractionLog`. */
async function remitentesSinPerfil(
  db: Db,
  organizationId: string,
  identificadores: string[],
): Promise<string[]> {
  const logs = await db.interactionLog.findMany({
    where: { organizationId, whatsappId: { in: identificadores } },
    distinct: ['whatsappId'],
    orderBy: { createdAt: 'desc' },
    select: { whatsappId: true },
    take: 3,
  });
  return logs.map((l) => l.whatsappId);
}

/**
 * Búsqueda por nombre con el índice trigram de la Fase 0: la expresión
 * `fn_norm_texto("fullName")` es EXACTAMENTE la del índice, y cada palabra se
 * busca por separado (en cualquier orden). `escaparLike` evita que un `%` o un
 * `_` conviertan la búsqueda en "todos los pacientes".
 */
async function idsPorNombre(
  db: Db,
  actor: ActorRastreo,
  palabras: string[],
): Promise<string[]> {
  const condiciones = palabras.map(
    (p) =>
      Prisma.sql`fn_norm_texto(p."fullName") LIKE '%' || fn_norm_texto(${escaparLike(p)}) || '%'`,
  );
  const relacion = actor.permisos.soloConRelacionTerapeutica
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "Appointment" a
        JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
        WHERE a."patientId" = p.id
          AND a."organizationId" = ${actor.organizationId}
          AND s."doctorId" = ${actor.scopeDoctorId ?? '__sin_medico__'})`
    : Prisma.empty;
  const filas = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM "PatientProfile" p
    WHERE p."organizationId" = ${actor.organizationId}
      AND ${Prisma.join(condiciones, ' AND ')}
      ${relacion}
    ORDER BY p."fullName"
    LIMIT ${MAX_CANDIDATOS + 1}`);
  return filas.map((f) => f.id);
}

// ─────────────────────────────────────────────────────────────
// Expediente A — "dice que agendó"
// ─────────────────────────────────────────────────────────────

export async function armarExpedienteA(
  db: Db,
  actor: ActorRastreo,
  entrada: {
    sujeto: SujetoRastreo;
    motivo: unknown;
    nota?: unknown;
    captura?: DatosCaptura;
  },
): Promise<Resultado<ExpedienteA>> {
  if (!actor.permisos.buscar || actorIncoherente(actor)) {
    return { success: false, error: SIN_PERMISOS };
  }
  const motivo = validarMotivo(entrada.motivo, entrada.nota);
  if (!motivo.success) return motivo;

  const { sujeto } = entrada;
  const org = actor.organizationId;
  const permisos = actor.permisos;
  const nivel = permisos.conversacion;

  // ── El sujeto ──────────────────────────────────────────────
  let paciente: PacienteConEps | null = null;
  let remitente: string | null = null;
  if (sujeto?.tipo === 'PACIENTE' && typeof sujeto.id === 'string') {
    paciente = await db.patientProfile.findFirst({
      where: { id: sujeto.id, organizationId: org, ...filtroRelacion(actor) },
      include: SELECCION_PACIENTE,
    });
    // El mismo mensaje si no existe, si es de otra clínica o si un DOCTOR no
    // tiene relación: distinguirlos sería un oráculo de existencia.
    if (!paciente) return { success: false, error: MSG_PACIENTE_NO_ENCONTRADO };
  } else if (
    sujeto?.tipo === 'REMITENTE' &&
    typeof sujeto.whatsappId === 'string' &&
    sujeto.whatsappId.length > 0 &&
    sujeto.whatsappId.length <= 64
  ) {
    // Un remitente sin perfil solo tiene conversación: quien no la ve no tiene qué abrir.
    if (nivel === 'NINGUNA') return { success: false, error: SIN_PERMISOS };
    remitente = sujeto.whatsappId;
  } else {
    return { success: false, error: 'Sujeto inválido.' };
  }

  const senderIds = paciente
    ? [paciente.whatsappId, paciente.bsuid].filter((x): x is string => !!x)
    : [remitente!];

  const ahora = new Date();
  const tz = await zonaHorariaDe(db, org);
  const alcance = alcanceDeCitas(actor);
  const cuentaOcultas = permisos.aplicaScopeAgente && alcance !== null;

  // ── Lecturas independientes, en paralelo ───────────────────
  const [
    citasBD,
    ocultas,
    configEspejo,
    logs,
    esperaBD,
    encuestasBD,
    avisosBD,
  ] = await Promise.all([
    paciente
      ? db.appointment.findMany({
          where: { organizationId: org, patientId: paciente.id, ...(alcance ?? {}) },
          include: {
            scheduleSlot: {
              select: {
                startTime: true,
                doctor: { select: { fullName: true, isFunctionalAgenda: true } },
                service: { select: { name: true } },
              },
            },
            eps: { select: { name: true } },
          },
          orderBy: { scheduleSlot: { startTime: 'desc' } },
          take: MAX_CITAS,
        })
      : Promise.resolve([]),
    paciente && cuentaOcultas
      ? db.appointment.count({
          where: { organizationId: org, patientId: paciente.id, NOT: alcance! },
        })
      : Promise.resolve(0),
    db.hospitalMirrorConfig.findUnique({
      where: { organizationId: org },
      select: {
        enabled: true,
        pushEnabled: true,
        pullEnabled: true,
        lastHeartbeatAt: true,
        lastHisReachable: true,
        lastHisDetail: true,
      },
    }),
    nivel !== 'NINGUNA'
      ? db.interactionLog.findMany({
          where: {
            organizationId: org,
            whatsappId: { in: senderIds },
            createdAt: { gte: new Date(ahora.getTime() - DIAS_CONVERSACION * MS_DIA) },
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            createdAt: true,
            status: true,
            failureReason: true,
            userMessage: true,
            botReply: true,
            metadata: true,
          },
        })
      : Promise.resolve([]),
    // La lista de espera y el historial "de la clínica" no son de un médico.
    !permisos.soloConRelacionTerapeutica
      ? db.waitlistEntry.findMany({
          where: paciente
            ? { organizationId: org, patientId: paciente.id }
            : { organizationId: org, whatsappId: { in: senderIds } },
          include: { service: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : Promise.resolve([]),
    paciente && !permisos.soloConRelacionTerapeutica
      ? db.chatSurvey.findMany({
          where: { organizationId: org, patientId: paciente.id, isUsed: true, rating: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { createdAt: true, rating: true, resolutionStatus: true },
        })
      : Promise.resolve([]),
    paciente && !permisos.soloConRelacionTerapeutica
      ? db.massNoticeRecipient.findMany({
          where: { organizationId: org, patientDocument: paciente.cedula },
          orderBy: { appointmentAtUtc: 'desc' },
          take: 10,
          select: { appointmentAtUtc: true, outcome: true, sentAt: true },
        })
      : Promise.resolve([]),
  ]);

  const conEspejo = configEspejo !== null;
  const verSync = permisos.verSync && conEspejo;
  const espejo = permisos.verSync ? saludDelEspejo(configEspejo) : null;
  const analisis = nivel !== 'NINGUNA' ? analizarConversacion(logs as FilaLog[]) : null;

  // ── Lecturas que dependen de las citas ─────────────────────
  const idsCitas = citasBD.map((c) => c.id);
  const idsNacidasAqui = citasBD.filter((c) => c.origin !== 'MIRROR').map((c) => c.id);
  const idsCanceladasPorHis = citasBD
    .filter(
      (c) =>
        c.status === 'CANCELLED' &&
        (c.metaLog as { cancelledBy?: string } | null)?.cancelledBy === 'MIRROR',
    )
    .map((c) => c.id);

  // Quién del personal canceló, para nombrarlo SOLO a quien puede verlo. Los ids
  // salen del `metaLog` de citas ya acotadas a esta clínica (no de la entrada del
  // cliente). La búsqueda es por id y sin acotar por organización a propósito:
  // un SUPER_ADMIN que cancela no pertenece a ninguna.
  const idsPersonal = permisos.verPersonal
    ? [
        ...new Set(
          citasBD
            .filter((c) => c.status === 'CANCELLED')
            .map((c) => leerCancelacionPersonal(c.metaLog)?.userId)
            .filter((id): id is string => !!id),
        ),
      ]
    : [];

  const [eventosBD, mensajesBD, auditoriasBajas, personalBD] = await Promise.all([
    verSync && idsNacidasAqui.length > 0
      ? db.syncOutbox.findMany({
          where: {
            organizationId: org,
            entityType: 'APPOINTMENT',
            entityId: { in: idsNacidasAqui },
            origin: 'LOCAL',
          },
          select: {
            seq: true,
            entityId: true,
            op: true,
            createdAt: true,
            deliveredAt: true,
            attempts: true,
            deadLettered: true,
            nextAttemptAt: true,
            lastError: true,
          },
        })
      : Promise.resolve([]),
    nivel !== 'NINGUNA' && idsCitas.length > 0
      ? db.whatsappMessageLog.findMany({
          where: {
            organizationId: org,
            appointmentId: { in: idsCitas },
            kind: 'BOOKING_CONFIRMATION',
          },
          select: {
            appointmentId: true,
            status: true,
            createdAt: true,
            statusAt: true,
            errorCode: true,
            errorDetail: true,
          },
        })
      : Promise.resolve([]),
    idsCanceladasPorHis.length > 0
      ? db.syncAudit.findMany({
          where: {
            organizationId: org,
            entityType: 'APPOINTMENT',
            op: 'CANCEL',
            direction: SYNC_AUDIT_DIRECTION.INBOUND,
            outcome: 'OK',
            entityId: { in: idsCanceladasPorHis },
            createdAt: { gte: new Date(ahora.getTime() - DIAS_AUDITORIA_HIS * MS_DIA) },
          },
          orderBy: { createdAt: 'desc' },
          select: { entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
    idsPersonal.length > 0
      ? db.user.findMany({
          where: { id: { in: idsPersonal } },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  const eventosPorCita = agrupar(eventosBD, (e) => e.entityId);
  const mensajesPorCita = agrupar(
    mensajesBD.filter((m) => m.appointmentId !== null),
    (m) => m.appointmentId as string,
  );
  const emailDelPersonal = new Map(personalBD.map((u) => [u.id, u.email]));
  const bajaHis = new Map<string, Date>();
  for (const a of auditoriasBajas) {
    if (a.entityId && !bajaHis.has(a.entityId)) bajaHis.set(a.entityId, a.createdAt);
  }

  // ── Las citas, ya como evidencia ───────────────────────────
  const captura = entrada.captura;
  const citas: CitaExpediente[] = citasBD.map((a) => {
    const base = {
      startIso: a.scheduleSlot.startTime.toISOString(),
      doctor: etiquetaMedico(a.scheduleSlot.doctor.fullName, a.scheduleSlot.doctor.isFunctionalAgenda),
      service: a.scheduleSlot.service.name,
    };
    const eventos = eventosPorCita.get(a.id) ?? [];
    const personal = a.status === 'CANCELLED' ? leerCancelacionPersonal(a.metaLog) : null;
    const evidencia: CitaRastreo = {
      id: a.id,
      status: a.status,
      attendance: a.attendanceStatus,
      origin: a.origin,
      createdAtIso: a.createdAt.toISOString(),
      ...base,
      eps: a.eps?.name ?? null,
      cancelacion:
        a.status === 'CANCELLED'
          ? derivarCancelacion({
              metaLog: a.metaLog,
              canceladaPorPacienteEn: analisis?.canceladasPorPaciente.get(a.id) ?? null,
              auditoriaHisEn: bajaHis.get(a.id) ?? null,
              // Quien puede ver personas: el correo (o "usuario eliminado" si la
              // cuenta ya no existe). Quien no: solo el rol.
              actorPersonal: personal
                ? etiquetaActorPersonal(
                    personal.role,
                    !permisos.verPersonal || !personal.userId
                      ? null
                      : (emailDelPersonal.get(personal.userId) ?? 'usuario eliminado'),
                  )
                : null,
            })
          : null,
      sync:
        verSync && a.origin !== 'MIRROR'
          ? derivarSync(eventos as unknown as FilaOutbox[])
          : null,
      confirmacion:
        nivel !== 'NINGUNA'
          ? elegirConfirmacion((mensajesPorCita.get(a.id) ?? []) as unknown as FilaMensaje[])
          : null,
      confirmadaEnConversacion: analisis ? analisis.confirmadas.has(a.id) : null,
      coincideConCaptura: coincideConCaptura(base, captura, tz),
    };
    return {
      ...evidencia,
      lineaDeVida: construirLineaDeVida(evidencia, { espejo }),
      eventosSync: permisos.verInternos ? eventos.map(aVistaDeEvento) : null,
      recordatorioIso: a.reminderSentAt ? a.reminderSentAt.toISOString() : null,
    };
  });

  const espera = mapearEspera(esperaBD);
  const evidencia: EvidenciaRastreoA = {
    ahoraIso: ahora.toISOString(),
    zonaHoraria: tz,
    pacienteEncontrado: paciente !== null,
    citas,
    // Un DOCTOR no debe saber que el paciente tiene otras citas con otros médicos.
    citasOcultas: cuentaOcultas ? ocultas : 0,
    espera,
    conversacion: analisis?.resumen ?? null,
    espejo,
    capturaIndicada: hayCaptura(captura),
  };
  const resultado = clasificarRastreoA(evidencia);

  // ── Bitácora ANTES de devolver nada ────────────────────────
  const registrada = await registrar(db, actor, {
    mode: 'A',
    queryKind: 'OPEN',
    queryMasked: paciente
      ? (enmascararDocumento(paciente.cedula) ?? '')
      : (enmascararIdentificadorWhatsapp(remitente) ?? ''),
    reason: motivo.data.motivo,
    reasonNote: motivo.data.nota,
    candidateIds: paciente ? [paciente.id] : [],
    openedPatientId: paciente?.id ?? null,
    verdicts: resultado.veredictos.map((v) => ({ codigo: v.codigo, citaId: v.citaId })),
  });
  if (!registrada) return { success: false, error: MSG_NO_REGISTRADA };

  const identidad: IdentidadVista | null = paciente
    ? {
        pacienteId: paciente.id,
        nombre: paciente.fullName,
        documento: enmascararDocumento(paciente.cedula),
        whatsapp: paciente.whatsappId ? enmascararIdentificadorWhatsapp(paciente.whatsappId) : null,
        bsuid: paciente.bsuid ? enmascararIdentificadorWhatsapp(paciente.bsuid) : null,
        eps: paciente.eps?.name ?? null,
        regimen: paciente.regime ?? null,
        creadoIso: paciente.createdAt.toISOString(),
      }
    : null;

  const historial: HistorialVista = {
    encuestas: encuestasBD.map((e) => ({
      creadoIso: e.createdAt.toISOString(),
      calificacion: e.rating as number,
      resolucion: e.resolutionStatus,
    })),
    avisosMasivos: avisosBD.map((a) => ({
      citaIso: a.appointmentAtUtc.toISOString(),
      resultado: a.outcome,
      enviadoIso: a.sentAt ? a.sentAt.toISOString() : null,
    })),
  };

  return {
    success: true,
    data: {
      modo: 'A',
      generadoIso: ahora.toISOString(),
      zonaHoraria: tz,
      conEspejo,
      sujeto,
      identidad,
      remitente: remitente ? enmascararIdentificadorWhatsapp(remitente) : null,
      resultado,
      citas,
      espera,
      historial,
      conversacion: {
        nivel,
        resumen: analisis?.resumen ?? null,
        mensajes: nivel === 'TEXTO' ? filasDeConversacion(logs as FilaLog[]) : null,
      },
      espejo,
      verInternos: permisos.verInternos,
      capturaIndicada: hayCaptura(captura),
    },
  };
}

function agrupar<T>(filas: T[], clave: (f: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const f of filas) {
    const k = clave(f);
    const lista = mapa.get(k);
    if (lista) lista.push(f);
    else mapa.set(k, [f]);
  }
  return mapa;
}

function aVistaDeEvento(e: {
  seq: bigint;
  op: string;
  createdAt: Date;
  deliveredAt: Date | null;
  attempts: number;
  deadLettered: boolean;
  lastError: string | null;
}): EventoSyncVista {
  return {
    seq: String(e.seq),
    op: e.op,
    creadoIso: e.createdAt.toISOString(),
    entregadoIso: e.deliveredAt ? e.deliveredAt.toISOString() : null,
    intentos: e.attempts,
    rendido: e.deadLettered && !e.deliveredAt,
    ultimoError: e.lastError,
  };
}

// ─────────────────────────────────────────────────────────────
// Expediente B — "lo agendaron en el HIS"
// ─────────────────────────────────────────────────────────────

const CONFIG_ESPEJO = {
  enabled: true,
  pushEnabled: true,
  pullEnabled: true,
  lastHeartbeatAt: true,
  lastHisReachable: true,
  lastHisDetail: true,
} as const;

/** Los médicos del HIS que se pueden elegir para investigar un cupo. */
export async function opcionesCupoHis(
  db: Db,
  actor: ActorRastreo,
): Promise<Resultado<{ medicos: OpcionMedico[] }>> {
  if (!actor.permisos.modoB) return { success: false, error: SIN_PERMISOS };
  const org = actor.organizationId;

  const config = await db.hospitalMirrorConfig.findUnique({
    where: { organizationId: org },
    select: { id: true },
  });
  if (!config) return { success: false, error: 'Esta clínica no tiene espejo con un HIS.' };

  const [mapas, catalogo] = await Promise.all([
    db.mirrorEntityMap.findMany({
      where: { organizationId: org, entityType: 'DOCTOR' },
      select: { agenIAId: true, externalKey: true, externalLabel: true },
    }),
    db.mirrorCatalogEntry.findMany({
      where: { organizationId: org, entityType: 'DOCTOR' },
      select: { externalKey: true, label: true },
      orderBy: { label: 'asc' },
      take: 500,
    }),
  ]);
  const medicos = await db.doctorProfile.findMany({
    where: { organizationId: org, id: { in: mapas.map((m) => m.agenIAId) } },
    select: { id: true, fullName: true, isFunctionalAgenda: true },
  });
  const porId = new Map(medicos.map((m) => [m.id, m]));

  const opciones = new Map<string, OpcionMedico>();
  for (const m of mapas) {
    const perfil = porId.get(m.agenIAId);
    opciones.set(m.externalKey, {
      clave: m.externalKey,
      etiqueta: perfil
        ? etiquetaMedico(perfil.fullName, perfil.isFunctionalAgenda)
        : (m.externalLabel ?? m.externalKey),
      homologado: true,
    });
  }
  for (const c of catalogo) {
    if (!opciones.has(c.externalKey)) {
      opciones.set(c.externalKey, {
        clave: c.externalKey,
        etiqueta: c.label,
        homologado: false,
      });
    }
  }
  return {
    success: true,
    data: {
      medicos: [...opciones.values()].sort((a, b) =>
        a.etiqueta.localeCompare(b.etiqueta, 'es'),
      ),
    },
  };
}

interface PerfilPorDocumento {
  id: string;
  cedula: string;
  fullName: string;
  whatsappId: string | null;
  bsuid: string | null;
}

export async function investigarCupoB(
  db: Db,
  actor: ActorRastreo,
  entrada: {
    documento: unknown;
    medicoClave: unknown;
    fecha: unknown;
    hora: unknown;
    motivo: unknown;
    nota?: unknown;
  },
): Promise<Resultado<ExpedienteB>> {
  if (!actor.permisos.modoB) return { success: false, error: SIN_PERMISOS };
  const motivo = validarMotivo(entrada.motivo, entrada.nota);
  if (!motivo.success) return motivo;

  const org = actor.organizationId;
  const config = await db.hospitalMirrorConfig.findUnique({
    where: { organizationId: org },
    select: CONFIG_ESPEJO,
  });
  if (!config) return { success: false, error: 'Esta clínica no tiene espejo con un HIS.' };

  const doc = clasificarBusqueda(typeof entrada.documento === 'string' ? entrada.documento : '');
  if (doc.tipo !== 'DOCUMENTO_O_TELEFONO' || doc.documentos.length === 0) {
    return { success: false, error: 'Escribe la cédula del paciente (solo números).' };
  }
  const medicoClave = typeof entrada.medicoClave === 'string' ? entrada.medicoClave.trim() : '';
  if (!medicoClave || medicoClave.length > 64) {
    return { success: false, error: 'Elige el médico del HIS.' };
  }
  const tz = await zonaHorariaDe(db, org);
  const inicio = aUtc(String(entrada.fecha ?? ''), String(entrada.hora ?? ''), tz);
  if (!inicio) return { success: false, error: 'La fecha y la hora no son válidas.' };

  if (await superaElLimite(db, actor)) return { success: false, error: MSG_LIMITE };

  // ── El médico: homologado con uno de AgenIA, o solo en el catálogo del HIS ──
  const [mapa, catalogo] = await Promise.all([
    db.mirrorEntityMap.findFirst({
      where: { organizationId: org, entityType: 'DOCTOR', externalKey: medicoClave },
      select: { agenIAId: true, externalLabel: true },
    }),
    db.mirrorCatalogEntry.findFirst({
      where: { organizationId: org, entityType: 'DOCTOR', externalKey: medicoClave },
      select: { label: true },
    }),
  ]);
  if (!mapa && !catalogo) {
    return { success: false, error: 'Ese médico no está en el catálogo de esta clínica.' };
  }
  const perfilMedico = mapa
    ? await db.doctorProfile.findFirst({
        where: { id: mapa.agenIAId, organizationId: org },
        select: { fullName: true, isFunctionalAgenda: true },
      })
    : null;
  const etiquetaDoctor = perfilMedico
    ? etiquetaMedico(perfilMedico.fullName, perfilMedico.isFunctionalAgenda)
    : (mapa?.externalLabel ?? catalogo?.label ?? medicoClave);

  // ── El paciente: el documento tal cual y sus variantes con ceros ──
  const digitos = doc.digitos;
  const sinCeros = doc.documentos[doc.documentos.length - 1];
  const perfiles = await db.$queryRaw<PerfilPorDocumento[]>(Prisma.sql`
    SELECT id, cedula, "fullName", "whatsappId", bsuid
    FROM "PatientProfile"
    WHERE "organizationId" = ${org}
      AND regexp_replace("cedula", '^0+', '') = ${sinCeros}
    LIMIT 10`);
  const exacto = perfiles.find((p) => p.cedula === digitos) ?? null;
  const perfil = exacto ?? perfiles[0] ?? null;

  // ── Qué sabe AgenIA de ese cupo ──
  const prefijo = `cupo=${medicoClave}|${inicio.toISOString()}`;
  const [cupo, auditoriasBD, citaDelPaciente] = await Promise.all([
    mapa
      ? db.scheduleSlot.findFirst({
          where: { organizationId: org, doctorId: mapa.agenIAId, startTime: inicio },
          select: { id: true },
        })
      : Promise.resolve(null),
    db.syncAudit.findMany({
      where: {
        organizationId: org,
        entityType: 'APPOINTMENT',
        direction: SYNC_AUDIT_DIRECTION.INBOUND,
        detail: { startsWith: prefijo },
        createdAt: { gte: new Date(Date.now() - DIAS_AUDITORIA_HIS * MS_DIA) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { outcome: true, op: true, detail: true, createdAt: true },
    }),
    perfil
      ? db.appointment.findFirst({
          where: {
            organizationId: org,
            patientId: perfil.id,
            status: { not: 'CANCELLED' },
            scheduleSlot: { startTime: inicio, ...(mapa ? { doctorId: mapa.agenIAId } : {}) },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const auditorias: AuditoriaCupo[] = auditoriasBD.map((a) => ({
    resultado: a.outcome as AuditoriaCupo['resultado'],
    op: a.op,
    nota: (a.detail ?? '').slice(prefijo.length).replace(/^;\s*/, ''),
    atIso: a.createdAt.toISOString(),
  }));
  const espejo = saludDelEspejo(config);
  const ahora = new Date();
  const evidencia: EvidenciaRastreoB = {
    ahoraIso: ahora.toISOString(),
    zonaHoraria: tz,
    cupoDescripcion: `Cupo del HIS: ${etiquetaDoctor}, ${formatAppointmentCompact(inicio, { timeZone: tz })}`,
    paciente: {
      perfilEncontrado: perfil !== null,
      coincidencia: exacto ? 'EXACTA' : perfil ? 'SIN_CEROS' : null,
      perfilesConVariante: perfil ? perfiles.length - 1 : 0,
      conWhatsapp: !!(perfil?.whatsappId || perfil?.bsuid),
    },
    cupoEnAgenIA: {
      medicoHomologado: mapa !== null,
      cupoExiste: cupo !== null,
      auditorias,
      citaDelPacienteEnAgenIA: citaDelPaciente !== null,
    },
    espejo,
  };
  const resultado = clasificarRastreoB(evidencia);

  const registrada = await registrar(db, actor, {
    mode: 'B',
    queryKind: 'CEDULA',
    queryMasked: enmascararDocumento(digitos) ?? '',
    reason: motivo.data.motivo,
    reasonNote: motivo.data.nota,
    candidateIds: perfiles.map((p) => p.id),
    openedPatientId: perfil?.id ?? null,
    verdicts: resultado.veredictos.map((v) => ({ codigo: v.codigo, citaId: v.citaId })),
  });
  if (!registrada) return { success: false, error: MSG_NO_REGISTRADA };

  return {
    success: true,
    data: {
      modo: 'B',
      generadoIso: ahora.toISOString(),
      zonaHoraria: tz,
      resultado,
      cupo: { medico: etiquetaDoctor, inicioIso: inicio.toISOString(), homologado: mapa !== null },
      identidad: {
        encontrada: perfil !== null,
        pacienteId: perfil?.id ?? null,
        nombre: perfil ? enmascararNombre(perfil.fullName) : null,
        documento: perfil ? enmascararDocumento(perfil.cedula) : enmascararDocumento(digitos),
        coincidencia: evidencia.paciente.coincidencia,
        perfilesConVariante: evidencia.paciente.perfilesConVariante,
        conWhatsapp: evidencia.paciente.conWhatsapp,
      },
      auditorias,
      espejo,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Revelar un dato enmascarado
// ─────────────────────────────────────────────────────────────

/**
 * Los datos completos de un paciente (§6, punto 3: "revelar un dato queda
 * registrado"). Es una acción aparte, con su propia fila en la bitácora.
 */
export async function revelarIdentidad(
  db: Db,
  actor: ActorRastreo,
  entrada: { pacienteId: unknown; motivo: unknown; nota?: unknown },
): Promise<
  Resultado<{ documento: string | null; whatsapp: string | null; bsuid: string | null }>
> {
  if (!actor.permisos.buscar || actorIncoherente(actor)) {
    return { success: false, error: SIN_PERMISOS };
  }
  const motivo = validarMotivo(entrada.motivo, entrada.nota);
  if (!motivo.success) return motivo;
  if (typeof entrada.pacienteId !== 'string') {
    return { success: false, error: MSG_PACIENTE_NO_ENCONTRADO };
  }

  const paciente = await db.patientProfile.findFirst({
    where: { id: entrada.pacienteId, organizationId: actor.organizationId, ...filtroRelacion(actor) },
    select: { id: true, cedula: true, whatsappId: true, bsuid: true },
  });
  if (!paciente) return { success: false, error: MSG_PACIENTE_NO_ENCONTRADO };

  const registrada = await registrar(db, actor, {
    mode: 'A',
    queryKind: 'REVEAL',
    queryMasked: enmascararDocumento(paciente.cedula) ?? '',
    reason: motivo.data.motivo,
    reasonNote: motivo.data.nota,
    candidateIds: [paciente.id],
    openedPatientId: paciente.id,
  });
  if (!registrada) return { success: false, error: MSG_NO_REGISTRADA };

  return {
    success: true,
    data: {
      documento: paciente.cedula,
      whatsapp: paciente.whatsappId,
      bsuid: paciente.bsuid,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// La bitácora, para quien la revisa
// ─────────────────────────────────────────────────────────────

export async function listarConsultas(
  db: Db,
  actor: ActorRastreo,
  parametros: { pagina?: number } = {},
): Promise<Resultado<ListaConsultas>> {
  if (!actor.permisos.verConsultas) return { success: false, error: SIN_PERMISOS };
  const org = actor.organizationId;
  const pagina = Math.max(1, Math.floor(Number(parametros.pagina) || 1));

  const [total, filas] = await Promise.all([
    db.patientLookupLog.count({ where: { organizationId: org } }),
    db.patientLookupLog.findMany({
      where: { organizationId: org },
      orderBy: { createdAt: 'desc' },
      skip: (pagina - 1) * TAMANO_PAGINA,
      take: TAMANO_PAGINA,
    }),
  ]);

  const usuarios = await db.user.findMany({
    where: { id: { in: [...new Set(filas.map((f) => f.actorUserId))] } },
    select: { id: true, email: true },
  });
  const emailDe = new Map(usuarios.map((u) => [u.id, u.email]));

  const vista: FilaConsulta[] = filas.map((f) => ({
    id: f.id,
    creadoIso: f.createdAt.toISOString(),
    actorEmail: emailDe.get(f.actorUserId) ?? null,
    actorRol: f.actorRole,
    modo: f.mode,
    tipo: f.queryKind,
    busqueda: f.queryMasked,
    motivo: f.reason,
    nota: f.reasonNote,
    candidatos: Array.isArray(f.candidateIds) ? f.candidateIds.length : 0,
    abrioExpediente: f.openedPatientId !== null || f.queryKind === 'OPEN',
    veredictos: Array.isArray(f.verdicts)
      ? (f.verdicts as { codigo?: string }[]).map((v) => v.codigo ?? '').filter(Boolean)
      : [],
  }));

  return {
    success: true,
    data: {
      filas: vista,
      total,
      pagina,
      paginas: Math.max(1, Math.ceil(total / TAMANO_PAGINA)),
    },
  };
}

export type { ResultadoRastreo };
