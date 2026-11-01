import * as sql from 'mssql';
import type {
  CampoPlantillaResumen,
  DiagnosticoResumen,
  IncapacidadResumen,
  OrdenResumen,
  RemisionResumen,
  RenglonExamenResumen,
  RenglonMedicamentoResumen,
  ResumenAtencionHis,
  TipoOrdenResumen,
} from '@agenia/shared';
import {
  feHoraCitAIsoOrNull,
  fechaHoraLiteralSql,
  formatFeHoraCit,
} from './mapping';

/**
 * Resumen de la atención — driver de Anserma (docs/PLAN_RESUMEN_ATENCION.md).
 * El mapeo de cada tabla y columna está en
 * docs/drivers/cnt-sanvicente-anserma/MAPEO_HIS.md §2.9 (rondas 1 a 6).
 *
 * ═══ Qué es una atención terminada ═══
 * Una fila de `HISTORIACLINICA` de tipo consulta (`CON`), ambulatoria (sin
 * registro de ingreso), de un servicio de la matriz de la clínica, guardada
 * hace más de la calma (2 horas por defecto). El HIS no tiene marca de cierre:
 * guarda la historia una vez y escribe las órdenes en los minutos siguientes
 * (ronda 3: máximo 116 minutos). Por eso la calma.
 *
 * ═══ El cursor ═══
 * `NU_NUME_HICL` es identidad, llave primaria e índice agrupado, y nace con
 * `GETDATE()` en `FE_FECH_HICL`: número y fecha crecen juntos. Cada vuelta pide
 * las filas con número mayor que el cursor, en orden, y se DETIENE en la primera
 * que todavía no cumple la calma. Así ninguna historia se salta aunque dos
 * relojes no coincidan, y una vuelta cuesta una búsqueda por el índice agrupado.
 *
 * ═══ Defensas sobre la base productiva del hospital ═══
 *   · Solo `SELECT`, con parámetros: ningún valor entra al texto SQL (solo los
 *     NOMBRES de parámetro, generados aquí).
 *   · Las fechas viajan como texto en hora del hospital, con la columna DESNUDA
 *     (sargable), igual que el resto del driver.
 *   · `READ UNCOMMITTED` (NOLOCK) en las tablas grandes: leer no bloquea a los
 *     médicos que están escribiendo.
 *   · Tope de filas en cada consulta.
 *
 * ═══ Lo que NO se lee ═══
 *   · `DE_DOSIS_HMED`: el texto que arma el HIS dice «1 mg» por «1 cápsula»
 *     (R4-3). El resumen muestra la indicación del médico (D19).
 *   · Los medicamentos anulados (`NU_ESTA_HMED = 0`). Los externos sin unidad
 *     de venta SÍ van: el filtro del RDA los quita y el paciente igual los
 *     reclama (M-3).
 *   · El texto del caso clínico de la remisión (copia de la historia): solo su
 *     largo (D24).
 *   · De la plantilla, solo los campos de la lista (D2).
 */

/** Filas que se miran por vuelta para encontrar las atenciones (son de todos los tipos). */
const FILAS_POR_VUELTA = 2_000;
/** Tope de caracteres de un texto libre del HIS en el resumen. */
const MAX_TEXTO = 4_000;

/**
 * Campos de plantilla que van al resumen si la clínica no configuró otros, con
 * los nombres exactos de ESEHSVP (ronda 4, R4-5). Los aprueba el comité (D2).
 */
