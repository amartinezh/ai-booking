/**
 * ══════════════════════════════════════════════════════════════════════════
 * CONSULTA EN VIVO AL HIS (rastreo de paciente, Fase 2 — plan §7)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Lógica PURA que comparten los tres lados de la consulta:
 *
 *   · la web, que arma las peticiones y lee la respuesta;
 *   · la API, que valida lo que sube el agente y decide qué se guarda;
 *   · el agente, que se defiende de una petición mal formada antes de tocar el
 *     HIS.
 *
 * Vive aquí para que los límites y las reglas no puedan divergir entre ellos.
 *
 * ═══ Por qué la API guarda el documento de un tercero ENMASCARADO ═══
 * Preguntar "¿quién tiene este cupo?" devuelve el documento de quien lo tenga,
 * y muchas veces NO es el paciente que se investiga. Ese es un dato de salud de
 * otra persona que el funcionario no tiene por qué llegar a leer completo: al
 * recibir la respuesta, el servidor lo compara con el documento del paciente y
 * guarda solo el veredicto de la comparación (`TitularHis`) y el documento
 * enmascarado (`•••3456`). El documento completo de un tercero nunca queda en
 * la base ni viaja al navegador.
 */
import { documentoSinCerosIniciales } from './documento';
import { enmascararDocumento } from './patient-search';
import type {
  HisLookupAppointment,
  HisLookupRequestDto,
  HisLookupSlot,
  HisLookupStatus,
} from './mirror-protocol';

// ─────────────────────────────────────────────────────────────
// Límites — una sola fuente para web, API y agente
// ─────────────────────────────────────────────────────────────

export const LIMITES_CONSULTA_HIS = {
  /** Cupos por petición. Cada uno es una búsqueda por la PK del HIS: barata, pero no infinita. */
  maxCupos: 10,
  /** Filas que devuelve una petición. Más que eso es una lista, no un diagnóstico. */
  maxFilas: 50,
  /** Ventana máxima de una búsqueda por documento (la fecha es lo que el HIS tiene indexado). */
  ventanaDiasMax: 180,
  /** Cuánto espera la pantalla antes de rendirse. */
  esperaPantallaMs: 30_000,
  /**
   * Tiempo TOTAL que el agente le da al HIS para una petición. Pasado esto la
   * consulta se CANCELA en el servidor del hospital (no solo se deja de esperar:
   * una consulta que sigue corriendo es carga sobre una base productiva) y la
   * petición se reporta como error. Bien por debajo de `esperaPantallaMs`, para
   * que el error llegue a la pantalla antes de que ella se rinda.
   */
  timeoutHisMs: 10_000,
  /** Una petición sin respuesta pasado esto se da por EXPIRADA (con margen sobre la espera de pantalla). */
  expiraMs: 60_000,
  /** Cuánto viven `params` y `result`. Después solo quedan los metadatos. */
  purgaMs: 15 * 60_000,
  /**
   * Latido máximo tolerado para ENCOLAR una consulta. El agente late cada 60 s,
   * así que 3 minutos son tres latidos perdidos: casi seguro que no está.
   */
  latidoMaxMin: 3,
  /** Peticiones pendientes a la vez por organización: un tope contra abuso y contra un agente caído. */
  maxPendientesPorOrg: 5,
} as const;

const MS_DIA = 86_400_000;

// ─────────────────────────────────────────────────────────────
// Validación de una petición (defensa en profundidad en el agente y la API)
// ─────────────────────────────────────────────────────────────

const DOCUMENTO_RE = /^\d{4,15}$/;

/**
 * Devuelve el motivo por el que la petición no es válida, o `null` si lo es.
 *
 * El agente la corre ANTES de tocar el HIS aunque el servidor ya la haya
 * validado: un agente que ejecuta sin mirar lo que le mandan es un agente que
 * se puede usar para consultar cualquier cosa.
 */
