// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — Parser y validador del CSV de afiliados activos.
//
// Lógica 100% pura (sin I/O, sin Prisma): recibe el texto del archivo y
// devuelve un reporte detallado con las filas normalizadas válidas y los
// errores por línea. La pantalla de importación llama esto dos veces (regla
// de oro): al VALIDAR y de nuevo al IMPORTAR, para que nunca entre a la base
// un archivo alterado entre pasos.
//
// FORMATO MÍNIMO, A PROPÓSITO — un solo campo obligatorio: `cedula`.
//
// Antes el archivo pedía cédula + nombre + EPS (y aceptaba teléfono, email,
// fecha de nacimiento, género y dirección). Analizado contra los padrones
// reales del Hospital San Vicente de Paúl (Anserma, 2026-09-10): con esas
// columnas, el 77% de las filas se rechazaba por fechas mal formadas o
// teléfonos que eran relleno (`Telefono` = "2000000" en el 87% de los
// casos), y de las que pasaban, entraban con nombre sin apellidos y fecha de
// nacimiento invertida en silencio (MM/DD leído como DD/MM).
//
// Ninguno de esos datos hace falta: el HIS del hospital, vía el agente
// espejo, ya tiene el nombre completo bien partido, la fecha de nacimiento,
// el sexo y la dirección — y es la fuente correcta, no una copia de la EPS.
// El padrón solo tiene que responder una pregunta que nadie más responde:
// ¿tiene derecho hoy, en qué EPS, en qué régimen? Por eso:
//
//   - `cedula`   — obligatoria: es la llave.
//   - `regimen`  — opcional pero muy deseado: enruta el convenio de
//                  facturación (SUBSIDIADO/CONTRIBUTIVO). Sin él, el driver
//                  cae a una heurística sobre R_PAC_EPS del HIS.
//   - `telefono` — opcional pero valioso: en la muestra medida, el padrón
//                  tenía móvil válido en 92% de los casos contra 74,6% en
//                  el HIS, y para 13.002 pacientes del HIS el teléfono es
//                  literalmente "0" — el padrón es la única fuente.
//
// La EPS del archivo NO se lee de una columna: se elige en la pantalla antes
// de subir el archivo (un archivo = una EPS), lo que además hace imposible
// mezclar afiliados de EPS distintas por un valor de columna mal escrito.
//
// `ProgramasEspeciales` y cualquier dato clínico/sensible del padrón original
// (oncología, salud mental, IVE, violencia — ~14% de las filas reales del
// hospital piloto) NO tienen columna aquí y nunca la tendrán: no se custodia
// lo que no se necesita.
//
// LECTURA RESILIENTE (2026-10-23) — el archivo se carga tal como lo manda la
// EPS, sin editarlo a mano. Con los cortes de octubre del hospital piloto:
//
//   - Sura cambió su export: la cédula pasó de «NUMERO DE IDENTIFICACION» a
//     «Numero_Identificacion», y el archivo entero se rechazaba por «falta la
//     columna cedula». Los encabezados se leen ahora por PALABRAS (sin tildes,
//     `_`, «de»/«número»…, y CamelCase partido), se descartan los que son de
//     otra persona o de otra cosa (cotizante, tipo de documento, código del
//     cliente) y el CONTENIDO decide entre candidatos.
//   - El teléfono se tomaba de la PRIMERA columna con nombre de teléfono. En
//     Salud Total esa es `Telefono` («2000000» o un fijo viejo de 7 dígitos)
//     y el celular real estaba en `telefonomovil`: de 9.201 afiliados no
//     entró ni un celular. Ahora se revisan TODAS las columnas de teléfono y
//     se toma el primer celular; si no hay, un fijo de 10 dígitos.
//   - Una fila con un `;` de más dentro de un nombre o una dirección corre
//     las columnas siguientes. Si sus datos se pueden leer sin duda (la
//     cédula en un solo lugar, el régimen en la columna vecina), se
//     reacomoda y se anota; si no, es un error DE ESA FILA.
//   - Los errores de fila ya no tumban el archivo: `fileError` distingue el
//     archivo ilegible (no hay nada que importar) de las filas sueltas que
//     quien carga puede aceptar ignorar.
// ─────────────────────────────────────────────────────────────

import { esDocumentoValido, normalizeDocumento } from './documento';

