/**
 * Consulta en vivo al HIS desde el rastreo de paciente (Fase 2,
 * docs/PLAN_RASTREO_PACIENTE.md §7): qué se le pregunta al hospital, si el agente
 * puede contestar ahora, y cómo se leen las respuestas.
 *
 * ═══ Por qué esto NO importa `servicio.ts` ═══
 * `servicio.ts` importa este archivo (para leer lo que respondió el HIS al armar un
 * expediente). El orquestador que INICIA la consulta —que sí necesita el motivo, la
 * bitácora y el límite de tasa de `servicio.ts`— vive aparte, en `servicio-his.ts`.
 * Así no hay un ciclo de importaciones.
 *
 * ═══ Qué garantiza ═══
 *  · Una consulta cuesta lo que el hospital pueda soportar: la ventana por documento
 *    es acotada y el número de cupos también (`LIMITES_CONSULTA_HIS`).
 *  · Nadie lee una consulta ajena: cada lectura exige la MISMA clínica y el MISMO
 *    usuario que la pidió, y que trate del mismo documento.
 *  · Falla rápido y en claro: si el agente no puede contestar, se dice antes de
 *    encolar (no después de 30 s de espera).
 *  · Los datos viven poco: lo que se lee ya lo dejó el servidor sin documentos de
 *    terceros, y `params`/`result` se purgan a los 15 min.
 */
import { Prisma, type PrismaClient } from '@agenia/database';
import {
  LIMITES_CONSULTA_HIS,
  VENTANA_CITAS_DIAS,
  combinarEvidenciaHis,
  documentoSinCerosIniciales,
  esDocumentoValido,
  leerResultadoGuardado,
  validarConsultaHis,
  type EvidenciaHis,
  type HisLookupKind,
  type ParamsConsultaPorCupo,
  type ParamsConsultaPorDocumento,
  type ResultadoConsultaHis,
} from '@agenia/shared';
import type {
  CitaHisMostrada,
  ConsultaHisVista,
  DisponibilidadHis,
  ProgresoConsultaHis,
} from './tipos';

type Db = PrismaClient;

const MS_DIA = 86_400_000;

// ─────────────────────────────────────────────────────────────
// ¿Se puede consultar ahora?
// ─────────────────────────────────────────────────────────────

export interface ConfigHis {
  enabled: boolean;
  lookupEnabled: boolean;
  lastLookupCapable: boolean | null;
  lastHeartbeatAt: Date | null;
  lastHisReachable: boolean | null;
}

/**
 * Falla RÁPIDO (plan §7.2): si el agente no puede contestar, lo dice antes de
 * encolar. El orden va de lo que se arregla en la clínica a lo que se arregla en
 * el hospital; cada motivo está escrito para quien atiende, sin nombres internos.
 */
export function disponibilidadHis(
  config: ConfigHis | null,
  ahora: Date,
): DisponibilidadHis {
  const no = (razon: string): DisponibilidadHis => ({ puede: false, razon });
  if (!config) return no('Esta clínica no tiene espejo con un HIS.');
  if (!config.enabled) {
    return no('El espejo con el HIS está deshabilitado en esta clínica.');
  }
  if (!config.lookupEnabled) {
    return no('La consulta en vivo al HIS no está habilitada para esta clínica.');
  }
  if (!config.lastHeartbeatAt) {
    return no('El agente del hospital no ha dado señales.');
  }
  const minutos = Math.floor(
    (ahora.getTime() - config.lastHeartbeatAt.getTime()) / 60_000,
  );
  if (minutos > LIMITES_CONSULTA_HIS.latidoMaxMin) {
    return no(`El agente del hospital no da señales desde hace ${minutos} min.`);
  }
  if (config.lastHisReachable === false) {
    return no(
      'El agente no puede comunicarse con el sistema del hospital en este momento.',
    );
  }
  // `null` (un agente anterior a la consulta en vivo, que no lo dice) cuenta como "no".
  if (config.lastLookupCapable !== true) {
    return no(
      'El agente instalado en el hospital no admite la consulta en vivo (puede estar desactualizado).',
    );
  }
  return { puede: true, razon: null };
}

