/**
 * Rastreo de paciente — el lado de la pantalla de la consulta en vivo al HIS
 * (Fase 2, docs/PLAN_RASTREO_PACIENTE.md §7): pedirla y ver cómo va.
 *
 * Leer lo que respondió el HIS y aplicarlo al veredicto NO está aquí: lo hacen
 * `armarExpedienteA` e `investigarCupoB` (servicio.ts) al reabrir el expediente con
 * los ids que devuelve esta consulta. Este archivo importa de `servicio.ts` (el
 * motivo, la bitácora, el alcance) y `servicio.ts` no lo importa: sin ciclos.
 *
 * ═══ Cómo se cuida al hospital y al paciente ═══
 *  1. Falla rápido: si el agente no puede contestar, se dice ANTES de encolar.
 *  2. Motivo obligatorio y bitácora ANTES de preguntar: si no se puede anotar, no se
 *     consulta. (Y cada consulta cuesta lectura sobre la base productiva del hospital.)
 *  3. Límite de tasa por usuario, aparte del de las búsquedas, y un tope de
 *     consultas en curso por clínica.
 *  4. Un BOOKING_AGENT acotado a una EPS o a un médico no pide la lista completa de
 *     citas del paciente en el HIS: mostraría lo que su alcance en AgenIA le oculta.
 *  5. El tenant sale del actor; nada de esto recibe una organización del cliente.
 */
import type { PrismaClient } from '@agenia/database';
import {
  LIMITES_CONSULTA_HIS,
  clasificarBusqueda,
  enmascararDocumento,
} from '@agenia/shared';
import { SIN_PERMISOS, type ActorRastreo } from './acceso';
import {
  crearPeticiones,
  disponibilidadHis,
  documentosDelPaciente,
  idsValidos,
  pendientesDeLaClinica,
  planDeConsultaA,
  planDeConsultaB,
  progresoConsulta,
  type CitaParaConsulta,
  type Peticion,
} from './consulta-his';
import {
  MAX_CITAS,
  MSG_NO_REGISTRADA,
  MSG_PACIENTE_NO_ENCONTRADO,
  actorIncoherente,
  alcanceDeCitas,
  filtroRelacion,
  perfilesPorDocumento,
  registrar,
  validarMotivo,
  zonaHorariaDe,
} from './servicio';
import { aUtc } from './zona-horaria';
import type {
  ConsultaHisIniciada,
  ProgresoConsultaHis,
  Resultado,
} from './tipos';

type Db = PrismaClient;

export const MSG_LIMITE_HIS =
  'Hiciste demasiadas consultas al hospital seguidas. Espera unos minutos e intenta de nuevo.';
export const MSG_HIS_OCUPADO =
  'Hay otras consultas al hospital en curso. Espera unos segundos e intenta de nuevo.';
export const MSG_NADA_QUE_CONSULTAR =
  'No hay nada que consultar en el HIS para este paciente: ninguna de sus citas tiene un médico homologado con el hospital.';
const MSG_NO_INICIADA = 'No se pudo iniciar la consulta al hospital. Intenta de nuevo.';

/**
 * Cuántas consultas en vivo puede pedir un usuario por ventana. Más bajo que el de
 * las búsquedas (30): cada una es lectura sobre la base productiva del hospital.
 * Se lee al llamar, para poder afinarlo sin un despliegue.
 */
export function limitesConsultaHis(): { max: number; ventanaMin: number } {
  return {
    max: Number(process.env.RASTREO_MAX_CONSULTAS_HIS) || 10,
    ventanaMin: Number(process.env.RASTREO_VENTANA_MIN) || 10,
  };
}

async function superaElLimiteHis(
  db: Db,
  actor: ActorRastreo,
  ahora: Date,
): Promise<boolean> {
  const { max, ventanaMin } = limitesConsultaHis();
  const recientes = await db.patientLookupLog.count({
    where: {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      queryKind: 'LIVE_HIS',
      createdAt: { gte: new Date(ahora.getTime() - ventanaMin * 60_000) },
    },
  });
  return recientes >= max;
}

export type EntradaIniciarConsultaHis =
  | { modo: 'A'; pacienteId: unknown; motivo: unknown; nota?: unknown }
  | {
      modo: 'B';
      documento: unknown;
      medicoClave: unknown;
      fecha: unknown;
      hora: unknown;
      motivo: unknown;
      nota?: unknown;
    };

/** Lo que se sabe del sujeto de la consulta una vez resuelto: a quién se refiere y qué se le pregunta al HIS. */
interface Plan {
  peticiones: Peticion[];
  patientId: string | null;
  /** Enmascarado, para la bitácora. */
  consultaEnmascarada: string;
  candidateIds: string[];
}