export const CAMPOS_RESUMEN_POR_DEFECTO: CampoPlantillaResumen[] = [
  // 870 CONSULTA EXTERNA (medicina general)
  {
    plantilla: 870,
    grupo: 'MOTIVO DE CONSULTA',
    campo: 'MC:',
    seccion: 'Motivo',
  },
  { plantilla: 870, grupo: 'CONDUCTA', campo: 'Anotaciones', seccion: 'Plan' },
  {
    plantilla: 870,
    grupo: 'EDUCACION.',
    campo: 'Acerca de:',
    seccion: 'Educación',
  },
  // 844 CONTROL CRÓNICOS (hipertensos y diabéticos)
  { plantilla: 844, grupo: 'CONDUCTA', campo: 'Conducta', seccion: 'Plan' },
  {
    plantilla: 844,
    grupo: 'CONDUCTA',
    campo: 'Proximo control*',
    seccion: 'Próximo control',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Metas de educacion para el proximo control',
    seccion: 'Metas',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Dieta hiposódica',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Dieta hipograsa',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Dieta hipoglucida',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Aumento del ejercicio',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Disminución de peso',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Disminucion del tabaquismo',
    seccion: 'Educación',
  },
  // 858 Medicina interna y 899 Ginecología
  {
    plantilla: 858,
    grupo: 'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL',
    campo: 'Motivo de la Consulta',
    seccion: 'Motivo',
  },
  {
    plantilla: 858,
    grupo: 'EXAMEN FISICO GENERAL',
    campo: 'Análisis y Plan',
    seccion: 'Plan',
  },
  {
    plantilla: 899,
    grupo: 'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL',
    campo: 'Motivo de la Consulta',
    seccion: 'Motivo',
  },
  {
    plantilla: 899,
    grupo: 'EXAMEN FISICO GENERAL',
    campo: 'Análisis y Plan',
    seccion: 'Plan',
  },
  // 907 Nutrición
  {
    plantilla: 907,
    grupo: 'MOTIVO CONSULTA',
    campo: 'Motivo de la Consulta',
    seccion: 'Motivo',
  },
  {
    plantilla: 907,
    grupo: 'RECOMENDACIONES Y OBSERVACIONES',
    campo: 'Recomendaciones',
    seccion: 'Recomendaciones',
  },
  {
    plantilla: 907,
    grupo: 'RECOMENDACIONES Y OBSERVACIONES',
    campo: 'Observaciones',
    seccion: 'Recomendaciones',
  },
  {
    plantilla: 907,
    grupo: 'RECOMENDACIONES Y OBSERVACIONES',
    campo: 'Próximo Control:',
    seccion: 'Próximo control',
  },
];

// ─── Utilidades ─────────────────────────────────────────────────────────────

/** `CONVERT(varchar(23), col, 121)` en hora del hospital → instante UTC en ISO. */
export function isoDesdeHoraLocal(
  texto: string | null | undefined,
  timeZone: string,
): string | null {
  if (!texto) return null;
  const conBarras = texto
    .trim()
    .replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1/$2/$3');
  return feHoraCitAIsoOrNull(conBarras, timeZone);
}

/** Un instante → texto `'YYYY-MM-DD HH:MM:SS'` en hora del hospital (comparable con el estilo 121). */
function horaLocalComparable(instante: Date, timeZone: string): string {
  // formatFeHoraCit da 'YYYY/MM/DD HH:MM'; los segundos se dejan en :00.
  return `${formatFeHoraCit(instante.toISOString(), timeZone).replace(/\//g, '-')}:00`;
}

const limpio = (x: unknown): string | null => {
  if (x === null || x === undefined) return null;
  const t = String(x).trim();
  return t ? t.slice(0, MAX_TEXTO) : null;
};