// ─────────────────────────────────────────────────────────────
// Qué se le pregunta al HIS
// ─────────────────────────────────────────────────────────────

/** Una petición ya planeada, lista para guardarse. */
export interface Peticion {
  kind: HisLookupKind;
  params: ParamsConsultaPorDocumento | ParamsConsultaPorCupo;
}

/** Lo mínimo de una cita de AgenIA que hace falta para decidir qué preguntar. */
export interface CitaParaConsulta {
  startIso: string;
  status: string;
  origin: string;
  /** Clave del médico en el HIS; `null` = no homologado, no se puede buscar su cupo. */
  doctorExternalKey: string | null;
}

/** El documento tal cual y, si difiere, sin ceros a la izquierda (lo que el HIS puede tener). */
export function documentosDelPaciente(cedula: string): string[] {
  const propio = cedula.trim();
  if (!propio) return [];
  return [...new Set([propio, documentoSinCerosIniciales(propio)])].filter(Boolean);
}

/**
 * Ventana de la búsqueda por documento (A): cubre las citas relevantes de AgenIA y,
 * como mínimo, de la última semana a los próximos dos meses. Acotada al máximo que
 * el HIS tolera: la fecha es lo único indexado allá, y cada día de más son miles de
 * filas que el hospital recorre.
 */
export function ventanaPorDocumento(
  inicios: string[],
  ahora: Date,
): { desde: Date; hasta: Date } {
  let desde = ahora.getTime() - 7 * MS_DIA;
  let hasta = ahora.getTime() + 60 * MS_DIA;
  for (const iso of inicios) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    desde = Math.min(desde, t - MS_DIA);
    hasta = Math.max(hasta, t + MS_DIA);
  }
  hasta = Math.min(hasta, desde + LIMITES_CONSULTA_HIS.ventanaDiasMax * MS_DIA);
  return { desde: new Date(desde), hasta: new Date(hasta) };
}

function porDocumento(
  documentos: string[],
  desde: Date,
  hasta: Date,
): Peticion | null {
  const validos = documentos.filter(esDocumentoValido);
  if (validos.length === 0) return null;
  const params: ParamsConsultaPorDocumento = {
    patientDocuments: validos,
    fromIso: desde.toISOString(),
    toIso: hasta.toISOString(),
  };
  // Lo que se guarda tiene que pasar la misma validación que el agente aplicará.
  const invalida = validarConsultaHis({
    requestId: 'plan',
    kind: 'BY_DOCUMENT',
    ...params,
  });
  return invalida ? null : { kind: 'BY_DOCUMENT', params };
}

function porCupos(
  cupos: { doctorExternalKey: string; startTimeIso: string }[],
  documentos: string[],
): Peticion | null {
  if (cupos.length === 0) return null;
  const params: ParamsConsultaPorCupo = {
    slots: cupos.slice(0, LIMITES_CONSULTA_HIS.maxCupos),
    compareDocuments: documentos,
  };
  const invalida = validarConsultaHis({
    requestId: 'plan',
    kind: 'BY_SLOT',
    slots: params.slots,
  });
  return invalida ? null : { kind: 'BY_SLOT', params };
}

/**
 * Escenario A ("dice que agendó"): un cupo por cada cita VIGENTE que AgenIA creó
 * (las que nacieron en el HIS ya vienen de allá) y un médico homologado tenga, las
 * más cercanas a hoy; y, si el rol lo permite, las citas del paciente por documento.
 *
 * `incluirPorDocumento` es `false` para un BOOKING_AGENT acotado a una EPS o un
 * médico: la lista completa del paciente en el HIS mostraría citas que su alcance
 * en AgenIA le oculta.
 */