export function validarConsultaHis(q: HisLookupRequestDto): string | null {
  if (!q || typeof q.requestId !== 'string' || !q.requestId) {
    return 'Falta el identificador de la petición.';
  }

  if (q.kind === 'BY_DOCUMENT') {
    const docs = q.patientDocuments;
    if (!Array.isArray(docs) || docs.length < 1 || docs.length > 2) {
      return 'Se espera uno o dos documentos.';
    }
    if (!docs.every((d) => typeof d === 'string' && DOCUMENTO_RE.test(d))) {
      return 'Un documento solo puede llevar de 4 a 15 dígitos.';
    }
    const desde = Date.parse(q.fromIso ?? '');
    const hasta = Date.parse(q.toIso ?? '');
    if (Number.isNaN(desde) || Number.isNaN(hasta) || desde >= hasta) {
      return 'La ventana de fechas no es válida.';
    }
    if ((hasta - desde) / MS_DIA > LIMITES_CONSULTA_HIS.ventanaDiasMax) {
      return `La ventana supera el máximo de ${LIMITES_CONSULTA_HIS.ventanaDiasMax} días.`;
    }
    return null;
  }

  if (q.kind === 'BY_SLOT') {
    const cupos = q.slots;
    if (
      !Array.isArray(cupos) ||
      cupos.length < 1 ||
      cupos.length > LIMITES_CONSULTA_HIS.maxCupos
    ) {
      return `Se esperan de 1 a ${LIMITES_CONSULTA_HIS.maxCupos} cupos.`;
    }
    for (const c of cupos) {
      if (
        !c ||
        typeof c.doctorExternalKey !== 'string' ||
        !c.doctorExternalKey.trim() ||
        c.doctorExternalKey.length > 32
      ) {
        return 'Un cupo no trae un médico válido.';
      }
      if (Number.isNaN(Date.parse(c.startTimeIso ?? ''))) {
        return 'Un cupo no trae una hora válida.';
      }
    }
    return null;
  }

  return 'Tipo de consulta desconocido.';
}

// ─────────────────────────────────────────────────────────────
// De quién es una cita del HIS
// ─────────────────────────────────────────────────────────────

/**
 * Cómo se relaciona el documento que tiene el HIS con el del paciente que se
 * investiga:
 *
 *  · `PACIENTE`        — el mismo.
 *  · `MISMO_CON_CEROS` — el mismo número, distinto solo en ceros a la izquierda
 *                        (Excel se los come): casi seguro la misma persona, mal
 *                        escrita en uno de los dos sistemas.
 *  · `OTRO`            — otro documento.
 *  · `SIN_DOCUMENTO`   — la fila del HIS no trae historia.
 */
export type TitularHis =
  | 'PACIENTE'
  | 'MISMO_CON_CEROS'
  | 'OTRO'
  | 'SIN_DOCUMENTO';

const soloDigitos = (s: string) => /^\d+$/.test(s);

/**
 * Compara el documento del HIS con los del paciente (el escrito y su variante
 * sin ceros). Un documento con letras (pasaporte) solo se compara por igualdad
 * exacta: quitarle "lo que no son dígitos" lo volvería igual al de otra persona.
 */
export function clasificarTitular(
  documentoHis: string | null | undefined,
  documentosPaciente: string[],
): TitularHis {
  const his = (documentoHis ?? '').trim();
  if (!his) return 'SIN_DOCUMENTO';

  const propios = documentosPaciente.map((d) => d.trim()).filter(Boolean);
  if (propios.includes(his)) return 'PACIENTE';

  if (soloDigitos(his)) {
    const hisSinCeros = documentoSinCerosIniciales(his);
    const mismoNumero = propios.some(
      (p) => soloDigitos(p) && documentoSinCerosIniciales(p) === hisSinCeros,
    );
    if (mismoNumero) return 'MISMO_CON_CEROS';
  }
  return 'OTRO';
}

// ─────────────────────────────────────────────────────────────
// Lo que se guarda y lo que se muestra de una cita del HIS
// ─────────────────────────────────────────────────────────────

export type EstadoCitaHis = HisLookupStatus;

/** Una cita del HIS tal como la conserva y la muestra AgenIA: sin el documento de terceros. */
export interface CitaHisVista {
  doctorExternalKey: string;
  startIso: string;
  serviceExternalKey: string | null;
  status: EstadoCitaHis;
  titular: TitularHis;
  /** `•••3456`. Solo cuando el titular NO es el paciente; nunca el documento completo. */
  documentoTercero: string | null;
}

