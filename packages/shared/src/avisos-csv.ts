/**
 * AVISOS MASIVOS — Parser y validador del CSV/Excel de destinatarios.
 *
 * Ver docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §3.3.
 *
 * Lógica 100% pura (sin I/O, sin Prisma): recibe el TEXTO del archivo (ya
 * convertido a CSV en el navegador si venía de Excel — ver
 * `apps/web/lib/spreadsheet-upload.ts`, que reutiliza `xlsxToCsv()` de
 * `PadronUploader.tsx`) y devuelve un reporte con las filas normalizadas
 * válidas y los errores por línea. La pantalla llama esto dos veces, igual
 * que el padrón (regla de oro: nunca confiar en el paso anterior): al
 * VALIDAR y de nuevo al CARGAR.
 *
 * FORMATO MÍNIMO: `documento`, `telefono` y `fecha_hora_cita` son
 * obligatorias. `nombre` es opcional (cae a "Paciente" en el mensaje, igual
 * que `AppointmentReminderCronService.buildMessage()`). NO hay columna de
 * médico/servicio: se eligen una vez por lote en la pantalla, no se leen del
 * archivo — mismo criterio que la EPS en el padrón, y por la misma razón.
 *
 * Reutiliza el tokenizador de bajo nivel de `padron-csv.ts`
 * (`splitCsvLine`/`detectDelimiter`/`normalizeForMatch`, ya exportados) en
 * vez de duplicarlo. Lo que SÍ se repite aquí (detección de binario, escaneo
 * de preámbulo) es deliberado: son ~15 líneas cada uno y las reglas de
 * "columnas obligatorias" difieren de las del padrón — extraerlas habría
 * significado tocar un archivo de producción ya probado para ahorrar poco.
 */

import { esDocumentoValido, normalizeDocumento } from './documento';
import { detectDelimiter, normalizeForMatch, splitCsvLine } from './padron-csv';

export interface AvisosCsvRow {
  /** Línea física en el archivo (1-based, contando el encabezado). */
  line: number;
  /** Ya normalizado con `normalizeDocumento` — solo dígitos. */
  documento: string;
  /** `null` si la columna falta o la celda viene vacía (columna opcional). */
  nombre: string | null;
  /** E.164 colombiano, ej. "+573001234567". Siempre celular — nunca fijo. */
  phoneE164: string;
  /** Instante UTC de la cita, ya convertido desde la hora de pared en Bogotá. */
  appointmentAtUtc: Date;
}

export interface AvisosCsvError {
  line: number;
  column?: string;
  message: string;
  /**
   * Documento crudo (sin normalizar) de esa línea, cuando la fila alcanzó a
   * parsearse campo por campo. Mismo criterio que `PadronCsvError.rawCedula`:
   * permite trazar una fila rechazada sin guardar el resto de la fila.
   */
  rawDocumento?: string;
}

export interface AvisosCsvReport {
  /** `true` solo si el archivo tiene al menos una fila y CERO errores. */
  ok: boolean;
  totalDataRows: number;
  validRows: AvisosCsvRow[];
  errors: AvisosCsvError[];
  delimiter: ',' | ';';
  /** Líneas antes del encabezado real que se ignoraron. 0 en el caso normal. */
  ignoredPreambleLines: number;
}

/** Columnas del formato oficial (encabezado de la plantilla descargable). */
export const AVISOS_CSV_HEADERS = ['documento', 'nombre', 'telefono', 'fecha_hora_cita'] as const;

type CanonicalHeader = (typeof AVISOS_CSV_HEADERS)[number];

const HEADER_ALIASES: Record<CanonicalHeader, string[]> = {
  documento: [
    'documento',
    'cedula',
    'dni',
    'identificacion',
    'numero de documento',
    'numero de identificacion',
  ],
  nombre: ['nombre', 'nombre completo', 'nombre_completo', 'paciente', 'nombre paciente'],
  telefono: ['telefono', 'celular', 'whatsapp', 'movil', 'telefonomovil'],
  fecha_hora_cita: [
    'fecha_hora_cita',
    'fecha hora cita',
    'fecha cita',
    'fechacita',
    'fecha_cita',
    'fecha y hora',
    'fecha y hora de la cita',
  ],
};

const REQUIRED_HEADERS: CanonicalHeader[] = ['documento', 'telefono', 'fecha_hora_cita'];