async function planDeA(
  db: Db,
  actor: ActorRastreo,
  entrada: Extract<EntradaIniciarConsultaHis, { modo: 'A' }>,
  ahora: Date,
): Promise<Resultado<Plan>> {
  if (typeof entrada.pacienteId !== 'string' || !entrada.pacienteId) {
    return { success: false, error: 'Sujeto inválido.' };
  }
  const org = actor.organizationId;
  const paciente = await db.patientProfile.findFirst({
    where: { id: entrada.pacienteId, organizationId: org, ...filtroRelacion(actor) },
    select: { id: true, cedula: true },
  });
  // El mismo mensaje si no existe o es de otra clínica: no es un oráculo.
  if (!paciente) return { success: false, error: MSG_PACIENTE_NO_ENCONTRADO };

  // Las citas visibles para ESTE actor (su EPS y su médico, si los tiene): lo que
  // no ve en AgenIA tampoco se le consulta en el HIS.
  const alcance = alcanceDeCitas(actor);
  const citasBD = await db.appointment.findMany({
    where: { organizationId: org, patientId: paciente.id, ...(alcance ?? {}) },
    select: {
      status: true,
      origin: true,
      scheduleSlot: { select: { startTime: true, doctorId: true } },
    },
    orderBy: { scheduleSlot: { startTime: 'desc' } },
    take: MAX_CITAS,
  });
  const mapas = await db.mirrorEntityMap.findMany({
    where: {
      organizationId: org,
      entityType: 'DOCTOR',
      agenIAId: { in: [...new Set(citasBD.map((c) => c.scheduleSlot.doctorId))] },
    },
    select: { agenIAId: true, externalKey: true },
  });
  const claves = new Map(mapas.map((m) => [m.agenIAId, m.externalKey]));

  const citas: CitaParaConsulta[] = citasBD.map((c) => ({
    startIso: c.scheduleSlot.startTime.toISOString(),
    status: c.status,
    origin: c.origin,
    doctorExternalKey: claves.get(c.scheduleSlot.doctorId) ?? null,
  }));
  const peticiones = planDeConsultaA({
    citas,
    documentos: documentosDelPaciente(paciente.cedula),
    ahora,
    incluirPorDocumento: !(actor.permisos.aplicaScopeAgente && alcance !== null),
  });
  return {
    success: true,
    data: {
      peticiones,
      patientId: paciente.id,
      consultaEnmascarada: enmascararDocumento(paciente.cedula) ?? '',
      candidateIds: [paciente.id],
    },
  };
}

async function planDeB(
  db: Db,
  actor: ActorRastreo,
  entrada: Extract<EntradaIniciarConsultaHis, { modo: 'B' }>,
): Promise<Resultado<Plan>> {
  if (!actor.permisos.modoB) return { success: false, error: SIN_PERMISOS };
  const org = actor.organizationId;

  const doc = clasificarBusqueda(
    typeof entrada.documento === 'string' ? entrada.documento : '',
  );
  if (doc.tipo !== 'DOCUMENTO_O_TELEFONO' || doc.documentos.length === 0) {
    return { success: false, error: 'Escribe la cédula del paciente (solo números).' };
  }
  const medicoClave =
    typeof entrada.medicoClave === 'string' ? entrada.medicoClave.trim() : '';
  if (!medicoClave || medicoClave.length > 32) {
    return { success: false, error: 'Elige el médico del HIS.' };
  }
  const tz = await zonaHorariaDe(db, org);
  const inicio = aUtc(String(entrada.fecha ?? ''), String(entrada.hora ?? ''), tz);
  if (!inicio) return { success: false, error: 'La fecha y la hora no son válidas.' };

  // El médico tiene que ser de ESTA clínica: homologado o al menos en su catálogo.
  const [mapa, catalogo] = await Promise.all([
    db.mirrorEntityMap.findFirst({
      where: { organizationId: org, entityType: 'DOCTOR', externalKey: medicoClave },
      select: { id: true },
    }),
    db.mirrorCatalogEntry.findFirst({
      where: { organizationId: org, entityType: 'DOCTOR', externalKey: medicoClave },
      select: { id: true },
    }),
  ]);
  if (!mapa && !catalogo) {
    return { success: false, error: 'Ese médico no está en el catálogo de esta clínica.' };
  }

  const perfiles = await perfilesPorDocumento(
    db,
    org,
    doc.documentos[doc.documentos.length - 1],
  );
  const perfil = perfiles.find((p) => p.cedula === doc.digitos) ?? perfiles[0] ?? null;

  const peticiones = planDeConsultaB({
    medicoClave,
    inicio,
    documentos: doc.documentos,
    incluirPorDocumento: !(
      actor.permisos.aplicaScopeAgente &&
      (actor.scopeEpsId !== null || actor.scopeDoctorId !== null)
    ),
  });
  return {
    success: true,
    data: {
      peticiones,
      patientId: perfil?.id ?? null,
      consultaEnmascarada: enmascararDocumento(doc.digitos) ?? '',
      candidateIds: perfiles.map((p) => p.id),
    },
  };
}