/**
 * De una fila cruda del agente a lo que se guarda. Es la única función que ve
 * el documento de un tercero, y lo enmascara aquí mismo.
 */
export function aCitaHisVista(
  fila: HisLookupAppointment,
  documentosPaciente: string[],
): CitaHisVista {
  const titular = clasificarTitular(fila.patientDocument, documentosPaciente);
  return {
    doctorExternalKey: fila.doctorExternalKey,
    startIso: new Date(fila.startTimeIso).toISOString(),
    serviceExternalKey: fila.serviceExternalKey ?? null,
    status: fila.status,
    titular,
    documentoTercero:
      titular === 'PACIENTE' || titular === 'SIN_DOCUMENTO'
        ? null
        : enmascararDocumento(fila.patientDocument),
  };
}

/** Lo que devolvió la consulta en vivo, ya listo para el clasificador. */
export interface EvidenciaHis {
  consultadoIso: string;
  /** Las citas del paciente en el HIS dentro de la ventana. `null` = no se preguntó por documento. */
  porDocumento: {
    desdeIso: string;
    hastaIso: string;
    citas: CitaHisVista[];
    truncado: boolean;
  } | null;
  /**
   * Por cada cupo consultado, lo que el HIS tiene ahí.
   *
   * ⚠️ `filas` vacío NO significa siempre "no hay nadie": si `incompleto` es `true`,
   * el hospital devolvió algo que no se pudo leer —típicamente una cita cuya hora
   * guardó en un formato que no cumple `'YYYY/MM/DD HH:MM'` (`MAPEO_HIS.md` §2.1)— y
   * entonces la ausencia NO se puede afirmar. Medido en el hospital el 2026-09-20.
   */
  cupos: {
    doctorExternalKey: string;
    startIso: string;
    filas: CitaHisVista[];
    incompleto: boolean;
  }[];
}

/** Quién ocupa un cupo en el HIS. */
export type OcupanteCupo =
  | { tipo: 'NADIE' }
  | { tipo: 'PACIENTE'; estado: EstadoCitaHis }
  | {
      tipo: 'OTRA_PERSONA';
      estado: EstadoCitaHis;
      /** Enmascarado; `null` si la fila del HIS no trae documento. */
      documentoTercero: string | null;
      mismoConCeros: boolean;
    };

/**
 * Decide quién ocupa el cupo a partir de las filas del HIS.
 *
 * El HIS puede tener más de una fila por médico+hora: la PK incluye el estado,
 * así que una cita atendida y otra vigente para la misma hora conviven. La fila
 * VIGENTE manda (es la única sobre la que se puede actuar); si no hay ninguna,
 * cuenta una atendida o una inasistencia (la cita existió). Las de estado
 * desconocido no cuentan: sin saber qué son, no se afirma que alguien ocupe el
 * cupo.
 */
export function ocupanteDelCupo(filas: CitaHisVista[]): OcupanteCupo {
  const vigentes = filas.filter((f) => f.status === 'SCHEDULED');
  const historicas = filas.filter(
    (f) => f.status === 'ATTENDED' || f.status === 'NO_SHOW',
  );
  const candidatas = vigentes.length > 0 ? vigentes : historicas;
  if (candidatas.length === 0) return { tipo: 'NADIE' };

  // Si el paciente está entre las candidatas, ese es el ocupante.
  const suya = candidatas.find((f) => f.titular === 'PACIENTE');
  if (suya) return { tipo: 'PACIENTE', estado: suya.status };

  const otra = candidatas[0];
  return {
    tipo: 'OTRA_PERSONA',
    estado: otra.status,
    documentoTercero: otra.documentoTercero,
    mismoConCeros: otra.titular === 'MISMO_CON_CEROS',
  };
}

const MS_MINUTO = 60_000;