const entero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(String(x).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const numero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Agrega `@prefijo0, @prefijo1…` al request y devuelve la lista para el `IN (…)`. */
function lista(
  req: sql.Request,
  prefijo: string,
  valores: (string | number)[],
  tipo: (() => sql.ISqlType) | sql.ISqlType,
): string {
  valores.forEach((v, i) => req.input(`${prefijo}${i}`, tipo, v));
  return valores.map((_v, i) => `@${prefijo}${i}`).join(', ');
}

const TIPO_ORDEN: Record<number, TipoOrdenResumen> = {
  1: 'CONSULTA',
  2: 'LABORATORIO',
  3: 'CIRUGIA',
  4: 'PROCEDIMIENTO',
  5: 'MEDICAMENTOS',
};

// ─── Detectar las atenciones terminadas ─────────────────────────────────────

export interface ParametrosDeteccion {
  /** Último número leído; `null` = empezar en `inicio`. */
  desde: string | null;
  /** Solo historias guardadas ANTES de este instante (ahora − calma). */
  hasta: Date;
  /** La primera vez, desde cuándo. */
  inicio: Date;
  /** Servicios del HIS de la matriz. */
  servicios: string[];
  /** Cuántas atenciones como mucho. */
  limite: number;
}

export async function detectarAtencionesTerminadas(
  pool: sql.ConnectionPool,
  timeZone: string,
  p: ParametrosDeteccion,
): Promise<{ numeros: string[]; cursor: string | null }> {
  if (p.servicios.length === 0 || p.limite <= 0)
    return { numeros: [], cursor: null };

  let desde: number;
  if (p.desde !== null && /^\d+$/.test(p.desde)) {
    desde = Number(p.desde);
  } else {
    // La primera vez: la primera historia guardada desde `inicio`, por el índice de la fecha.
    // ISO con «T»: SQL Server lo lee igual con cualquier DATEFORMAT ('YYYY-MM-DD hh:mm'
    // con espacio, no). Texto y no `Date`: un `Date` viaja en UTC y corre cinco horas.
    const r = await pool
      .request()
      .input('inicio', sql.VarChar(19), literalHoraLocal(p.inicio, timeZone))
      .query<{ n: number }>(
        `/* resumen:inicio */
         SELECT TOP (1) h.NU_NUME_HICL AS n
           FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
          WHERE h.FE_FECH_HICL >= @inicio
          ORDER BY h.FE_FECH_HICL, h.NU_NUME_HICL`,
      );
    const primera = r.recordset[0]?.n;
    if (primera === undefined || primera === null)
      return { numeros: [], cursor: null };
    desde = Number(primera) - 1;
  }

  const r = await pool
    .request()
    .input('desde', sql.Int, desde)
    .input('filas', sql.Int, FILAS_POR_VUELTA)
    .query<{
      n: number;
      fecha: string | null;
      tipo: string | null;
      reg: number | null;
      ser: string | null;
    }>(
      `/* resumen:detectar */
       SELECT TOP (@filas) h.NU_NUME_HICL AS n,
              CONVERT(varchar(23), h.FE_FECH_HICL, 121) AS fecha,
              h.TX_TIPO_HICL AS tipo,
              h.NU_NUME_REG_HICL AS reg,
              LTRIM(RTRIM(h.TX_CODSER_HICL)) AS ser
         FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
        WHERE h.NU_NUME_HICL > @desde
        ORDER BY h.NU_NUME_HICL`,
    );

  const hasta = horaLocalComparable(p.hasta, timeZone);
  const servicios = new Set(p.servicios.map((s) => s.trim()));
  const numeros: string[] = [];
  let cursor: string | null = null;

  for (const f of r.recordset) {
    // La primera fila sin la calma cumplida detiene la vuelta: lo de después espera.
    if (!f.fecha || f.fecha >= hasta) break;
    cursor = String(f.n);
    const esAtencion =
      (f.tipo ?? '').trim() === 'CON' &&
      !f.reg &&
      servicios.has((f.ser ?? '').trim());
    if (esAtencion) {
      numeros.push(String(f.n));
      if (numeros.length >= p.limite) break;
    }
  }
  return { numeros, cursor };
}

// ─── Armar los resúmenes ────────────────────────────────────────────────────

interface FilaCabecera {
  n: number;
  fecha: string | null;
  ser: string | null;
  nombreSer: string | null;
  labo: number | null;
  dapl: number | null;
  plhi: number | null;
  codPl: string | null;
  nomPl: string | null;
  esp: string | null;
  edad: number | null;
  doc: string | null;
  tipoDoc: string | null;
  n1: string | null;
  n2: string | null;
  a1: string | null;
  a2: string | null;
  nac: string | null;
  cel: string | null;
  correo: string | null;
  celAcom: string | null;
  correoAcom: string | null;
  med: string | null;
  nomMed: string | null;
  docMed: string | null;
  regMed: string | null;
  conv: string | null;
  adm: string | null;
  tius: string | null;
}

export async function leerResumenesDeAtencion(
  pool: sql.ConnectionPool,
  timeZone: string,
  numerosTexto: string[],
  camposPlantilla: CampoPlantillaResumen[] | null,
): Promise<ResumenAtencionHis[]> {
  const numeros = [
    ...new Set(numerosTexto.filter((x) => /^\d+$/.test(x)).map(Number)),
  ];
  if (numeros.length === 0) return [];
  const campos =
    camposPlantilla && camposPlantilla.length > 0
      ? camposPlantilla
      : CAMPOS_RESUMEN_POR_DEFECTO;

  // (a) Cabecera: historia, paciente, médico, plantilla y convenio.
  const rc = pool.request();
  const enH = lista(rc, 'h', numeros, sql.Int);
  const cab = await rc.query<FilaCabecera>(
    `/* resumen:cabecera */
     SELECT h.NU_NUME_HICL AS n, CONVERT(varchar(23), h.FE_FECH_HICL, 121) AS fecha,
            LTRIM(RTRIM(h.TX_CODSER_HICL)) AS ser, s.NO_NOMB_SER AS nombreSer,
            h.NU_NUME_LABO_HICL AS labo, h.NU_AUTO_DAPL_HICL AS dapl,
            r.NU_NUME_PLHI_RPET AS plhi, pl.TX_CODI_PLHI AS codPl, pl.TX_DESC_PLHI AS nomPl,
            e.NO_NOMB_ESP AS esp, l.NU_EDAD_LABO AS edad,
            LTRIM(RTRIM(h.NU_HIST_PAC_HICL)) AS doc, td.TX_NOMB_TDOC AS tipoDoc,
            pa.NO_NOMB_PAC AS n1, pa.NO_SGNO_PAC AS n2, pa.DE_PRAP_PAC AS a1, pa.DE_SGAP_PAC AS a2,
            CONVERT(varchar(10), pa.FE_NACI_PAC, 23) AS nac,
            pa.DE_TELE_PAC AS cel, pa.DE_EMAIL_PAC AS correo,
            pa.DE_TELE_ACOM_PAC AS celAcom, pa.TX_EMAIL_ACOM_PAC AS correoAcom,
            h.CD_MED_REAL_HICL AS med, m.NO_NOMB_MED AS nomMed, m.NU_DOCU_MED AS docMed, m.DE_REGI_MED AS regMed,
            k.CD_CODI_CONV AS conv, ep.NO_NOMB_EPS AS adm, tu.DE_DESC_TIUS AS tius
       FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
       LEFT JOIN dbo.PACIENTES pa       ON pa.NU_HIST_PAC = h.NU_HIST_PAC_HICL
       LEFT JOIN dbo.TIPO_DOCUMENTO td  ON td.NU_CODIGO_TDOC = pa.NU_TIPD_PAC
       LEFT JOIN dbo.SERVICIOS s        ON s.CD_CODI_SER = h.TX_CODSER_HICL
       LEFT JOIN dbo.LABORATORIO l      ON l.NU_NUME_LABO = h.NU_NUME_LABO_HICL
       LEFT JOIN dbo.ESPECIALIDADES e   ON e.CD_CODI_ESP = l.CD_CODI_ESP_LABO
       LEFT JOIN dbo.MEDICOS m          ON m.CD_CODI_MED = h.CD_MED_REAL_HICL
       LEFT JOIN dbo.DATOS_PLANTILLA dp ON dp.NU_AUTO_DAPL = h.NU_AUTO_DAPL_HICL
       LEFT JOIN dbo.R_PLAN_ESP_TIAT r  ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
       LEFT JOIN dbo.PLANTILLA_HIST pl  ON pl.NU_NUME_PLHI = r.NU_NUME_PLHI_RPET
       LEFT JOIN (SELECT t.NU_NUME_HICL_HTLA AS n, MAX(t.NU_NUME_CONV_HTLA) AS conv
                    FROM dbo.HIST_TEMLABO t WITH (NOLOCK)
                   WHERE t.NU_NUME_HICL_HTLA IN (${enH})
                   GROUP BY t.NU_NUME_HICL_HTLA) cv ON cv.n = h.NU_NUME_HICL
       LEFT JOIN dbo.CONVENIOS k        ON k.NU_NUME_CONV = cv.conv
       LEFT JOIN dbo.EPS ep             ON ep.CD_NIT_EPS = k.CD_NIT_EPS_CONV
       LEFT JOIN dbo.TIPOUSUARIO tu     ON tu.ID_CODI_TIUS = k.ID_CODI_TIUS_CONV
      WHERE h.NU_NUME_HICL IN (${enH})`,
  );
  const cabeceras = cab.recordset;
  if (cabeceras.length === 0) return [];

  const labos = [
    ...new Set(cabeceras.map((c) => c.labo).filter((x): x is number => !!x)),
  ];
  const dapls = [
    ...new Set(cabeceras.map((c) => c.dapl).filter((x): x is number => !!x)),
  ];

  // (b) Diagnósticos, por la prestación (LABORATORIO).
  const diagnosticos = new Map<number, DiagnosticoResumen[]>();
  if (labos.length > 0) {
    const rq = pool.request();
    const enL = lista(rq, 'l', labos, sql.Int);
    const r = await rq.query<{
      labo: number;
      cie: string;
      des: string | null;
      tipo: string | null;
    }>(
      `/* resumen:diagnosticos */
       SELECT d.NU_NUME_LABO_RLAD AS labo, LTRIM(RTRIM(d.CD_CODI_DIAG_RLAD)) AS cie,
              dg.DE_DESC_DIAG AS des, td.DE_DESC_TIDI AS tipo
         FROM dbo.R_LABO_DIAG d WITH (NOLOCK)
         LEFT JOIN dbo.DIAGNOSTICO dg     ON dg.CD_CODI_DIAG = d.CD_CODI_DIAG_RLAD
         LEFT JOIN dbo.TIPODIAGNOSTICO td ON td.ID_CODI_TIDI = d.ID_TIPO_DIAG_RLAD
        WHERE d.NU_NUME_LABO_RLAD IN (${enL})
        ORDER BY d.NU_NUME_LABO_RLAD, d.ID_TIPO_RLAD`,
    );
    for (const f of r.recordset) {
      const cie = limpio(f.cie);
      if (!cie) continue;
      const lista_ = diagnosticos.get(f.labo) ?? [];
      // El primero (por ID_TIPO_RLAD) es el principal: así lo ordena el HIS.
      lista_.push({
        cie10: cie,
        descripcion: limpio(f.des),
        tipo: limpio(f.tipo),
        principal: lista_.length === 0,
      });
      diagnosticos.set(f.labo, lista_);
    }
  }

  // (c) Órdenes de la historia (medicamentos y exámenes).
  const ro = pool.request();
  const enO = lista(ro, 'h', numeros, sql.Int);
  const ords = await ro.query<{
    n: number;
    orden: number;
    tipo: number;
    tiap: string | null;
    escrita: string | null;
    desde: string | null;
    serie: number | null;
    vigencia: string | null;
  }>(
    `/* resumen:ordenes */
     SELECT o.NU_NUME_HICL_HORD AS n, o.NU_AUTO_HORD AS orden, o.NU_TIPO_HORD AS tipo,
            LTRIM(RTRIM(o.TX_TIAP_HORD)) AS tiap,
            CONVERT(varchar(23), o.FE_FECH_HORD, 121) AS escrita,
            CONVERT(varchar(23), o.FE_POSFECHA, 121) AS desde,
            o.NU_ORDEN_FECHAPOS AS serie, o.TX_VIGE_HORD AS vigencia
       FROM dbo.HIST_ORDEN o WITH (NOLOCK)
      WHERE o.NU_NUME_HICL_HORD IN (${enO}) AND o.NU_TIPO_HORD IN (1, 2, 3, 4, 5)
      ORDER BY o.NU_NUME_HICL_HORD, o.NU_AUTO_HORD`,
  );

  // (d) Medicamentos: sin los anulados y SIN `DE_DOSIS_HMED` (D19).
  const rm = pool.request();
  const enM = lista(rm, 'h', numeros, sql.Int);
  const meds = await rm.query<{
    orden: number;
    cod: string | null;
    nom: string | null;
    cum: string | null;
    invima: string | null;
    medida: string | null;
    ctra: string | null;
    forma: string | null;
    via: string | null;
    cant: number | null;
    dura: string | null;
    ind: string | null;
    cada: number | null;
    unidadFrec: string | null;
    estado: number | null;
  }>(
    `/* resumen:medicamentos */
     SELECT m.NU_AUTO_HORD_HMED AS orden, LTRIM(RTRIM(m.CD_CODI_ARTI_HMED)) AS cod, m.NO_NOMB_ARTI_HMED AS nom,
            ar.NU_CODCUM_ARTI AS cum, ar.TX_INVIMA_ARTI AS invima,
            m.DE_UNME_HMED AS medida, m.DE_CTRA_HMED AS ctra, m.TX_FOFA_HMED AS forma, m.TX_VIAD_HMED AS via,
            m.NU_CANT_HMED AS cant, m.TX_DURA_HMED AS dura, m.TX_INDDOS_HMED AS ind,
            m.NU_CTFREC_HMED AS cada, f.TX_DESC_CONF_HIS AS unidadFrec, m.NU_ESTA_HMED AS estado
       FROM dbo.HIST_ORDEN o WITH (NOLOCK)
       JOIN dbo.HIST_MEDI m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
       LEFT JOIN dbo.ARTICULO ar       ON ar.CD_CODI_ARTI = m.CD_CODI_ARTI_HMED
       LEFT JOIN dbo.PAC_CONFIG_HIS f  ON f.TX_CODI_CONF_HIS = m.TX_CDFREC_HMED AND f.NU_TIPO_CONF_HIS = 37
      WHERE o.NU_NUME_HICL_HORD IN (${enM}) AND o.NU_TIPO_HORD = 5 AND ISNULL(m.NU_ESTA_HMED, 0) <> 0
      ORDER BY m.NU_AUTO_HORD_HMED, m.NU_NUME_HMED`,
  );

  // (e) Exámenes y procedimientos.
  const rp = pool.request();
  const enP = lista(rp, 'h', numeros, sql.Int);
  const procs = await rp.query<{
    orden: number;
    cod: string | null;
    nom: string | null;
    cant: number | null;
    ind: string | null;
  }>(
    `/* resumen:examenes */
     SELECT p.NU_AUTO_HORD_HPRO AS orden, LTRIM(RTRIM(p.CD_CODI_SER_HPRO)) AS cod, s.NO_NOMB_SER AS nom,
            p.NU_CANT_HPRO AS cant, CAST(p.DE_INDI_HPRO AS varchar(4000)) AS ind
       FROM dbo.HIST_ORDEN o WITH (NOLOCK)
       JOIN dbo.HIST_PROC p WITH (NOLOCK) ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
       LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = p.CD_CODI_SER_HPRO
      WHERE o.NU_NUME_HICL_HORD IN (${enP}) AND o.NU_TIPO_HORD IN (1, 2, 3, 4)
      ORDER BY p.NU_AUTO_HORD_HPRO, p.NU_NUME_HPRO`,
  );

  // (f) Remisiones: sin el texto del caso clínico, solo su largo (D24).
  const rr = pool.request();
  const enR = lista(rr, 'h', numeros, sql.Int);
  const remis = await rr.query<{
    n: number;
    num: number;
    fecha: string | null;
    remiteA: string | null;
    servicio: string | null;
    cups: string | null;
    prio: string | null;
    motivo: string | null;
    obs: string | null;
    caso: number | null;
  }>(
    `/* resumen:remisiones */
     SELECT r.NU_NUME_HICL_HREM AS n, r.NU_NUME_HREM AS num, CONVERT(varchar(23), r.FE_FECHA_HREM, 121) AS fecha,
            r.DE_REMI_HREM AS remiteA, r.TX_SERV_HREM AS servicio, LTRIM(RTRIM(r.TX_CUPSPR_HREM)) AS cups,
            LTRIM(RTRIM(r.TX_PRIO_HREM)) AS prio, CAST(r.NU_MTVREM_HREM AS varchar(10)) AS motivo,
            CAST(r.DE_DESC_HREM AS varchar(4000)) AS obs, ISNULL(DATALENGTH(r.TX_CASO_HREM), 0) AS caso
       FROM dbo.HIST_REMI r WITH (NOLOCK)
      WHERE r.NU_NUME_HICL_HREM IN (${enR})
      ORDER BY r.NU_NUME_HREM`,
  );

  // (g) Incapacidades, (h) interconsultas, (i) indicaciones.
  const ri = pool.request();
  const enI = lista(ri, 'h', numeros, sql.Int);
  const incas = await ri.query<{
    n: number;
    num: number;
    desde: string | null;
    dias: number | null;
    prorroga: number | null;
    tipo: string | null;
    origen: string | null;
    obs: string | null;
  }>(
    `/* resumen:incapacidades */
     SELECT i.NU_NUME_HICL_HINC AS n, i.NU_NUME_HINC AS num, CONVERT(varchar(23), i.FE_INIC_HINC, 121) AS desde,
            i.NU_DIAS_HINC AS dias, i.NU_PROR_HINC AS prorroga, LTRIM(RTRIM(i.TX_TIPO_HINC)) AS tipo,
            LTRIM(RTRIM(i.TX_ORIG_INCA_HINC)) AS origen, CAST(i.DE_DESC_HINC AS varchar(4000)) AS obs
       FROM dbo.HIST_INCA i WITH (NOLOCK)
      WHERE i.NU_NUME_HICL_HINC IN (${enI})
      ORDER BY i.NU_NUME_HINC`,
  );

  const rt = pool.request();
  const enT = lista(rt, 'h', numeros, sql.Int);
  const inter = await rt.query<{
    n: number;
    esp: string | null;
    obs: string | null;
  }>(
    `/* resumen:interconsultas */
     SELECT o.NU_NUME_HICL_HOTA AS n, e.NO_NOMB_ESP AS esp, CAST(o.ME_OBSER_HOTA AS varchar(4000)) AS obs
       FROM dbo.HIST_ORTIAT o WITH (NOLOCK)
       LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = o.CD_CODI_ESP_HOTA
      WHERE o.NU_NUME_HICL_HOTA IN (${enT})
      ORDER BY o.NU_NUME_HOTA`,
  );

  const rn = pool.request();
  const enN = lista(rn, 'h', numeros, sql.Int);
  const indis = await rn.query<{ n: number; texto: string | null }>(
    `/* resumen:indicaciones */
     SELECT i.NU_NUME_HICL_HIND AS n, CAST(i.DE_DESC_HIND AS varchar(4000)) AS texto
       FROM dbo.HIST_INDI i WITH (NOLOCK)
      WHERE i.NU_NUME_HICL_HIND IN (${enN})
      ORDER BY i.NU_NUME_HIND`,
  );

  // (j) Campos de la plantilla: solo los conceptos de la lista, filtrados en el HIS.
  const valores: {
    dapl: number;
    plhi: number;
    grupo: string | null;
    campo: string;
    clase: string;
    valor: string | null;
  }[] = [];
  const conceptos = [...new Set(campos.map((c) => c.campo))];
  if (dapls.length > 0 && conceptos.length > 0) {
    const rv = pool.request();
    const enD = lista(rv, 'd', dapls, sql.Int);
    const enC = lista(rv, 'c', conceptos, sql.VarChar(200));
    const r = await rv.query<(typeof valores)[number]>(
      `/* resumen:campos */
       SELECT v.dapl, rc.NU_NUME_PLHI_RPC AS plhi, g.CD_CODI_GRHI AS grupo, c.CD_CODI_COHI AS campo, v.clase, v.valor
         FROM (SELECT t.NU_AUTO_DAPL_DPTE AS dapl, t.NU_INDI_DPTE AS indi, 'TEXT' AS clase, CAST(t.TX_DESC_DPTE AS varchar(4000)) AS valor
                 FROM dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) WHERE t.NU_AUTO_DAPL_DPTE IN (${enD})
               UNION ALL
               SELECT t.NU_AUTO_DAPL_DPME, t.NU_INDI_DPME, 'MEMO', CAST(t.TX_DESC_DPME AS varchar(4000))
                 FROM dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) WHERE t.NU_AUTO_DAPL_DPME IN (${enD})
               UNION ALL
               SELECT t.NU_AUTO_DAPL_DPNU, t.NU_INDI_DPNU, 'NUME', CAST(t.NU_DESC_DPNU AS varchar(40))
                 FROM dbo.DATOS_PLANTILLA_NUME t WITH (NOLOCK) WHERE t.NU_AUTO_DAPL_DPNU IN (${enD})
               UNION ALL
               SELECT t.NU_AUTO_DAPL_DPDA, t.NU_INDI_DPDA, 'DATE', CONVERT(varchar(10), t.FE_DESC_DPDA, 23)
                 FROM dbo.DATOS_PLANTILLA_DATE t WITH (NOLOCK) WHERE t.NU_AUTO_DAPL_DPDA IN (${enD})) v
         JOIN dbo.DATOS_PLANTILLA dp ON dp.NU_AUTO_DAPL = v.dapl
         JOIN dbo.R_PLAN_ESP_TIAT re ON re.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
         JOIN dbo.R_PLAN_CONC rc     ON rc.NU_NUME_PLHI_RPC = re.NU_NUME_PLHI_RPET AND rc.NU_INDI_RPC = v.indi
         JOIN dbo.CONCEPTO_HIST c    ON c.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
         LEFT JOIN dbo.GRUPO_HIST g  ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
        WHERE c.CD_CODI_COHI IN (${enC})
        ORDER BY v.dapl, v.indi`,
    );
    valores.push(...r.recordset);
  }

  // ── Armado ────────────────────────────────────────────────────────────────
  const medsPorOrden = agrupar(meds.recordset, (m) => m.orden);
  const procsPorOrden = agrupar(procs.recordset, (p) => p.orden);
  const ordenesPorHistoria = agrupar(ords.recordset, (o) => o.n);
  const remisPorHistoria = agrupar(remis.recordset, (r) => r.n);
  const incasPorHistoria = agrupar(incas.recordset, (i) => i.n);
  const interPorHistoria = agrupar(inter.recordset, (i) => i.n);
  const indisPorHistoria = agrupar(indis.recordset, (i) => i.n);
  const valoresPorDapl = agrupar(valores, (v) => v.dapl);

  const resumenes: ResumenAtencionHis[] = [];
  for (const c of cabeceras) {
    const guardadaIso = isoDesdeHoraLocal(c.fecha, timeZone);
    const documento = limpio(c.doc);
    if (!guardadaIso || !documento) continue;

    const ordenes: OrdenResumen[] = [];
    for (const o of ordenesPorHistoria.get(c.n) ?? []) {
      const tipo = TIPO_ORDEN[o.tipo];
      if (!tipo) continue;
      const medicamentos: RenglonMedicamentoResumen[] =
        tipo === 'MEDICAMENTOS'
          ? (medsPorOrden.get(o.orden) ?? []).map((m) => ({
              codigo: limpio(m.cod) ?? '',
              nombre: limpio(m.nom) ?? '',
              cum: limpio(m.cum),
              invima: limpio(m.invima),
              medida: limpio(m.medida),
              concentracion: limpio(m.ctra),
              forma: limpio(m.forma),
              via: limpio(m.via),
              cantidad: numero(m.cant),
              duracionDias: entero(m.dura),
              indicacion: limpio(m.ind),
              frecuencia:
                m.cada && limpio(m.unidadFrec)
                  ? `cada ${m.cada} ${limpio(m.unidadFrec)!.toLowerCase()}`
                  : null,
              entregado: m.estado === 2,
            }))
          : [];
      const examenes: RenglonExamenResumen[] =
        tipo !== 'MEDICAMENTOS'
          ? (procsPorOrden.get(o.orden) ?? []).map((p) => ({
              codigo: limpio(p.cod) ?? '',
              nombre: limpio(p.nom) ?? limpio(p.cod) ?? '',
              cantidad: numero(p.cant),
              indicacion: limpio(p.ind),
            }))
          : [];
      // Una orden que se quedó sin renglones (todos anulados) no es una hoja.
      if (medicamentos.length + examenes.length === 0) continue;
      ordenes.push({
        numero: String(o.orden),
        tipo,
        farmacia: o.tiap === 'AI' || o.tiap === 'AE' ? o.tiap : null,
        escritaIso: isoDesdeHoraLocal(o.escrita, timeZone),
        desdeIso: isoDesdeHoraLocal(o.desde, timeZone),
        serie: o.serie ? String(o.serie) : null,
        vigencia: limpio(o.vigencia),
        medicamentos,
        examenes,
      });
    }

    const remisiones: RemisionResumen[] = (remisPorHistoria.get(c.n) ?? []).map(
      (r) => ({
        numero: String(r.num),
        fechaIso: isoDesdeHoraLocal(r.fecha, timeZone),
        remiteA: limpio(r.remiteA),
        servicioPedido: limpio(r.servicio),
        cups: limpio(r.cups),
        prioridad: limpio(r.prio),
        motivo: limpio(r.motivo),
        observaciones: limpio(r.obs),
        casoClinicoCaracteres: entero(r.caso) ?? 0,
      }),
    );

    const incapacidades: IncapacidadResumen[] = (
      incasPorHistoria.get(c.n) ?? []
    ).map((i) => ({
      numero: String(i.num),
      desdeIso: isoDesdeHoraLocal(i.desde, timeZone),
      dias: entero(i.dias),
      prorroga: !!i.prorroga,
      tipo: limpio(i.tipo),
      origen: limpio(i.origen),
      observacion: limpio(i.obs),
    }));

    const nombre = [c.n1, c.n2, c.a1, c.a2]
      .map(limpio)
      .filter(Boolean)
      .join(' ');

    resumenes.push({
      version: 1,
      historia: {
        numero: String(c.n),
        guardadaIso,
        servicio: limpio(c.ser),
        nombreServicio: limpio(c.nombreSer),
        plantilla: c.plhi ?? null,
        codigoPlantilla: limpio(c.codPl),
        nombrePlantilla: limpio(c.nomPl),
        especialidad: limpio(c.esp),
        edad: entero(c.edad),
      },
      paciente: {
        documento,
        tipoDocumento: limpio(c.tipoDoc),
        nombre,
        fechaNacimientoIso: limpio(c.nac),
        celular: limpio(c.cel),
        correo: limpio(c.correo),
        celularAcompanante: limpio(c.celAcom),
        correoAcompanante: limpio(c.correoAcom),
      },
      medico: {
        codigo: limpio(c.med),
        nombre: limpio(c.nomMed),
        documento: limpio(c.docMed),
        registro: limpio(c.regMed),
      },
      afiliacion: {
        convenio: limpio(c.conv),
        administradora: limpio(c.adm),
        tipoUsuario: limpio(c.tius),
      },
      diagnosticos: c.labo ? (diagnosticos.get(c.labo) ?? []) : [],
      ordenes,
      remisiones,
      incapacidades,
      interconsultas: (interPorHistoria.get(c.n) ?? []).map((i) => ({
        especialidad: limpio(i.esp),
        observacion: limpio(i.obs),
      })),
      indicaciones: (indisPorHistoria.get(c.n) ?? [])
        .map((i) => limpio(i.texto))
        .filter((t): t is string => !!t),
      campos: camposDeLaHistoria(
        c.dapl ? (valoresPorDapl.get(c.dapl) ?? []) : [],
        campos,
      ),
    });
  }
  return resumenes;
}

/**
 * Los campos de la lista que la historia trae llenos. Una casilla (`NUME`) va
 * solo si está marcada, y dice «Sí»: «Dieta hiposódica: Sí».
 */
function camposDeLaHistoria(
  valores: {
    plhi: number;
    grupo: string | null;
    campo: string;
    clase: string;
    valor: string | null;
  }[],
  lista_: CampoPlantillaResumen[],
): ResumenAtencionHis['campos'] {
  const r: ResumenAtencionHis['campos'] = [];
  for (const v of valores) {
    const def = lista_.find(
      (k) =>
        k.plantilla === v.plhi &&
        k.campo === v.campo &&
        (k.grupo === null || k.grupo === (v.grupo ?? '').trim()),
    );
    if (!def) continue;
    let valor = limpio(v.valor);
    if (v.clase === 'NUME') {
      if (Number(valor) !== 1) continue;
      valor = 'Sí';
    }
    if (!valor) continue;
    r.push({
      seccion: def.seccion,
      grupo: limpio(v.grupo),
      campo: v.campo,
      valor,
    });
  }
  return r;
}

function agrupar<T, K>(filas: T[], llave: (f: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const f of filas) {
    const k = llave(f);
    const l = m.get(k);
    if (l) l.push(f);
    else m.set(k, [f]);
  }
  return m;
}

/** Literal ISO (sin zona) de un instante en hora del hospital, para comparar con una columna datetime. */
export function literalHoraLocal(instante: Date, timeZone: string): string {
  return fechaHoraLiteralSql(formatFeHoraCit(instante.toISOString(), timeZone));
}