/**
 * Pide la consulta en vivo al HIS y devuelve los ids de las peticiones que la
 * pantalla debe sondear (`progresoDeConsultaHis`). No devuelve datos del HIS: eso
 * llega, ya sin documentos de terceros, al reabrir el expediente con esos ids.
 */
export async function iniciarConsultaHis(
  db: Db,
  actor: ActorRastreo,
  entrada: EntradaIniciarConsultaHis,
): Promise<Resultado<ConsultaHisIniciada>> {
  if (!actor.permisos.hisEnVivo || actorIncoherente(actor)) {
    return { success: false, error: SIN_PERMISOS };
  }
  if (entrada?.modo !== 'A' && entrada?.modo !== 'B') {
    return { success: false, error: 'Consulta inválida.' };
  }
  const motivo = validarMotivo(entrada.motivo, entrada.nota);
  if (!motivo.success) return motivo;

  const org = actor.organizationId;
  const ahora = new Date();

  // 1. Falla rápido: ¿puede contestar el agente ahora?
  const config = await db.hospitalMirrorConfig.findUnique({
    where: { organizationId: org },
    select: {
      enabled: true,
      lookupEnabled: true,
      lastLookupCapable: true,
      lastHeartbeatAt: true,
      lastHisReachable: true,
    },
  });
  const disponible = disponibilidadHis(config, ahora);
  if (!disponible.puede) {
    return {
      success: false,
      error: disponible.razon ?? 'La consulta en vivo no está disponible.',
    };
  }

  // 2. Qué se le va a preguntar al HIS, y sobre quién.
  const plan =
    entrada.modo === 'A'
      ? await planDeA(db, actor, entrada, ahora)
      : await planDeB(db, actor, entrada);
  if (!plan.success) return plan;
  if (plan.data.peticiones.length === 0) {
    return { success: false, error: MSG_NADA_QUE_CONSULTAR };
  }

  // 3. Topes: por usuario y por clínica.
  if (await superaElLimiteHis(db, actor, ahora)) {
    return { success: false, error: MSG_LIMITE_HIS };
  }
  const enCurso = await pendientesDeLaClinica(db, org, ahora);
  if (enCurso + plan.data.peticiones.length > LIMITES_CONSULTA_HIS.maxPendientesPorOrg) {
    return { success: false, error: MSG_HIS_OCUPADO };
  }

  // 4. Bitácora ANTES de preguntarle nada al hospital (falla cerrado).
  const registrada = await registrar(db, actor, {
    mode: entrada.modo,
    queryKind: 'LIVE_HIS',
    queryMasked: plan.data.consultaEnmascarada,
    reason: motivo.data.motivo,
    reasonNote: motivo.data.nota,
    candidateIds: plan.data.candidateIds,
    openedPatientId: plan.data.patientId,
    liveHisRequested: true,
  });
  if (!registrada) return { success: false, error: MSG_NO_REGISTRADA };

  try {
    const ids = await crearPeticiones(db, {
      organizationId: org,
      userId: actor.userId,
      patientId: plan.data.patientId,
      peticiones: plan.data.peticiones,
      ahora,
    });
    return {
      success: true,
      data: { ids, esperaMs: LIMITES_CONSULTA_HIS.esperaPantallaMs },
    };
  } catch (error) {
    console.error('HisLookupRequest: no se pudo crear la consulta', error);
    return { success: false, error: MSG_NO_INICIADA };
  }
}

/** Cómo va una consulta en curso. Solo la ve quien la pidió, en su clínica. */
export async function progresoDeConsultaHis(
  db: Db,
  actor: ActorRastreo,
  entrada: { ids: unknown },
): Promise<Resultado<ProgresoConsultaHis>> {
  if (!actor.permisos.hisEnVivo) return { success: false, error: SIN_PERMISOS };
  const ids = idsValidos(entrada?.ids);
  if (!ids) return { success: false, error: 'Consulta inválida.' };
  return {
    success: true,
    data: await progresoConsulta(db, {
      organizationId: actor.organizationId,
      userId: actor.userId,
      ids,
      ahora: new Date(),
      // El texto de error del agente puede llevar nombres de servidores del hospital.
      verDetalleTecnico: actor.permisos.verInternos,
    }),
  };
}
