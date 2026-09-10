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
  /** null si el archivo no la trae o la celda viene vacía (columna opcional). */
  phone: string | null;
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
}

export interface PadronCsvReport {
  /** true sólo si el archivo tiene al menos una fila y CERO errores. */
  ok: boolean;
  totalDataRows: number;
  validRows: PadronCsvRow[];
  errors: PadronCsvError[];
  delimiter: ',' | ';';
  /**
   * Líneas antes del encabezado real que se ignoraron (título del reporte,
   * líneas en blanco, etc.). 0 en el caso normal (encabezado en la línea 1).
   */
  ignoredPreambleLines: number;
}

/** Columnas del formato oficial (encabezado de la plantilla descargable). */
export const PADRON_CSV_HEADERS = ['cedula', 'regimen', 'telefono'] as const;

type CanonicalHeader = (typeof PADRON_CSV_HEADERS)[number];

// Aliases tolerados por columna (comparados sin tildes ni mayúsculas).
const HEADER_ALIASES: Record<CanonicalHeader, string[]> = {
  cedula: [
    'cedula',
    'documento',
    'dni',
    'identificacion',
    'numero de documento',
    'numero de identificacion',
  ],
  regimen: ['regimen', 'tipo de afiliacion', 'tipo afiliacion', 'tipoafiliacion'],
  telefono: ['telefono', 'celular', 'whatsapp', 'movil', 'telefonomovil'],
};

const REQUIRED_HEADERS: CanonicalHeader[] = ['cedula'];

/** Tope defensivo de filas de datos por archivo (protege memoria/tiempo de respuesta). */
const MAX_DATA_ROWS = 20_000;

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

/** Mapea el encabezado del archivo a las columnas canónicas. */
function mapHeader(
  cells: string[],
): { indexOf: Partial<Record<CanonicalHeader, number>>; missing: CanonicalHeader[] } {
  const indexOf: Partial<Record<CanonicalHeader, number>> = {};
  cells.forEach((cell, idx) => {
    const normalized = normalizeForMatch(cell);
    for (const canonical of PADRON_CSV_HEADERS) {
      if (indexOf[canonical] === undefined && HEADER_ALIASES[canonical].includes(normalized)) {
        indexOf[canonical] = idx;
        break;
      }
    }
  });
  const missing = REQUIRED_HEADERS.filter((h) => indexOf[h] === undefined);
  return { indexOf, missing };
}

function normalizeRegime(raw: string): PadronRegime | null {
  const value = normalizeForMatch(raw);
  if (['subsidiado', 'sub', 's'].includes(value)) return 'SUBSIDIADO';
  if (['contributivo', 'contrib', 'c'].includes(value)) return 'CONTRIBUTIVO';
  return null;
}

/**
 * Valida a fondo el CSV del padrón. Nunca lanza: todos los problemas se
 * devuelven como errores por línea.
 *
 * NO recibe el catálogo de EPS: la EPS del archivo se elige en la pantalla
 * (un archivo = una EPS), no se lee de una columna.
 */