export function planDeConsultaA(entrada: {
  citas: CitaParaConsulta[];
  documentos: string[];
  ahora: Date;
  incluirPorDocumento: boolean;
}): Peticion[] {
  const { citas, documentos, ahora } = entrada;
  const desdeRelevante = ahora.getTime() - VENTANA_CITAS_DIAS * MS_DIA;
  const relevantes = citas.filter((c) => Date.parse(c.startIso) >= desdeRelevante);

  const vistos = new Set<string>();
  const cupos = relevantes
    .filter(
      (c) =>
        c.status === 'SCHEDULED' && c.origin !== 'MIRROR' && !!c.doctorExternalKey,
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.startIso) - ahora.getTime()) -
        Math.abs(Date.parse(b.startIso) - ahora.getTime()),
    )
    .flatMap((c) => {
      const inicio = new Date(c.startIso).toISOString();
      const clave = `${c.doctorExternalKey}|${inicio}`;
      if (vistos.has(clave)) return [];
      vistos.add(clave);
      return [{ doctorExternalKey: c.doctorExternalKey!, startTimeIso: inicio }];
    });

  const { desde, hasta } = ventanaPorDocumento(
    relevantes.map((c) => c.startIso),
    ahora,
  );
  return [
    entrada.incluirPorDocumento ? porDocumento(documentos, desde, hasta) : null,
    porCupos(cupos, documentos),
  ].filter((p): p is Peticion => p !== null);
}

/**
 * Escenario B ("la agendaron en el HIS"): el cupo exacto —quién lo ocupa— y, si el
 * rol lo permite, las citas del documento en la semana alrededor (por si quedó en
 * otra hora o con otro médico).
 */
export function planDeConsultaB(entrada: {
  medicoClave: string;
  inicio: Date;
  documentos: string[];
  incluirPorDocumento: boolean;
}): Peticion[] {
  const { inicio, documentos } = entrada;
  return [
    entrada.incluirPorDocumento
      ? porDocumento(
          documentos,
          new Date(inicio.getTime() - 7 * MS_DIA),
          new Date(inicio.getTime() + 7 * MS_DIA),
        )
      : null,
    porCupos(
      [
        {
          doctorExternalKey: entrada.medicoClave,
          startTimeIso: inicio.toISOString(),
        },
      ],
      documentos,
    ),
  ].filter((p): p is Peticion => p !== null);
}

// ─────────────────────────────────────────────────────────────
// Crear y sondear peticiones
// ─────────────────────────────────────────────────────────────

/** Cuántas hay en la cola de la clínica esperando al agente. */
export async function pendientesDeLaClinica(
  db: Db,
  organizationId: string,
  ahora: Date,
): Promise<number> {
  return db.hisLookupRequest.count({
    where: {
      organizationId,
      status: 'PENDIENTE',
      createdAt: { gte: new Date(ahora.getTime() - LIMITES_CONSULTA_HIS.expiraMs) },
    },
  });
}

/** Guarda las peticiones y devuelve sus ids. `purgeAt` marca cuándo se borran los datos. */
export async function crearPeticiones(
  db: Db,
  datos: {
    organizationId: string;
    userId: string;
    patientId: string | null;
    peticiones: Peticion[];
    ahora: Date;
  },
): Promise<string[]> {
  const purgeAt = new Date(datos.ahora.getTime() + LIMITES_CONSULTA_HIS.purgaMs);
  const filas = await db.$transaction(
    datos.peticiones.map((p) =>
      db.hisLookupRequest.create({
        data: {
          organizationId: datos.organizationId,
          requestedByUserId: datos.userId,
          kind: p.kind,
          params: p.params as unknown as Prisma.InputJsonValue,
          patientId: datos.patientId,
          purgeAt,
        },
        select: { id: true },
      }),
    ),
  );
  return filas.map((f) => f.id);
}

const MAX_IDS = 4;

/** Los ids que llegan del cliente: pocos, cortos y sin repetir. `null` si no son válidos. */
export function idsValidos(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  if (!ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 64)) {
    return null;
  }
  return [...new Set(ids as string[])];
}

const MSG_GENERICO_ERROR = 'El hospital no respondió a la consulta.';
const MSG_EXPIRADA = 'El agente del hospital no contestó a tiempo.';