export type PadronRegime = 'SUBSIDIADO' | 'CONTRIBUTIVO';

export interface PadronCsvRow {
  /** Línea física en el archivo (1-based, contando el encabezado). */
  line: number;
  /** Ya normalizada con `normalizeDocumento` — solo dígitos. */
  cedula: string;
  /** null si el archivo no la trae o la celda viene vacía (columna opcional). */
  regime: PadronRegime | null;
  /**
   * Celular (3XXXXXXXXX) o fijo (60XXXXXXXX) en 10 dígitos, sin el 57. null
   * si el archivo no trae ninguno utilizable (columna opcional).
   */
  phone: string | null;
  /**
   * Solo si la fila venía corrida y alguno de sus datos se leyó de una
   * columna vecina: qué se hizo, para mostrarlo y dejarlo en el log del corte.
   */
  repair?: string;
}

export interface PadronCsvError {
  line: number;
  column?: string;
  message: string;
  /**
   * Valor crudo (sin normalizar) de la columna `cedula` en esa línea, cuando
   * la fila alcanzó a parsearse campo por campo (no aplica a errores de
   * encabezado o de conteo de columnas, donde no hay celda de cédula fiable
   * que citar). La usa el importador para poder trazar una fila rechazada
   * SIN guardar el resto de la fila — es el documento, no un dato sensible;
   * es lo mismo que ya aparece dentro del texto de `message` cuando la
   * cédula es la columna que falló.
   */
  rawCedula?: string;
  /**
   * Solo en `PadronCsvReport.warnings`: distingue por qué se ignoró la fila,
   * para que el importador pueda registrar el motivo correcto en el log de
   * auditoría (`PadronImportRow.resultado`) en vez de etiquetar todo como
   * "duplicado".
   */
  kind?: 'DUPLICADA' | 'INVALIDA';
}

/** Qué columna del archivo se usó para cada dato, con su nombre tal como viene en el encabezado. */
export interface PadronCsvColumns {
  cedula: string | null;
  regimen: string | null;
  /** En el orden en que se buscan: primero las del afiliado, celulares antes que fijos. */
  telefono: string[];
}

export interface PadronCsvReport {
  /** true sólo si el archivo tiene al menos una fila y CERO errores (los warnings NO cuentan). */
  ok: boolean;
  /**
   * true si el problema es del archivo entero: no es un CSV de texto, está
   * vacío, no se encontró la columna de la cédula, no trae filas o supera el
   * máximo. No hay nada que importar. false con errores es que fallaron
   * filas sueltas: el resto se puede importar si quien carga acepta
   * ignorarlas.
   */
  fileError: boolean;
  totalDataRows: number;
  validRows: PadronCsvRow[];
  errors: PadronCsvError[];
  /**
   * Inconsistencias que NO bloquean el archivo: hoy, solo cédulas
   * duplicadas. La fila se ignora igual (queda solo la primera aparición en
   * `validRows`), pero se informa en vez de rechazar todo el archivo — el
   * usuario decide si importar el resto tal cual.
   */
  warnings: PadronCsvError[];
  delimiter: ',' | ';';
  /**
   * Líneas antes del encabezado real que se ignoraron (título del reporte,
   * líneas en blanco, etc.). 0 en el caso normal (encabezado en la línea 1).
   */
  ignoredPreambleLines: number;
  columns: PadronCsvColumns;
}

/** Columnas del formato oficial (encabezado de la plantilla descargable). */
export const PADRON_CSV_HEADERS = ['cedula', 'regimen', 'telefono'] as const;

// ── Reconocimiento de encabezados por palabras ──
// Cada encabezado se parte en palabras sin tildes ni mayúsculas
// («Numero_Identificacion» → «identificacion», «TipoDocumento» → «tipo
// documento»), sin las de relleno.
const HEADER_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'n', 'no', 'nro', 'num', 'numero']);