/**
 * ¿Es el mismo cupo? Compara instantes AL MINUTO, no cadenas (`Z` y `+00:00` son lo
 * mismo) ni milisegundos.
 *
 * El HIS guarda la hora como texto `'YYYY/MM/DD HH:mm'`: no tiene segundos. Un cupo de
 * AgenIA sí puede traerlos (una hora calculada, no digitada). Comparados al
 * milisegundo, la fila del HIS de ese mismo cupo NO casaba con él, se descartaba y
 * el resultado era un falso "el HIS no la tiene" — el diagnóstico equivocado que esta
 * pantalla existe para evitar. Dos cupos distintos nunca caen en el mismo minuto.
 */
export function mismoInstante(aIso: string, bIso: string): boolean {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.floor(a / MS_MINUTO) === Math.floor(b / MS_MINUTO);
}

// ─────────────────────────────────────────────────────────────
// Lo que la web pide, lo que el servidor guarda y lo que se lee después
// ─────────────────────────────────────────────────────────────

/** `HisLookupRequest.params` de una petición por documento. */
export interface ParamsConsultaPorDocumento {
  patientDocuments: string[];
  fromIso: string;
  toIso: string;
}

/**
 * `HisLookupRequest.params` de una petición por cupo. `compareDocuments` (el
 * documento del paciente y su variante sin ceros) NO viaja al agente: solo lo
 * usa el servidor para saber, al recibir la respuesta, de quién es cada fila.
 */
export interface ParamsConsultaPorCupo {
  slots: HisLookupSlot[];
  compareDocuments: string[];
}

/** `HisLookupRequest.result`: lo que se conserva de la respuesta del HIS, sin documentos de terceros. */
export type ResultadoConsultaHis =
  | {
      kind: 'BY_DOCUMENT';
      desdeIso: string;
      hastaIso: string;
      citas: CitaHisVista[];
      truncado: boolean;
    }
  | {
      kind: 'BY_SLOT';
      cupos: {
        doctorExternalKey: string;
        startIso: string;
        filas: CitaHisVista[];
        /**
         * Filas que el HIS tiene en ese médico y ese día con una hora que no se puede
         * interpretar. `> 0` ⇒ un cupo vacío NO autoriza a decir «no hay nada».
         */
        ilegibles: number;
      }[];
      /**
       * El agente no pudo entregar entera la respuesta de esta consulta: recortó por
       * el tope de filas, o había filas ilegibles (una hora que no cumple el formato).
       * ANTES se descartaba aquí, y una cita con la hora ilegible se volvía un
       * "el HIS no tiene nada en ese cupo" — un falso negativo.
       */
      truncado: boolean;
    };

const ESTADOS_HIS: ReadonlySet<string> = new Set([
  'SCHEDULED',
  'ATTENDED',
  'NO_SHOW',
  'OTHER',
]);
const TITULARES: ReadonlySet<string> = new Set([
  'PACIENTE',
  'MISMO_CON_CEROS',
  'OTRO',
  'SIN_DOCUMENTO',
]);
/** Filas que se conservan por cupo: la PK del HIS admite pocas por médico y hora. */
const MAX_FILAS_POR_CUPO = 5;

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * De lo guardado en `params` a lo que se le manda al agente, o `null` si no es
 * una petición válida. Para `BY_SLOT` quita `compareDocuments`: el agente no
 * necesita saber a quién se busca.
 */
export function parametrosADto(
  requestId: string,
  kind: string,
  params: unknown,
): HisLookupRequestDto | null {
  if (!esObjeto(params)) return null;
  let dto: HisLookupRequestDto;
  if (kind === 'BY_DOCUMENT') {
    dto = {
      requestId,
      kind,
      patientDocuments: params.patientDocuments as string[],
      fromIso: params.fromIso as string,
      toIso: params.toIso as string,
    };
  } else if (kind === 'BY_SLOT') {
    dto = { requestId, kind, slots: params.slots as HisLookupSlot[] };
  } else {
    return null;
  }
  return validarConsultaHis(dto) === null ? dto : null;
}