/** Qué búsqueda falló, para decirlo cuando el resultado quedó parcial. */
const NOMBRE_BUSQUEDA: Record<string, string> = {
  BY_DOCUMENT: 'la búsqueda de las citas del paciente',
  BY_SLOT: 'la consulta de los cupos',
};

/**
 * Cómo va una consulta. Solo lee las peticiones de ESTA clínica y de ESTE usuario.
 *
 * `LISTA` cuando ya nada está en curso y al menos una respuesta llegó; si otra
 * falló, `detalle` lo dice (un resultado parcial no se presenta como completo).
 * `verDetalleTecnico` decide si quien pregunta ve el texto de error del agente o
 * solo una frase genérica: ese texto puede llevar nombres de servidores internos.
 */
export async function progresoConsulta(
  db: Db,
  entrada: {
    organizationId: string;
    userId: string;
    ids: string[];
    ahora: Date;
    verDetalleTecnico: boolean;
  },
): Promise<ProgresoConsultaHis> {
  const filas = await db.hisLookupRequest.findMany({
    where: {
      id: { in: entrada.ids },
      organizationId: entrada.organizationId,
      requestedByUserId: entrada.userId,
    },
    select: { kind: true, status: true, error: true, createdAt: true },
  });
  if (filas.length !== entrada.ids.length) {
    return { estado: 'FALLIDA', detalle: 'No se encontró la consulta.' };
  }

  const vencida = (f: (typeof filas)[number]) =>
    f.status === 'PENDIENTE' &&
    entrada.ahora.getTime() - f.createdAt.getTime() > LIMITES_CONSULTA_HIS.expiraMs;
  const estado = (f: (typeof filas)[number]) => (vencida(f) ? 'EXPIRADA' : f.status);

  if (filas.some((f) => estado(f) === 'PENDIENTE')) {
    return { estado: 'EN_CURSO', detalle: null };
  }

  const fallos = filas.filter((f) => estado(f) !== 'RESUELTA');
  const motivo = (f: (typeof filas)[number]) =>
    estado(f) === 'EXPIRADA'
      ? MSG_EXPIRADA
      : entrada.verDetalleTecnico && f.error
        ? f.error
        : MSG_GENERICO_ERROR;

  if (fallos.length === filas.length) {
    return { estado: 'FALLIDA', detalle: motivo(fallos[0]) };
  }
  if (fallos.length > 0) {
    const cuales = fallos
      .map((f) => NOMBRE_BUSQUEDA[f.kind] ?? 'una de las búsquedas')
      .join(' y ');
    return {
      estado: 'LISTA',
      detalle: `No se completó ${cuales}: ${motivo(fallos[0])} El resultado es parcial.`,
    };
  }
  return { estado: 'LISTA', detalle: null };
}

// ─────────────────────────────────────────────────────────────
// Leer lo que respondió el HIS
// ─────────────────────────────────────────────────────────────

const claveDocumentos = (docs: string[]) =>
  [...new Set(docs.map((d) => d.trim()).filter(Boolean))].sort().join('|');

/** Los documentos por los que se preguntó (o con los que se comparó), de un `params` guardado. */
function documentosDeParams(params: unknown): string[] {
  if (typeof params !== 'object' || params === null) return [];
  const p = params as Record<string, unknown>;
  const lista = Array.isArray(p.patientDocuments)
    ? p.patientDocuments
    : Array.isArray(p.compareDocuments)
      ? p.compareDocuments
      : [];
  return lista.filter((d): d is string => typeof d === 'string');
}

/**
 * Lo que el HIS respondió, listo para el clasificador.
 *
 * Un `id` solo cuenta si la petición es de esta clínica, la pidió este usuario,
 * está resuelta, no se purgó, y trata del MISMO documento que el expediente que se
 * está armando. Cualquier otra cosa se ignora sin decir por qué: no es un oráculo.
 */