/** Tope defensivo de filas de datos por archivo. Mismo criterio que el padrón. */
const MAX_DATA_ROWS = 2_000;

/**
 * Líneas iniciales que se escanean buscando el encabezado real — mismo
 * criterio que `padron-csv.ts`: un export de Excel puede traer 1-2 líneas de
 * basura (título, fecha de corte) antes del encabezado de verdad.
 */
const HEADER_SEARCH_MAX_LINES = 25;

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

function replacementCharDensity(text: string): number {
  const sample = text.slice(0, 500);
  if (!sample.length) return 0;
  let count = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0xfffd) count++;
  }
  return count / sample.length;
}

function mapHeader(
  cells: string[],
): { indexOf: Partial<Record<CanonicalHeader, number>>; missing: CanonicalHeader[] } {
  const indexOf: Partial<Record<CanonicalHeader, number>> = {};
  cells.forEach((cell, idx) => {
    const normalized = normalizeForMatch(cell);
    for (const canonical of AVISOS_CSV_HEADERS) {
      if (indexOf[canonical] === undefined && HEADER_ALIASES[canonical].includes(normalized)) {
        indexOf[canonical] = idx;
        break;
      }
    }
  });
  const missing = REQUIRED_HEADERS.filter((h) => indexOf[h] === undefined);
  return { indexOf, missing };
}

/**
 * Normaliza un teléfono a celular colombiano E.164. A diferencia del padrón
 * (que acepta 7-15 dígitos porque su teléfono es solo informativo), aquí el
 * teléfono es EL destinatario del WhatsApp: tiene que ser un celular real —
 * 10 dígitos, empieza por 3 — o el envío no tiene a quién llegarle.
 */
function normalizePhoneToE164Co(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  if (!/^3\d{9}$/.test(digits)) return null;
  return `+57${digits}`;
}

/**
 * Bogotá es UTC-5 todo el año, sin horario de verano (confirmado en el resto
 * del repo — ver `AppointmentReminderCronService`, "la matemática se hace en
 * America/Bogota, UTC-5 sin DST"). Construye el instante UTC a partir de la
 * hora de PARED en Bogotá, validando que la fecha calendario exista de verdad
 * (rechaza un "31 de abril" o un "30 de febrero").
 */
function bogotaWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  if (month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 5, minute, 0));
}

/** Días entre el epoch de Excel (1899-12-30) y el epoch de JS (1970-01-01). */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

/**
 * Convierte "fecha_hora_cita" a un instante UTC. Acepta dos formas:
 *
 *   1. Texto "YYYY-MM-DD HH:MM" (o con "T") — el formato documentado.
 *   2. Un número de serie de Excel — aparece cuando la celda del archivo
 *      original tenía formato de FECHA real (no texto) y `sheet_to_csv()` la
 *      vuelca como número crudo en vez de como texto formateado. Sin este
 *      camino, cualquier hospital que escriba la fecha "como fecha" en Excel
 *      (el caso más natural, no el menos) fallaría la validación siempre.
 */
function parseFechaHoraCita(raw: string): Date | null {
  const trimmed = raw.trim();

  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(trimmed);
  if (m) {
    return bogotaWallClockToUtc(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    );
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    const naiveUtcMs = Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * 86_400_000);
    const naive = new Date(naiveUtcMs);
    if (!Number.isNaN(naive.getTime())) {
      return bogotaWallClockToUtc(
        naive.getUTCFullYear(),
        naive.getUTCMonth() + 1,
        naive.getUTCDate(),
        naive.getUTCHours(),
        naive.getUTCMinutes(),
      );
    }
  }

  return null;
}

/**
 * Valida a fondo el CSV de avisos. Nunca lanza: todos los problemas se
 * devuelven como errores por línea.
 */