/** Las filas del agente que tienen la forma mínima para mirarlas; las demás se descartan. */
function filasLegibles(crudo: unknown): HisLookupAppointment[] {
  if (!Array.isArray(crudo)) return [];
  const salida: HisLookupAppointment[] = [];
  for (const a of crudo) {
    if (!esObjeto(a)) continue;
    if (typeof a.doctorExternalKey !== 'string' || !a.doctorExternalKey) continue;
    if (typeof a.startTimeIso !== 'string' || Number.isNaN(Date.parse(a.startTimeIso))) continue;
    salida.push({
      doctorExternalKey: a.doctorExternalKey,
      startTimeIso: a.startTimeIso,
      serviceExternalKey:
        typeof a.serviceExternalKey === 'string' ? a.serviceExternalKey : undefined,
      patientDocument:
        typeof a.patientDocument === 'string' ? a.patientDocument : null,
      status: ESTADOS_HIS.has(a.status as string)
        ? (a.status as HisLookupStatus)
        : 'OTHER',
    });
  }
  return salida;
}

/**
 * Convierte la respuesta del agente en lo que se guarda. Es donde se aplican las
 * defensas del servidor, sin fiarse de que el agente hizo bien su parte:
 *
 *  · el documento de un TERCERO se enmascara (`aCitaHisVista`);
 *  · lo que no se preguntó se descarta: en `BY_SLOT`, filas de cupos que nadie
 *    pidió; en `BY_DOCUMENT`, filas de otro documento;
 *  · los topes se aplican aquí también, y un recorte se declara (`truncado`).
 *
 * `null` si `params` no es una petición válida.
 */
/**
 * Lee los `unreadableSlots` que reportó el agente y devuelve un buscador por
 * médico+hora. Tolerante: lo que no tenga forma se ignora (viene de la red).
 */
function lectorDeIlegibles(
  crudo: unknown,
): (doctorExternalKey: string, startTimeIso: string) => number {
  const filas = (Array.isArray(crudo) ? crudo : []).filter(esObjeto);
  // Una sola pasada de validación, donde se usa el dato: una clave que no sea la
  // cadena exacta no puede casar, una hora ilegible no pasa `mismoInstante` y un
  // recuento que no sea un número positivo no cuenta.
  return (doctorExternalKey, startTimeIso) =>
    filas
      .filter(
        (c) =>
          c.doctorExternalKey === doctorExternalKey &&
          typeof c.startTimeIso === 'string' &&
          mismoInstante(c.startTimeIso, startTimeIso) &&
          typeof c.count === 'number' &&
          c.count > 0,
      )
      .reduce((total, c) => total + Math.floor(c.count as number), 0);
}

export function resolverRespuestaHis(
  kind: string,
  params: unknown,
  respuestaCruda: unknown,
  truncadaPorElAgente = false,
  cuposIlegibles: unknown = null,
): ResultadoConsultaHis | null {
  if (!esObjeto(params)) return null;
  const filas = filasLegibles(respuestaCruda);

  if (kind === 'BY_DOCUMENT') {
    const dto = parametrosADto('x', 'BY_DOCUMENT', params);
    if (!dto) return null;
    const docs = dto.patientDocuments!;
    const citas = filas
      .map((f) => aCitaHisVista(f, docs))
      // Una fila de otro documento en una búsqueda por documento es un defecto del
      // agente: no se guarda, y menos aún de un tercero.
      .filter((c) => c.titular === 'PACIENTE' || c.titular === 'MISMO_CON_CEROS')
      .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
    return {
      kind: 'BY_DOCUMENT',
      desdeIso: new Date(dto.fromIso!).toISOString(),
      hastaIso: new Date(dto.toIso!).toISOString(),
      citas: citas.slice(0, LIMITES_CONSULTA_HIS.maxFilas),
      truncado:
        truncadaPorElAgente || citas.length > LIMITES_CONSULTA_HIS.maxFilas,
    };
  }

  if (kind === 'BY_SLOT') {
    const dto = parametrosADto('x', 'BY_SLOT', params);
    if (!dto) return null;
    const ilegiblesDe = lectorDeIlegibles(cuposIlegibles);
    const comparar = Array.isArray(params.compareDocuments)
      ? (params.compareDocuments as unknown[]).filter(
          (d): d is string => typeof d === 'string',
        )
      : [];
    return {
      kind: 'BY_SLOT',
      cupos: dto.slots!.map((s) => ({
        doctorExternalKey: s.doctorExternalKey,
        startIso: new Date(s.startTimeIso).toISOString(),
        filas: filas
          .filter(
            (f) =>
              f.doctorExternalKey === s.doctorExternalKey &&
              mismoInstante(f.startTimeIso, s.startTimeIso),
          )
          .slice(0, MAX_FILAS_POR_CUPO)
          .map((f) => aCitaHisVista(f, comparar)),
        ilegibles: ilegiblesDe(s.doctorExternalKey, s.startTimeIso),
      })),
      truncado: truncadaPorElAgente,
    };
  }

  return null;
}