export function validatePadronCsv(csvText: string): PadronCsvReport {
  const errors: PadronCsvError[] = [];
  const validRows: PadronCsvRow[] = [];

  // ── Defensa en profundidad: archivo binario disfrazado de .csv ──
  // El filtro fuerte (bytes crudos) va en el cliente antes de leer el
  // archivo como texto; esto solo cubre llamadas directas a esta función
  // (scripts, tests, futura API) que se salten esa capa.
  const binaryLabel = detectBinarySignature(csvText);
  if (binaryLabel) {
    return {
      ok: false,
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
    };
  }

  const lines = csvText
    .replace(/^﻿/, '') // BOM de Excel
    .split(/\r\n|\r|\n/);

  if (!lines.some((l) => l.trim())) {
    return {
      ok: false,
      totalDataRows: 0,
      validRows: [],
      errors: [{ line: 1, message: 'El archivo está vacío o no tiene encabezado.' }],
      delimiter: ',',
      ignoredPreambleLines: 0,
    };
  }

  // ── Encabezado: puede no estar en la primera línea ──
  // Los padrones reales a veces traen basura antes del encabezado real
  // (título del reporte, fecha de corte, líneas en blanco de un export de
  // Excel). Se escanean las primeras HEADER_SEARCH_MAX_LINES buscando la
  // primera que ya traiga la columna obligatoria (cedula); esa se usa como
  // encabezado y todo lo anterior se ignora sin penalizar el archivo. Si
  // ninguna línea del rango calza, se cae al comportamiento de siempre
  // (primera línea no vacía = encabezado) para dar el mensaje de columnas
  // faltantes de siempre.
  let headerLineIndex = -1;
  let delimiter: ',' | ';' = ',';
  let headerCells: string[] = [];
  let indexOf: Partial<Record<CanonicalHeader, number>> = {};
  let missing: CanonicalHeader[] = REQUIRED_HEADERS;

  const scanLimit = Math.min(lines.length, HEADER_SEARCH_MAX_LINES);
  for (let h = 0; h < scanLimit; h++) {
    const candidateLine = lines[h];
    if (!candidateLine || !candidateLine.trim()) continue;

    const candidateDelimiter = detectDelimiter(candidateLine);
    const candidateCells = splitCsvLine(candidateLine, candidateDelimiter);
    const candidateMap = mapHeader(candidateCells);

    if (headerLineIndex === -1) {
      // Primera línea no vacía: candidato por defecto si ninguna calza mejor
      // (preserva el mensaje histórico de "faltan columnas").
      headerLineIndex = h;
      delimiter = candidateDelimiter;
      headerCells = candidateCells;
      indexOf = candidateMap.indexOf;
      missing = candidateMap.missing;
    }

    if (candidateMap.missing.length === 0) {
      headerLineIndex = h;
      delimiter = candidateDelimiter;
      headerCells = candidateCells;
      indexOf = candidateMap.indexOf;
      missing = candidateMap.missing;
      break;
    }
  }

  if (missing.length > 0) {
    // Un archivo con muchos caracteres de reemplazo casi nunca es un CSV de
    // texto real (más probable: binario que no coincidió con ninguna firma
    // conocida, o guardado en una codificación completamente distinta).
    // Esto NO decide el resultado (ya era inválido por encabezado faltante),
    // solo aclara la causa raíz probable.
    const encodingHint =
      replacementCharDensity(csvText) > 0.2
        ? ' El archivo contiene numerosos caracteres no reconocibles: verifique que se haya guardado como texto CSV en codificación UTF-8 y no como un formato binario u otra codificación.'
        : '';
    return {
      ok: false,
      totalDataRows: 0,
      validRows: [],
      errors: [
        {
          line: headerLineIndex + 1,
          message: `Faltan columnas obligatorias en el encabezado: ${missing.join(', ')}. Encabezado esperado: ${PADRON_CSV_HEADERS.join(delimiter)}${encodingHint}`,
        },
      ],
      delimiter,
      ignoredPreambleLines: 0,
    };
  }

  const ignoredPreambleLines = headerLineIndex;
  const seenCedulas = new Map<string, number>(); // cédula → línea donde apareció
  let totalDataRows = 0;
  const expectedColumnCount = headerCells.length;

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = i + 1; // 1-based
    const rawLine = lines[i];
    if (!rawLine.trim()) continue; // líneas vacías (típico al final) se ignoran

    totalDataRows++;

    if (totalDataRows > MAX_DATA_ROWS) {
      errors.push({
        line,
        message: `El archivo supera el máximo de ${MAX_DATA_ROWS} filas de datos por importación. Divídalo en archivos más pequeños y vuelva a intentarlo.`,
      });
      break;
    }

    const cells = splitCsvLine(rawLine, delimiter);

    // ── Conteo de columnas ──
    // Una fila con más o menos columnas que el encabezado casi siempre
    // delata una coma/punto y coma suelto sin comillas, o una comilla sin
    // cerrar más arriba en el archivo: seguir validando campo por campo
    // sobre datos desalineados solo produciría errores confusos y engañosos.
    // Se reporta un único error claro por fila y se pasa a la siguiente.
    if (cells.length !== expectedColumnCount) {
      errors.push({
        line,
        message: `La fila tiene ${cells.length} columna(s) pero el encabezado define ${expectedColumnCount}. Revise si falta o sobra una coma/punto y coma, o si hay una comilla sin cerrar en esta fila o en una anterior.`,
      });
      continue;
    }

    const cell = (h: CanonicalHeader): string =>
      indexOf[h] !== undefined ? (cells[indexOf[h]!] ?? '') : '';

    const rowErrors: PadronCsvError[] = [];

    // ── cédula (obligatoria) ──
    const cedula = normalizeDocumento(cell('cedula'));
    if (!esDocumentoValido(cedula)) {
      rowErrors.push({
        line,
        column: 'cedula',
        message: `Cédula inválida "${cell('cedula')}": debe tener entre 4 y 15 dígitos y no ser solo ceros.`,
      });
    } else {
      const firstLine = seenCedulas.get(cedula);
      if (firstLine !== undefined) {
        rowErrors.push({
          line,
          column: 'cedula',
          message: `Cédula ${cedula} duplicada en el archivo (ya aparece en la línea ${firstLine}).`,
        });
      } else {
        seenCedulas.set(cedula, line);
      }
    }

    // ── régimen (opcional) ──
    let regime: PadronRegime | null = null;
    const regimeRaw = cell('regimen');
    if (regimeRaw) {
      regime = normalizeRegime(regimeRaw);
      if (!regime) {
        rowErrors.push({
          line,
          column: 'regimen',
          message: `Régimen no reconocido "${regimeRaw}": use SUBSIDIADO o CONTRIBUTIVO.`,
        });
      }
    }

    // ── teléfono (opcional) ──
    let phone: string | null = null;
    const phoneRaw = cell('telefono');
    if (phoneRaw) {
      const digits = phoneRaw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
      if (!/^\d{7,15}$/.test(digits)) {
        rowErrors.push({
          line,
          column: 'telefono',
          message: `Teléfono inválido "${phoneRaw}": debe tener entre 7 y 15 dígitos.`,
        });
      } else {
        phone = digits;
      }
    }

    if (rowErrors.length > 0) {
      const rawCedula = cell('cedula');
      errors.push(...rowErrors.map((e) => (rawCedula ? { ...e, rawCedula } : e)));
    } else {
      validRows.push({ line, cedula, regime, phone });
    }
  }

  if (totalDataRows === 0) {
    errors.push({
      line: headerLineIndex + 1,
      message: 'El archivo no contiene filas de afiliados (solo encabezado).',
    });
  }

  return {
    ok: errors.length === 0 && totalDataRows > 0,
    totalDataRows,
    validRows,
    errors,
    delimiter,
    ignoredPreambleLines,
  };
}