export function validateAvisosCsv(csvText: string): AvisosCsvReport {
  const errors: AvisosCsvError[] = [];
  const validRows: AvisosCsvRow[] = [];

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

  const lines = csvText.replace(/^﻿/, '').split(/\r\n|\r|\n/);

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
          message: `Faltan columnas obligatorias en el encabezado: ${missing.join(', ')}. Encabezado esperado: ${AVISOS_CSV_HEADERS.join(delimiter)}${encodingHint}`,
        },
      ],
      delimiter,
      ignoredPreambleLines: 0,
    };
  }

  const ignoredPreambleLines = headerLineIndex;
  // Clave de duplicado: documento + hora de la cita — la misma persona puede
  // legítimamente aparecer dos veces en el archivo si tiene dos citas
  // distintas ese día (dos servicios), así que duplicar solo por documento
  // habría rechazado filas válidas.
  const seenKeys = new Map<string, number>();
  let totalDataRows = 0;
  const expectedColumnCount = headerCells.length;

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = i + 1;
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;

    totalDataRows++;

    if (totalDataRows > MAX_DATA_ROWS) {
      errors.push({
        line,
        message: `El archivo supera el máximo de ${MAX_DATA_ROWS} filas de datos por lote. Divídalo en archivos más pequeños y vuelva a intentarlo — recuerde que esta función es para avisos puntuales, no para campañas masivas.`,
      });
      break;
    }

    const cells = splitCsvLine(rawLine, delimiter);

    if (cells.length !== expectedColumnCount) {
      errors.push({
        line,
        message: `La fila tiene ${cells.length} columna(s) pero el encabezado define ${expectedColumnCount}. Revise si falta o sobra una coma/punto y coma, o si hay una comilla sin cerrar en esta fila o en una anterior.`,
      });
      continue;
    }

    const cell = (h: CanonicalHeader): string =>
      indexOf[h] !== undefined ? (cells[indexOf[h]!] ?? '') : '';

    const rowErrors: AvisosCsvError[] = [];

    // ── documento (obligatorio) ──
    const documentoRaw = cell('documento');
    const documento = normalizeDocumento(documentoRaw);
    if (!esDocumentoValido(documento)) {
      rowErrors.push({
        line,
        column: 'documento',
        message: `Documento inválido "${documentoRaw}": debe tener entre 4 y 15 dígitos y no ser solo ceros.`,
      });
    }

    // ── nombre (opcional) ──
    const nombreRaw = cell('nombre').trim();
    const nombre = nombreRaw ? nombreRaw : null;

    // ── teléfono (obligatorio, celular) ──
    const phoneRaw = cell('telefono');
    const phoneE164 = phoneRaw ? normalizePhoneToE164Co(phoneRaw) : null;
    if (!phoneRaw) {
      rowErrors.push({
        line,
        column: 'telefono',
        message: 'Falta el teléfono: es obligatorio, no se puede enviar un WhatsApp sin él.',
      });
    } else if (!phoneE164) {
      rowErrors.push({
        line,
        column: 'telefono',
        message: `Teléfono inválido "${phoneRaw}": debe ser un celular colombiano de 10 dígitos que empiece por 3 (ej. 3001234567). Un fijo no puede recibir WhatsApp.`,
      });
    }

    // ── fecha_hora_cita (obligatoria) ──
    const fechaRaw = cell('fecha_hora_cita');
    const appointmentAtUtc = fechaRaw ? parseFechaHoraCita(fechaRaw) : null;
    if (!fechaRaw) {
      rowErrors.push({
        line,
        column: 'fecha_hora_cita',
        message: 'Falta la fecha y hora de la cita: es la llave que decide si ya se le había avisado antes.',
      });
    } else if (!appointmentAtUtc) {
      rowErrors.push({
        line,
        column: 'fecha_hora_cita',
        message: `Fecha/hora inválida "${fechaRaw}": use el formato AAAA-MM-DD HH:MM (ej. 2026-09-24 07:00).`,
      });
    }

    // ── duplicado (documento + hora de cita) ──
    if (documento && appointmentAtUtc && esDocumentoValido(documento)) {
      const key = `${documento}|${appointmentAtUtc.toISOString()}`;
      const firstLine = seenKeys.get(key);
      if (firstLine !== undefined) {
        rowErrors.push({
          line,
          message: `Documento ${documento} duplicado para la misma cita (ya aparece en la línea ${firstLine}).`,
        });
      } else {
        seenKeys.set(key, line);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((e) => (documentoRaw ? { ...e, rawDocumento: documentoRaw } : e)));
    } else {
      // rowErrors vacío garantiza que documento/phoneE164/appointmentAtUtc no son null.
      validRows.push({
        line,
        documento,
        nombre,
        phoneE164: phoneE164 as string,
        appointmentAtUtc: appointmentAtUtc as Date,
      });
    }
  }

  if (totalDataRows === 0) {
    errors.push({
      line: headerLineIndex + 1,
      message: 'El archivo no contiene filas de pacientes (solo encabezado).',
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