const CEDULA_WORDS = new Set(['cedula', 'documento', 'identificacion', 'dni', 'cc', 'nuip', 'numide', 'doc']);
// Palabras que acompañan al documento del propio afiliado sin cambiarle el sentido.
const CEDULA_NEUTRAL_WORDS = new Set(['afiliado', 'usuario', 'paciente', 'beneficiario', 'identidad', 'ciudadania', 'persona']);
// Documento de OTRA persona o de otra cosa: el del cotizante (Sura y Salud
// Total lo traen al lado del afiliado), el tipo de documento, el código
// interno del cliente, la fecha o el lugar de expedición…
const CEDULA_EXCLUDED_WORDS = new Set([
  'tipo',
  'tipide',
  'cotizante',
  'cot',
  'titular',
  'contacto',
  'cliente',
  'codigo',
  'cod',
  'fecha',
  'expedicion',
  'lugar',
  'acudiente',
  'responsable',
  'madre',
  'padre',
  'ips',
  'eps',
  'medico',
]);

const MOBILE_WORDS = new Set(['celular', 'cel', 'movil', 'whatsapp', 'telefonomovil']);
const PHONE_WORDS = new Set(['telefono', 'telefonos', 'tel', ...MOBILE_WORDS]);
// El teléfono de otra persona (contacto, acudiente): sirve, pero después del propio.
const PHONE_SECONDARY_WORDS = new Set(['contacto', 'acudiente', 'responsable', 'familiar', 'emergencia']);
const PHONE_EXCLUDED_WORDS = new Set(['tipo', 'indicativo', 'extension', 'ext']);

/** Tope defensivo de filas de datos por archivo (protege memoria/tiempo de respuesta). */
const MAX_DATA_ROWS = 20_000;

/** Filas de datos que se miran para decidir, por su contenido, qué columna es cuál. */
const CONTENT_SAMPLE_ROWS = 200;

/**
 * Desplazamientos que se prueban cuando el régimen de una fila no está en
 * su columna: un dato partido en dos celdas corre todo una posición, rara
 * vez dos.
 */
const ROW_SHIFT_SEARCH = [1, -1, 2, -2];

/**
 * Líneas iniciales que se escanean buscando el encabezado real. Los padrones
 * reales a veces traen 1-2 líneas de "basura" antes del encabezado (título
 * del reporte, fecha de corte, línas en blanco de un export de Excel) — se
 * ignoran en vez de contarlas como fila de datos rota.
 */
const HEADER_SEARCH_MAX_LINES = 25;

/**
 * Firmas binarias inconfundibles al inicio del archivo (ZIP/xlsx, OLE/xls, PDF).
 * Un CSV de texto real jamás empieza con estos bytes, así que esta detección
 * nunca da falso positivo con un padrón legítimo (incluyendo codificaciones
 * legacy tipo Windows-1252 exportadas por Excel es-CO).
 */
const BINARY_SIGNATURES: Array<{ prefix: string; label: string }> = [
  { prefix: 'PK', label: 'un archivo Excel (.xlsx) o ZIP' },
  { prefix: '%PDF', label: 'un archivo PDF' },
];

function detectBinarySignature(text: string): string | null {
  for (const { prefix, label } of BINARY_SIGNATURES) {
    if (text.startsWith(prefix)) return label;
  }
  return null;
}

/**
 * Proporción de caracteres de reemplazo (U+FFFD) en el texto: aparecen cuando
 * el navegador decodifica bytes que no son UTF-8 válido (típico de un binario,
 * o de un CSV legacy en Windows-1252 con muchas tildes). Solo se usa para
 * ENRIQUECER el mensaje de error cuando el encabezado ya no calzó — nunca para
 * decidir por sí sola que el archivo es inválido, así se evita falso positivo
 * sobre un padrón real con acentos.
 */
function replacementCharDensity(text: string): number {
  const sample = text.slice(0, 500);
  if (!sample.length) return 0;
  let replacementCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0xfffd) replacementCount++;
  }
  return replacementCount / sample.length;
}

/**
 * Minúsculas, sin tildes, espacios colapsados — para comparar texto humano.
 * Exportada: la reutiliza el detector de EPS (padron-eps-detect.ts) para
 * comparar el nombre de la EPS contra la columna del archivo o el nombre del
 * archivo, con la misma noción de "igual" que ya usa el mapeo de encabezados.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta el delimitador mirando el encabezado: los exports de Excel en
 * es-CO usan `;`, los estándar `,`. Gana el que más columnas produzca.
 */
export function detectDelimiter(headerLine: string): ',' | ';' {
  const commas = headerLine.split(',').length;
  const semis = headerLine.split(';').length;
  return semis > commas ? ';' : ',';
}

