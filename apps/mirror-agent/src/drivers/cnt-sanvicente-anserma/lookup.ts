import * as sql from 'mssql';
import { LIMITES_CONSULTA_HIS, validarConsultaHis } from '@agenia/shared';
import type {
  HisLookupAppointment,
  HisLookupRequestDto,
  HisLookupStatus,
} from '@agenia/shared';
import {
  diaSiguienteLiteralSql,
  feHoraCitAIsoOrNull,
  fechaCitaLocal,
  fechaLiteralSql,
  formatFeHoraCit,
} from './mapping';

/**
 * Consulta en vivo al HIS (rastreo de paciente, Fase 2) — driver de Anserma.
 * Ver docs/PLAN_RASTREO_PACIENTE.md §7 y
 * docs/drivers/cnt-sanvicente-anserma/CONSULTA_EN_VIVO.md.
 *
 * ═══ Qué es y qué NO es ═══
 * Dos preguntas, ambas SOLO LECTURA sobre `CITAS_MEDICAS` y ambas con un
 * funcionario mirando la pantalla:
 *
 *   · `BY_SLOT` — "¿qué hay en el HIS en este médico y esta hora?". La PK de
 *     `CITAS_MEDICAS` es (médico, hora, estado): igualar médico y hora es una
 *     búsqueda por prefijo de la clave, la consulta más barata que tiene este
 *     driver. No lleva el documento del paciente: el servidor compara.
 *   · `BY_DOCUMENT` — "¿qué citas tiene este documento?". NO es barata: el único
 *     índice del hospital útil aquí empieza por `FE_FECH_CIT`, así que se lee un
 *     rango de fechas y se filtra por historia. De ahí la ventana obligatoria y
 *     acotada (`LIMITES_CONSULTA_HIS.ventanaDiasMax`) y el tope de filas.
 *
 * ═══ Defensas sobre la base productiva del hospital ═══
 *   · Solo `SELECT`, con parámetros: ningún valor de la petición entra al texto
 *     SQL (solo los NOMBRES de parámetro, generados aquí).
 *   · Las fechas viajan como literal `'YYYYMMDD'` con la columna DESNUDA y el
 *     borde superior exclusivo — la misma forma sargable que el resto del driver
 *     (`diaSiguienteLiteralSql`). Envolver `FE_FECH_CIT` en una función apagaría
 *     el índice del hospital y convertiría esto en un scan de un millón de filas.
 *   · Tope de filas (`TOP`) y tope de TIEMPO. El tiempo se aplica cancelando la
 *     consulta EN EL SERVIDOR: dejar de esperar sin cancelar no quita la carga.
 *
 * ═══ Un error no es una lista vacía ═══
 * Este módulo lanza cuando no puede contestar. "El HIS no tiene nada" y "no pude
 * preguntarle al HIS" son cosas opuestas para quien diagnostica, y confundirlas
 * produce justo el diagnóstico equivocado que la pantalla existe para evitar.
 */

/** `CD_CODI_MED_CIT` es varchar(4): un valor más largo no cabe y NO se recorta en silencio. */
const MAX_LONGITUD_MEDICO = 4;
/** Filas que se piden por cupo. La PK admite pocas por (médico, hora): más es una anomalía. */
const MAX_FILAS_POR_CUPO = 10;

/** Fila de `CITAS_MEDICAS` tal como la devuelve la consulta (nombres = alias). */
interface FilaConsulta {
  /** CD_CODI_MED_CIT */
  med: string;
  /** FE_HORA_CIT */
  hora: string;
  /** NU_ESTA_CIT: 0 vigente, 1 atendida, 2 no asistió. */
  estado: number | null;
  /** CD_CODI_SER_CIT */
  servicio: string | null;
  /** NU_HIST_PAC_CIT (= documento) */
  hist: string | null;
}

export interface ResultadoConsultaEnVivo {
  appointments: HisLookupAppointment[];
  /** El resultado puede estar incompleto: se llegó al tope de filas o se omitió alguna fila ilegible. */
  truncated: boolean;
}

/**
 * `NU_ESTA_CIT` traducido al vocabulario del protocolo. Ver `desenlaceDeAtencion`
 * (mapping.ts) para la evidencia de cada valor; aquí un estado que no se conoce
 * pasa a `OTHER` en vez de inventarse uno.
 */
export function estadoDeCitaHis(estado: number | null): HisLookupStatus {
  if (estado === 0) return 'SCHEDULED';
  if (estado === 1) return 'ATTENDED';
  if (estado === 2) return 'NO_SHOW';
  return 'OTHER';
}

/**
 * Ejecuta la consulta con un tope de tiempo que la CANCELA en el servidor.
 *
 * `Promise.race` engancha un manejador a las dos promesas, así que el rechazo de
 * la que pierde (la consulta cancelada) no queda como rechazo sin manejar.
 */