export async function cargarEvidenciaHis(
  db: Db,
  entrada: {
    organizationId: string;
    userId: string;
    ids: unknown;
    /** Los documentos del paciente consultado. */
    documentos: string[];
  },
): Promise<EvidenciaHis | null> {
  const ids = idsValidos(entrada.ids);
  if (!ids) return null;

  const filas = await db.hisLookupRequest.findMany({
    where: {
      id: { in: ids },
      organizationId: entrada.organizationId,
      requestedByUserId: entrada.userId,
      status: 'RESUELTA',
      purgedAt: null,
    },
    select: { params: true, result: true, resolvedAt: true },
  });

  const esperado = claveDocumentos(entrada.documentos);
  const propias = filas.filter(
    (f) => claveDocumentos(documentosDeParams(f.params)) === esperado,
  );

  const resultados = propias
    .map((f) => leerResultadoGuardado(f.result))
    .filter((r): r is ResultadoConsultaHis => r !== null);
  if (resultados.length === 0) return null;

  // La constancia es la del dato MÁS VIEJO: es lo que se puede afirmar de todo el conjunto.
  const tiempos = propias
    .map((f) => f.resolvedAt?.getTime())
    .filter((t): t is number => typeof t === 'number');
  const consultado = tiempos.length > 0 ? Math.min(...tiempos) : Date.now();
  return combinarEvidenciaHis(resultados, new Date(consultado).toISOString());
}

/** Etiqueta del médico del HIS: su nombre si se conoce; si no, la clave. */
export type EtiquetaMedicoHis = (clave: string) => string;

/** La evidencia, como se le muestra a quien atiende (sin documentos, con médicos por nombre). */
export function vistaDeConsulta(
  evidencia: EvidenciaHis,
  etiqueta: EtiquetaMedicoHis,
): ConsultaHisVista {
  const doc = evidencia.porDocumento;
  const citas: CitaHisMostrada[] = doc
    ? doc.citas.map((c) => ({
        startIso: c.startIso,
        medico: etiqueta(c.doctorExternalKey),
        estado: c.status,
      }))
    : [];
  return {
    consultadoIso: evidencia.consultadoIso,
    porDocumento: doc
      ? {
          desdeIso: doc.desdeIso,
          hastaIso: doc.hastaIso,
          citas,
          truncado: doc.truncado,
        }
      : null,
    cuposConsultados: evidencia.cupos.length,
    cuposIncompletos: evidencia.cupos.filter((c) => c.incompleto).length,
  };
}

/**
 * Nombre de cada médico del HIS: el de AgenIA si está homologado, si no la etiqueta
 * del catálogo del hospital, si no la clave. Una sola lectura por lote.
 */
export async function etiquetasDeMedicosHis(
  db: Db,
  organizationId: string,
  claves: string[],
  etiquetaDePerfil: (p: { fullName: string; isFunctionalAgenda: boolean }) => string,
): Promise<EtiquetaMedicoHis> {
  const unicas = [...new Set(claves)];
  if (unicas.length === 0) return (c) => c;

  const [mapas, catalogo] = await Promise.all([
    db.mirrorEntityMap.findMany({
      where: { organizationId, entityType: 'DOCTOR', externalKey: { in: unicas } },
      select: { agenIAId: true, externalKey: true, externalLabel: true },
    }),
    db.mirrorCatalogEntry.findMany({
      where: { organizationId, entityType: 'DOCTOR', externalKey: { in: unicas } },
      select: { externalKey: true, label: true },
    }),
  ]);
  const perfiles = await db.doctorProfile.findMany({
    where: { organizationId, id: { in: mapas.map((m) => m.agenIAId) } },
    select: { id: true, fullName: true, isFunctionalAgenda: true },
  });
  const perfilPorId = new Map(perfiles.map((p) => [p.id, p]));

  const etiquetas = new Map<string, string>();
  for (const c of catalogo) etiquetas.set(c.externalKey, c.label);
  for (const m of mapas) {
    const perfil = perfilPorId.get(m.agenIAId);
    if (perfil) etiquetas.set(m.externalKey, etiquetaDePerfil(perfil));
    else if (m.externalLabel) etiquetas.set(m.externalKey, m.externalLabel);
  }
  return (clave) => etiquetas.get(clave) ?? `Médico ${clave} del HIS`;
}