/**
 * Split de UNA línea CSV respetando comillas dobles (RFC 4180 básico).
 * Exportada por la misma razón que `normalizeForMatch` — la reutiliza el
 * detector de EPS para leer la columna `eps`/`aseguradora` sin duplicar el
 * parser de comillas.
 */
export function splitCsvLine(line: string, delimiter: ',' | ';'): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // comilla escapada ""
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/** Palabras de un encabezado: «Numero_Identificacion» → ['identificacion']. */
function headerWords(cell: string): string[] {
  return normalizeForMatch(cell.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !HEADER_STOPWORDS.has(word));
}

/** 0 = no es la cédula del afiliado; 2 = solo dice eso («Documento»); 1 = lo dice con algo más. */
function cedulaHeaderScore(words: string[]): number {
  if (!words.some((w) => CEDULA_WORDS.has(w)) || words.some((w) => CEDULA_EXCLUDED_WORDS.has(w))) return 0;
  return words.every((w) => CEDULA_WORDS.has(w) || CEDULA_NEUTRAL_WORDS.has(w)) ? 2 : 1;
}

function regimenHeaderScore(words: string[]): number {
  const joined = words.join(' ');
  if (joined === 'regimen' || joined === 'tipo afiliacion' || joined === 'tipoafiliacion') return 2;
  return words.includes('regimen') ? 1 : 0;
}

/** null = no es columna de teléfono; menor = se mira antes. */
function telefonoHeaderRank(words: string[]): number | null {
  if (!words.some((w) => PHONE_WORDS.has(w)) || words.some((w) => PHONE_EXCLUDED_WORDS.has(w))) return null;
  const secondary = words.some((w) => PHONE_SECONDARY_WORDS.has(w)) ? 2 : 0;
  return secondary + (words.some((w) => MOBILE_WORDS.has(w)) ? 0 : 1);
}

/** SUBSIDIADO o CONTRIBUTIVO escritos completos («Régimen subsidiado» también). */
function regimeWord(raw: string): PadronRegime | null {
  const value = normalizeForMatch(raw).replace(/^regimen /, '');
  if (value === 'subsidiado') return 'SUBSIDIADO';
  if (value === 'contributivo') return 'CONTRIBUTIVO';
  return null;
}

/** Además de la palabra completa, las abreviaturas — solo en la columna del régimen de una fila derecha. */
function normalizeRegime(raw: string): PadronRegime | null {
  const word = regimeWord(raw);
  if (word) return word;
  const value = normalizeForMatch(raw);
  if (['sub', 's'].includes(value)) return 'SUBSIDIADO';
  if (['contrib', 'c'].includes(value)) return 'CONTRIBUTIVO';
  return null;
}

/**
 * Celular o fijo colombiano en 10 dígitos, sin el 57. Un número de 7
 * dígitos ya no se puede marcar en Colombia (desde 2021 los fijos llevan
 * 60 + indicativo) y en los padrones reales es relleno: «2000000» en el 57%
 * de las filas de Salud Total. Un celular de un solo dígito repetido
 * (3000000000) también.
 */
function normalizePadronPhone(raw: string): { phone: string; mobile: boolean } | null {
  let digits = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  if (/^3\d{9}$/.test(digits) && !/^3(\d)\1{8}$/.test(digits)) return { phone: digits, mobile: true };
  if (/^60\d{8}$/.test(digits)) return { phone: digits, mobile: false };
  return null;
}

/** Proporción de celdas NO vacías de la columna que cumplen `test` (0 si están todas vacías). */
function contentRatio(sample: string[][], idx: number, test: (raw: string) => boolean): number {
  let filled = 0;
  let passing = 0;
  for (const cells of sample) {
    const raw = cells[idx] ?? '';
    if (!raw) continue;
    filled++;
    if (test(raw)) passing++;
  }
  return filled === 0 ? 0 : passing / filled;
}

function filledCount(sample: string[][], idx: number): number {
  return sample.reduce((n, cells) => n + (cells[idx] ? 1 : 0), 0);
}

interface ColumnIndexes {
  cedula: number;
  regimen: number | null;
  telefono: number[];
}