async function ejecutarConTope(
  req: sql.Request,
  texto: string,
  limite: number,
): Promise<FilaConsulta[]> {
  const restante = limite - Date.now();
  if (restante <= 0) {
    throw new Error('La consulta al HIS superó el tiempo máximo.');
  }
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      try {
        req.cancel();
      } catch {
        // Ya había terminado: no hay nada que cancelar.
      }
      rechazar(
        new Error('La consulta al HIS superó el tiempo máximo y se canceló.'),
      );
    }, restante);
  });
  try {
    const r = await Promise.race([req.query<FilaConsulta>(texto), vencido]);
    return r.recordset;
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/** Filas del HIS → filas del protocolo. Las de hora ilegible se cuentan, no se inventan. */
function aCitas(
  filas: FilaConsulta[],
  timeZone: string,
): { citas: HisLookupAppointment[]; ilegibles: number } {
  const citas: HisLookupAppointment[] = [];
  let ilegibles = 0;
  for (const f of filas) {
    // El HIS guarda hora local; el protocolo viaja en UTC (plan del espejo §8).
    const startTimeIso = feHoraCitAIsoOrNull(f.hora, timeZone);
    if (!startTimeIso) {
      ilegibles++;
      continue;
    }
    citas.push({
      doctorExternalKey: f.med,
      startTimeIso,
      serviceExternalKey: f.servicio ?? undefined,
      patientDocument: f.hist ?? null,
      status: estadoDeCitaHis(f.estado),
    });
  }
  return { citas, ilegibles };
}

async function porDocumento(
  pool: sql.ConnectionPool,
  timeZone: string,
  q: HisLookupRequestDto,
  limite: number,
): Promise<ResultadoConsultaEnVivo> {
  const documentos = q.patientDocuments!;
  const from = new Date(q.fromIso!);
  const to = new Date(q.toIso!);
  // Bordes sargables: ver diaSiguienteLiteralSql().
  const desdeSql = fechaLiteralSql(
    fechaCitaLocal(from.toISOString(), timeZone),
  );
  const hastaSql = diaSiguienteLiteralSql(
    fechaCitaLocal(to.toISOString(), timeZone),
  );

  const req = pool
    .request()
    .input('desde', sql.VarChar(8), desdeSql)
    .input('hasta', sql.VarChar(8), hastaSql)
    // Una fila de más que el tope: es la forma de saber si hubo recorte.
    .input('tope', sql.Int, LIMITES_CONSULTA_HIS.maxFilas + 1);
  documentos.forEach((d, i) => req.input(`hist${i}`, sql.VarChar(20), d));
  // Solo nombres de parámetro, generados aquí: nada de la petición entra al texto.
  const lista = documentos.map((_, i) => `@hist${i}`).join(', ');

  const filas = await ejecutarConTope(
    req,
    `
        SELECT TOP (@tope)
               CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
           AND NU_HIST_PAC_CIT IN (${lista})
         ORDER BY FE_FECH_CIT, FE_HORA_CIT`,
    limite,
  );

  const topeAlcanzado = filas.length > LIMITES_CONSULTA_HIS.maxFilas;
  const { citas, ilegibles } = aCitas(
    filas.slice(0, LIMITES_CONSULTA_HIS.maxFilas),
    timeZone,
  );
  return {
    // Filtro fino: los bordes SQL son por FECHA (día) y la petición es por
    // INSTANTES; una cita a las 23:50 del día límite puede caer fuera.
    appointments: citas.filter((c) => {
      const inicio = new Date(c.startTimeIso);
      return inicio >= from && inicio < to;
    }),
    truncated: topeAlcanzado || ilegibles > 0,
  };
}

async function porCupo(
  pool: sql.ConnectionPool,
  timeZone: string,
  q: HisLookupRequestDto,
  limite: number,
): Promise<ResultadoConsultaEnVivo> {
  const cupos = q.slots!;
  // Antes de tocar el HIS: una clave que no cabe en la columna se recortaría en
  // silencio al pasarla como parámetro y se buscaría OTRO médico (o ninguno, y
  // "cupo libre" sería mentira).
  for (const c of cupos) {
    if (c.doctorExternalKey.length > MAX_LONGITUD_MEDICO) {
      throw new Error(
        `La clave de médico "${c.doctorExternalKey}" no cabe en el HIS ` +
          `(máximo ${MAX_LONGITUD_MEDICO} caracteres): no se consulta.`,
      );
    }
  }

  const appointments: HisLookupAppointment[] = [];
  let truncated = false;
  // De a uno: cada cupo es una búsqueda por la PK, y así el tiempo se reparte
  // sobre un presupuesto único en vez de abrir hasta diez consultas a la vez
  // contra la base productiva.
  for (const c of cupos) {
    const req = pool
      .request()
      .input('med', sql.VarChar(4), c.doctorExternalKey)
      .input('hora', sql.VarChar(18), formatFeHoraCit(c.startTimeIso, timeZone))
      .input('tope', sql.Int, MAX_FILAS_POR_CUPO + 1);
    const filas = await ejecutarConTope(
      req,
      `
        SELECT TOP (@tope)
               CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
          FROM dbo.CITAS_MEDICAS
         WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora`,
      limite,
    );
    const { citas, ilegibles } = aCitas(
      filas.slice(0, MAX_FILAS_POR_CUPO),
      timeZone,
    );
    appointments.push(...citas);
    if (filas.length > MAX_FILAS_POR_CUPO || ilegibles > 0) truncated = true;
  }
  return { appointments, truncated };
}

/**
 * Contesta una petición de consulta en vivo. Lanza si no puede: petición
 * inválida, HIS caído, tiempo agotado.
 */
export async function consultarCitasEnVivo(
  pool: sql.ConnectionPool,
  timeZone: string,
  consulta: HisLookupRequestDto,
  opciones: { timeoutMs?: number } = {},
): Promise<ResultadoConsultaEnVivo> {
  // Defensa en profundidad: el servidor ya validó, pero este es el último punto
  // antes de la base del hospital.
  const invalida = validarConsultaHis(consulta);
  if (invalida) throw new Error(`Petición inválida: ${invalida}`);

  const limite =
    Date.now() + (opciones.timeoutMs ?? LIMITES_CONSULTA_HIS.timeoutHisMs);
  return consulta.kind === 'BY_DOCUMENT'
    ? porDocumento(pool, timeZone, consulta, limite)
    : porCupo(pool, timeZone, consulta, limite);
}