function citaGuardadaValida(c: unknown): CitaHisVista | null {
  if (!esObjeto(c)) return null;
  if (typeof c.doctorExternalKey !== 'string' || typeof c.startIso !== 'string') return null;
  if (Number.isNaN(Date.parse(c.startIso))) return null;
  if (!ESTADOS_HIS.has(c.status as string) || !TITULARES.has(c.titular as string)) return null;
  return {
    doctorExternalKey: c.doctorExternalKey,
    startIso: c.startIso,
    serviceExternalKey:
      typeof c.serviceExternalKey === 'string' ? c.serviceExternalKey : null,
    status: c.status as EstadoCitaHis,
    titular: c.titular as TitularHis,
    documentoTercero:
      typeof c.documentoTercero === 'string' ? c.documentoTercero : null,
  };
}

/**
 * Lee un `HisLookupRequest.result` que salió de la base. Tolerante a lo que
 * venga (es un campo Json libre): devuelve `null` si no tiene la forma, y descarta
 * las filas mal formadas en vez de romper la pantalla.
 */
export function leerResultadoGuardado(json: unknown): ResultadoConsultaHis | null {
  if (!esObjeto(json)) return null;
  const lista = (v: unknown): CitaHisVista[] =>
    (Array.isArray(v) ? v : [])
      .map(citaGuardadaValida)
      .filter((c): c is CitaHisVista => c !== null);

  if (json.kind === 'BY_DOCUMENT') {
    if (typeof json.desdeIso !== 'string' || typeof json.hastaIso !== 'string') return null;
    return {
      kind: 'BY_DOCUMENT',
      desdeIso: json.desdeIso,
      hastaIso: json.hastaIso,
      citas: lista(json.citas),
      truncado: json.truncado === true,
    };
  }
  if (json.kind === 'BY_SLOT' && Array.isArray(json.cupos)) {
    const cupos = json.cupos
      .filter(esObjeto)
      .filter(
        (c) => typeof c.doctorExternalKey === 'string' && typeof c.startIso === 'string',
      )
      .map((c) => ({
        doctorExternalKey: c.doctorExternalKey as string,
        startIso: c.startIso as string,
        filas: lista(c.filas),
        ilegibles: typeof c.ilegibles === 'number' && c.ilegibles > 0 ? c.ilegibles : 0,
      }));
    return { kind: 'BY_SLOT', cupos, truncado: json.truncado === true };
  }
  return null;
}

/** Junta los resultados de una consulta (por documento y/o por cupo) en la evidencia del clasificador. */
export function combinarEvidenciaHis(
  resultados: ResultadoConsultaHis[],
  consultadoIso: string,
): EvidenciaHis {
  const porDoc = resultados.find(
    (r): r is Extract<ResultadoConsultaHis, { kind: 'BY_DOCUMENT' }> =>
      r.kind === 'BY_DOCUMENT',
  );
  return {
    consultadoIso,
    porDocumento: porDoc
      ? {
          desdeIso: porDoc.desdeIso,
          hastaIso: porDoc.hastaIso,
          citas: porDoc.citas,
          truncado: porDoc.truncado,
        }
      : null,
    cupos: resultados.flatMap((r) =>
      r.kind === 'BY_SLOT'
        ? r.cupos.map((c) => ({ ...c, incompleto: r.truncado || c.ilegibles > 0 }))
        : [],
    ),
  };
}