/**
 * Elige qué columna es cuál. El nombre propone y el contenido decide: entre
 * dos columnas que se llaman como la cédula gana la que de verdad trae
 * documentos, y una columna «Régimen» que no trae SUBSIDIADO/CONTRIBUTIVO no
 * se usa (se busca otra que sí, por contenido). La cédula NUNCA se elige solo
 * por contenido: el código interno del cliente o el documento del cotizante
 * también parecen cédulas.
 */
function chooseColumns(headerCells: string[], sample: string[][]): ColumnIndexes | null {
  const words = headerCells.map(headerWords);

  const cedulaCandidates = words
    .map((w, idx) => ({
      idx,
      score: cedulaHeaderScore(w),
      ratio: contentRatio(sample, idx, (raw) => esDocumentoValido(normalizeDocumento(raw))),
    }))
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        Number(b.ratio >= 0.5) - Number(a.ratio >= 0.5) || b.score - a.score || b.ratio - a.ratio || a.idx - b.idx,
    );
  if (cedulaCandidates.length === 0) return null;
  const cedula = cedulaCandidates[0].idx;

  const byName = words
    .map((w, idx) => ({ idx, score: regimenHeaderScore(w), ratio: contentRatio(sample, idx, (raw) => !!normalizeRegime(raw)) }))
    .filter((c) => c.score > 0 && c.idx !== cedula && c.ratio >= 0.5)
    .sort((a, b) => b.score - a.score || b.ratio - a.ratio || a.idx - b.idx);
  let regimen: number | null = byName[0]?.idx ?? null;
  if (regimen === null) {
    // Sin encabezado reconocible: una columna en la que casi todo es
    // SUBSIDIADO/CONTRIBUTIVO escrito completo no puede ser otra cosa. Las
    // abreviaturas no cuentan aquí: «C» es también «cédula» en el tipo de
    // documento.
    const minFilled = Math.max(1, Math.ceil(sample.length / 2));
    const byContent = headerCells
      .map((_, idx) => ({ idx, ratio: contentRatio(sample, idx, (raw) => !!regimeWord(raw)) }))
      .filter((c) => c.idx !== cedula && c.ratio >= 0.9 && filledCount(sample, c.idx) >= minFilled)
      .sort((a, b) => b.ratio - a.ratio || a.idx - b.idx);
    regimen = byContent[0]?.idx ?? null;
  }

  const telefono = words
    .map((w, idx) => ({ idx, rank: telefonoHeaderRank(w) }))
    .filter((c): c is { idx: number; rank: number } => c.rank !== null && c.idx !== cedula && c.idx !== regimen)
    .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
    .map((c) => c.idx);

  return { cedula, regimen, telefono };
}

function joinWithY(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

const EMPTY_COLUMNS: PadronCsvColumns = { cedula: null, regimen: null, telefono: [] };

/**
 * Valida a fondo el CSV del padrón. Nunca lanza: todos los problemas se
 * devuelven como errores por línea.
 *
 * NO recibe el catálogo de EPS: la EPS del archivo se elige en la pantalla
 * (un archivo = una EPS), no se lee de una columna.
 */
export function validatePadronCsv(csvText: string): PadronCsvReport {
  const errors: PadronCsvError[] = [];
  const warnings: PadronCsvError[] = [];
  const validRows: PadronCsvRow[] = [];

  // ── Defensa en profundidad: archivo binario disfrazado de .csv ──
  // El filtro fuerte (bytes crudos) va en el cliente antes de leer el
  // archivo como texto; esto solo cubre llamadas directas a esta función
  // (scripts, tests, futura API) que se salten esa capa.
  const binaryLabel = detectBinarySignature(csvText);
  if (binaryLabel) {
    return {
      ok: false,
      fileError: true,
      totalDataRows: 0,
      validRows: [],
      errors: [
        {
          line: 1,
          message: `El archivo parece ser ${binaryLabel}, no un CSV de texto. Expórtelo como "CSV UTF-8 (delimitado por comas)" desde Excel o Google Sheets y vuelva a intentarlo.`,
        },
      ],
      delimiter: ',',
      ignoredPreambleLines: 0,
      warnings: [],
      columns: EMPTY_COLUMNS,
    };
  }

  const lines = csvText
    .replace(/^﻿/, '') // BOM de Excel
    .split(/\r\n|\r|\n/);

  if (!lines.some((l) => l.trim())) {
    return {
      ok: false,
      fileError: true,
      totalDataRows: 0,
      validRows: [],
      errors: [{ line: 1, message: 'El archivo está vacío o no tiene encabezado.' }],
      delimiter: ',',
      ignoredPreambleLines: 0,
      warnings: [],
      columns: EMPTY_COLUMNS,
    };
  }

  // ── Encabezado: puede no estar en la primera línea ──
  // Los padrones reales a veces traen basura antes del encabezado real
  // (título del reporte, fecha de corte, líneas en blanco de un export de
  // Excel). Se escanean las primeras HEADER_SEARCH_MAX_LINES buscando la
  // primera que ya traiga una columna con nombre de cédula; esa se usa como
  // encabezado y todo lo anterior se ignora sin penalizar el archivo. Si
  // ninguna calza, el mensaje cita las columnas de la primera línea no vacía.
  let firstLineIndex = -1;
  let headerLineIndex = -1;
  let delimiter: ',' | ';' = ',';
  let headerCells: string[] = [];

  const scanLimit = Math.min(lines.length, HEADER_SEARCH_MAX_LINES);
  for (let h = 0; h < scanLimit; h++) {
    const candidateLine = lines[h];
    if (!candidateLine || !candidateLine.trim()) continue;

    const candidateDelimiter = detectDelimiter(candidateLine);
    const candidateCells = splitCsvLine(candidateLine, candidateDelimiter);
    if (firstLineIndex === -1) {
      firstLineIndex = h;
      delimiter = candidateDelimiter;
      headerCells = candidateCells;
    }
    if (candidateCells.some((cell) => cedulaHeaderScore(headerWords(cell)) > 0)) {
      headerLineIndex = h;
      delimiter = candidateDelimiter;
      headerCells = candidateCells;
      break;
    }
  }

  const sample: string[][] = [];
  if (headerLineIndex !== -1) {
    for (let i = headerLineIndex + 1; i < lines.length && sample.length < CONTENT_SAMPLE_ROWS; i++) {
      if (lines[i].trim()) sample.push(splitCsvLine(lines[i], delimiter));
    }
  }
  const cols = headerLineIndex === -1 ? null : chooseColumns(headerCells, sample);

  if (!cols) {
    // Un archivo con muchos caracteres de reemplazo casi nunca es un CSV de
    // texto real (más probable: binario que no coincidió con ninguna firma
    // conocida, o guardado en una codificación completamente distinta).
    // Esto NO decide el resultado (ya era inválido por encabezado faltante),
    // solo aclara la causa raíz probable.
    const encodingHint =
      replacementCharDensity(csvText) > 0.2
        ? ' El archivo contiene numerosos caracteres no reconocibles: verifique que se haya guardado como texto CSV en codificación UTF-8 y no como un formato binario u otra codificación.'
        : '';
    const named = headerCells.filter(Boolean);
    const columnList =
      named.length > 0
        ? ` Columnas del archivo: ${named.slice(0, 15).join(', ')}${named.length > 15 ? '…' : ''}.`
        : '';
    return {
      ok: false,
      fileError: true,
      totalDataRows: 0,
      validRows: [],
      errors: [
        {
          line: firstLineIndex + 1,
          message: `No se encontró la columna con la cédula del afiliado: un encabezado como «cedula», «documento» o «numero de identificacion» (no sirven el del cotizante ni el tipo de documento).${columnList} Cambie el nombre de esa columna a «cedula» y valide de nuevo.${encodingHint}`,
        },
      ],
      delimiter,
      ignoredPreambleLines: 0,
      warnings: [],
      columns: EMPTY_COLUMNS,
    };
  }

  const columns: PadronCsvColumns = {
    cedula: headerCells[cols.cedula],
    regimen: cols.regimen === null ? null : headerCells[cols.regimen],
    telefono: cols.telefono.map((idx) => headerCells[idx]),
  };
  const ignoredPreambleLines = headerLineIndex;
  const seenCedulas = new Map<string, number>(); // cédula → línea donde apareció
  let totalDataRows = 0;
  let tooManyRows = false;
  const expectedColumnCount = headerCells.length;

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = i + 1; // 1-based
    const rawLine = lines[i];
    if (!rawLine.trim()) continue; // líneas vacías (típico al final) se ignoran

    totalDataRows++;

    if (totalDataRows > MAX_DATA_ROWS) {
      tooManyRows = true;
      errors.push({
        line,
        message: `El archivo supera el máximo de ${MAX_DATA_ROWS} filas de datos por importación. Divídalo en archivos más pequeños y vuelva a intentarlo.`,
      });
      break;
    }

    const cells = splitCsvLine(rawLine, delimiter);
    const at = (idx: number, offset: number): string => cells[idx + offset] ?? '';

    // ── Fila corrida ──
    // Un `;` de más dentro de un nombre o una dirección (o uno de menos)
    // corre todas las columnas siguientes. Con un número distinto de celdas
    // que el encabezado, cada dato puede estar en su sitio (el corrimiento
    // fue después) o desplazado (fue antes): se leen los dos y se acepta solo
    // si dan UNA respuesta. Con las mismas celdas también pasa —un dato
    // partido y otra celda vacía de menos al final, como «HIJO DE
    // ANGIE;VERONICA» en Salud Total—, y lo delata el régimen fuera de su
    // columna.
    const shift = cells.length - expectedColumnCount;
    const offsets = shift === 0 ? [0] : [0, shift];
    const sizeNote = `La fila trae ${cells.length} columna(s) y el encabezado define ${expectedColumnCount}`;

    // ── régimen (opcional) — va primero: es el que delata la fila corrida ──
    let regime: PadronRegime | null = null;
    let regimeOffset = 0;
    let regimeError: string | null = null;
    if (cols.regimen !== null) {
      const ri = cols.regimen;
      const raw0 = at(ri, 0);
      // En una fila corrida solo cuenta la palabra completa: «SUB» puede ser
      // el pedazo de un dato partido.
      const read = (offset: number) => (shift !== 0 ? regimeWord(at(ri, offset)) : normalizeRegime(at(ri, offset)));
      let readings = offsets
        .map((offset) => ({ offset, regime: read(offset) }))
        .filter((r): r is { offset: number; regime: PadronRegime } => r.regime !== null);
      // Aunque su celda venga vacía: si el corrimiento le puso ahí una celda
      // vacía (un teléfono sin dato), el régimen quedó al lado.
      if (readings.length === 0) {
        for (const offset of ROW_SHIFT_SEARCH) {
          if (offsets.includes(offset)) continue;
          const found = regimeWord(at(ri, offset));
          if (found) {
            offsets.push(offset);
            readings = [{ offset, regime: found }];
            break;
          }
        }
      }
      const distinct = [...new Set(readings.map((r) => r.regime))];
      if (distinct.length === 1) {
        regime = distinct[0];
        regimeOffset = readings[0].offset;
      } else if (distinct.length > 1) {
        regimeError = `${sizeNote}, y trae SUBSIDIADO y CONTRIBUTIVO en celdas distintas: no se puede saber cuál es su régimen.`;
      } else if (offsets.some((offset) => at(ri, offset))) {
        regimeError =
          shift === 0
            ? `Régimen no reconocido "${raw0}": use SUBSIDIADO o CONTRIBUTIVO.`
            : `${sizeNote}, y el régimen (SUBSIDIADO o CONTRIBUTIVO) no está ni en su columna ni en las vecinas.`;
      }
    }

    // ── cédula (obligatoria) ──
    // Leída de una columna vecina, la celda tiene que ser un documento y nada
    // más: «CR 5 N536» o un celular también tienen dígitos.
    const ci = cols.cedula;
    const cedulaReadings = offsets
      .map((offset) => ({ offset, raw: at(ci, offset), cedula: normalizeDocumento(at(ci, offset)) }))
      .filter((r) => esDocumentoValido(r.cedula) && (r.offset === 0 || /^[\d.\s-]+$/.test(r.raw)));
    const distinctCedulas = [...new Set(cedulaReadings.map((r) => r.cedula))];
    const rawCedula = at(ci, 0);

    // Ni cédula inválida ni duplicada bloquean el archivo entero: son
    // información, no un error que obligue a editar el CSV a mano. Los
    // padrones reales de la EPS traen basura real — filas de pie de página
    // que el exportador de Excel arrastra como si fueran datos ("NOMBRE DE
    // LA IPS", el nombre del hospital repetido al final) tienen "cédula" no
    // numérica y, sin esto, tumbaban la carga de miles de filas buenas por
    // dos líneas de relleno al final del archivo. La fila se ignora igual
    // (no entra a `validRows`, no hay cédula válida con la que importarla),
    // pero el usuario decide si el resto del archivo se importa tal cual.
    if (distinctCedulas.length === 0) {
      warnings.push({
        line,
        column: 'cedula',
        message: `Cédula inválida "${rawCedula}": debe tener entre 4 y 15 dígitos y no ser solo ceros; esta línea se ignora.`,
        rawCedula: rawCedula || undefined,
        kind: 'INVALIDA',
      });
      continue;
    }
    if (distinctCedulas.length > 1) {
      errors.push({
        line,
        column: 'cedula',
        message: `${sizeNote}, y la cédula puede ser "${distinctCedulas[0]}" o "${distinctCedulas[1]}": no se puede saber cuál. Revise si un dato de esa fila trae un «${delimiter}» de más o de menos.`,
        rawCedula: rawCedula || undefined,
      });
      continue;
    }
    const cedula = distinctCedulas[0];
    const cedulaOffset = cedulaReadings[0].offset;

    if (regimeError) {
      errors.push({ line, column: 'regimen', message: regimeError, ...(rawCedula ? { rawCedula } : {}) });
      continue;
    }

    const firstLine = seenCedulas.get(cedula);
    if (firstLine !== undefined) {
      warnings.push({
        line,
        column: 'cedula',
        message: `Cédula ${cedula} duplicada en el archivo (ya aparece en la línea ${firstLine}); esta línea se ignora.`,
        // A diferencia de los errores (donde rawCedula es el texto crudo de
        // la celda, sin normalizar), acá SÍ es la cédula normalizada: ya
        // pasó esDocumentoValido, y así el log de importación puede
        // mostrarla como cédula real en vez de "sin forma válida".
        rawCedula: cedula,
        kind: 'DUPLICADA',
      });
      continue;
    }
    seenCedulas.set(cedula, line);

    // ── teléfono (opcional, y con mucha basura real en los padrones de EPS:
    // "0", "2000000", fijos viejos de 7 dígitos). Se revisan todas las
    // columnas de teléfono en orden y gana el primer celular; si no hay, el
    // primer fijo. Nunca es motivo para rechazar la fila — la cédula ya la
    // identifica. En una fila corrida, si las lecturas no coinciden, queda
    // sin teléfono (no se borra el que ya tenía: ver el COALESCE del
    // importador).
    const phoneAt = (offset: number): string | null => {
      let fixed: string | null = null;
      for (const idx of cols.telefono) {
        const found = normalizePadronPhone(at(idx, offset));
        if (found?.mobile) return found.phone;
        if (found && !fixed) fixed = found.phone;
      }
      return fixed;
    };
    const phoneReadings = offsets
      .map((offset) => ({ offset, phone: phoneAt(offset) }))
      .filter((r): r is { offset: number; phone: string } => r.phone !== null);
    const distinctPhones = [...new Set(phoneReadings.map((r) => r.phone))];
    const phone = distinctPhones.length === 1 ? distinctPhones[0] : null;
    const phoneOffset = phone === null ? 0 : phoneReadings[0].offset;

    const moved = [
      cedulaOffset !== 0 && 'la cédula',
      regimeOffset !== 0 && 'el régimen',
      phoneOffset !== 0 && 'el teléfono',
    ].filter((item): item is string => !!item);
    const row: PadronCsvRow = { line, cedula, regime, phone };
    if (moved.length > 0) {
      row.repair =
        shift === 0
          ? `La fila viene corrida (un dato partido en dos celdas): se tomó ${joinWithY(moved)} de la columna vecina.`
          : `${sizeNote}: se tomó ${joinWithY(moved)} de donde quedó corrido.`;
    }
    validRows.push(row);
  }

  if (totalDataRows === 0) {
    errors.push({
      line: headerLineIndex + 1,
      message: 'El archivo no contiene filas de afiliados (solo encabezado).',
    });
  }

  return {
    ok: errors.length === 0 && totalDataRows > 0,
    fileError: totalDataRows === 0 || tooManyRows,
    totalDataRows,
    validRows,
    errors,
    warnings,
    delimiter,
    ignoredPreambleLines,
    columns,
  };
}
