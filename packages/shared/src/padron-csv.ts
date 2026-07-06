// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — Parser y validador del CSV de pacientes dados de alta.
//
// Lógica 100% pura (sin I/O, sin Prisma): recibe el texto del archivo y el
// catálogo de EPS activas de la clínica, y devuelve un reporte detallado con
// las filas normalizadas válidas y los errores por línea. La pantalla de
// importación llama esto dos veces (regla de oro): al VALIDAR y de nuevo al
// IMPORTAR, para que nunca entre a la base un archivo alterado entre pasos.
// ─────────────────────────────────────────────────────────────

export interface PadronCsvRow {
  /** Línea física en el archivo (1-based, contando el encabezado). */
  line: number;
  cedula: string;
  fullName: string;
  /** Nombre EXACTO de la EPS según el catálogo de la clínica (ya casado). */
  epsName: string;
  phone: string | null;
  email: string | null;
  /** Normalizada a ISO `yyyy-mm-dd`. */
  dateOfBirth: string | null;
  gender: 'M' | 'F' | 'OTRO' | null;
  address: string | null;
}

export interface PadronCsvError {
  line: number;
  column?: string;
  message: string;
}

export interface PadronCsvReport {
  /** true sólo si el archivo tiene al menos una fila y CERO errores. */
  ok: boolean;
  totalDataRows: number;
  validRows: PadronCsvRow[];
  errors: PadronCsvError[];
  delimiter: ',' | ';';
}

/** Columnas del formato oficial (encabezado de la plantilla descargable). */
export const PADRON_CSV_HEADERS = [
  'cedula',
  'nombre_completo',
  'eps',
  'telefono',
  'email',
  'fecha_nacimiento',
  'genero',
  'direccion',
] as const;

type CanonicalHeader = (typeof PADRON_CSV_HEADERS)[number];

// Aliases tolerados por columna (comparados sin tildes ni mayúsculas).
const HEADER_ALIASES: Record<CanonicalHeader, string[]> = {
  cedula: ['cedula', 'documento', 'dni', 'identificacion', 'numero de documento'],
  nombre_completo: ['nombre_completo', 'nombre completo', 'nombre', 'nombres'],
  eps: ['eps', 'aseguradora', 'convenio'],
  telefono: ['telefono', 'celular', 'whatsapp', 'movil'],
  email: ['email', 'correo', 'correo electronico'],
  fecha_nacimiento: ['fecha_nacimiento', 'fecha de nacimiento', 'nacimiento'],
  genero: ['genero', 'sexo'],
  direccion: ['direccion', 'domicilio'],
};

const REQUIRED_HEADERS: CanonicalHeader[] = ['cedula', 'nombre_completo', 'eps'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Minúsculas, sin tildes, espacios colapsados — para comparar texto humano. */
function normalizeForMatch(value: string): string {
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
function detectDelimiter(headerLine: string): ',' | ';' {
  const commas = headerLine.split(',').length;
  const semis = headerLine.split(';').length;
  return semis > commas ? ';' : ',';
}

/** Split de UNA línea CSV respetando comillas dobles (RFC 4180 básico). */
function splitCsvLine(line: string, delimiter: ',' | ';'): string[] {
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

/** Acepta `yyyy-mm-dd` o `dd/mm/yyyy` y normaliza a ISO. null = inválida. */
function normalizeDate(raw: string): string | null {
  let year: number, month: number, day: number;
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!valid || year < 1900 || date.getTime() > Date.now()) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalizeGender(raw: string): 'M' | 'F' | 'OTRO' | null {
  const value = normalizeForMatch(raw);
  if (['m', 'masculino', 'hombre'].includes(value)) return 'M';
  if (['f', 'femenino', 'mujer'].includes(value)) return 'F';
  if (['otro', 'o', 'other'].includes(value)) return 'OTRO';
  return null;
}

/**
 * Valida a fondo el CSV del padrón contra el catálogo de EPS activas.
 * Nunca lanza: todos los problemas se devuelven como errores por línea.
 */
export function validatePadronCsv(
  csvText: string,
  activeEpsNames: string[],
): PadronCsvReport {
  const errors: PadronCsvError[] = [];
  const validRows: PadronCsvRow[] = [];

  // Índice EPS normalizada → nombre exacto del catálogo.
  const epsByNormalized = new Map<string, string>();
  for (const name of activeEpsNames) {
    epsByNormalized.set(normalizeForMatch(name), name);
  }

  const lines = csvText
    .replace(/^﻿/, '') // BOM de Excel
    .split(/\r\n|\r|\n/);

  const headerLine = lines[0] ?? '';
  if (!headerLine.trim()) {
    return {
      ok: false,
      totalDataRows: 0,
      validRows: [],
      errors: [{ line: 1, message: 'El archivo está vacío o no tiene encabezado.' }],
      delimiter: ',',
    };
  }

  const delimiter = detectDelimiter(headerLine);
  const headerCells = splitCsvLine(headerLine, delimiter);
  const { indexOf, missing } = mapHeader(headerCells);

  if (missing.length > 0) {
    return {
      ok: false,
      totalDataRows: 0,
      validRows: [],
      errors: [
        {
          line: 1,
          message: `Faltan columnas obligatorias en el encabezado: ${missing.join(', ')}. Encabezado esperado: ${PADRON_CSV_HEADERS.join(delimiter)}`,
        },
      ],
      delimiter,
    };
  }

  const seenCedulas = new Map<string, number>(); // cédula → línea donde apareció
  let totalDataRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = i + 1; // 1-based
    const rawLine = lines[i];
    if (!rawLine.trim()) continue; // líneas vacías (típico al final) se ignoran

    totalDataRows++;
    const cells = splitCsvLine(rawLine, delimiter);
    const cell = (h: CanonicalHeader): string =>
      indexOf[h] !== undefined ? (cells[indexOf[h]!] ?? '') : '';

    const rowErrors: PadronCsvError[] = [];

    // ── cédula ──
    const cedula = cell('cedula').replace(/[.\s]/g, '');
    if (!/^\d{4,15}$/.test(cedula)) {
      rowErrors.push({
        line,
        column: 'cedula',
        message: `Cédula inválida "${cell('cedula')}": debe tener entre 4 y 15 dígitos.`,
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

    // ── nombre ──
    const fullName = cell('nombre_completo').replace(/\s+/g, ' ').trim();
    if (fullName.length < 3) {
      rowErrors.push({
        line,
        column: 'nombre_completo',
        message: 'El nombre completo es obligatorio (mínimo 3 caracteres).',
      });
    }

    // ── EPS ──
    const epsRaw = cell('eps');
    const epsMatched = epsByNormalized.get(normalizeForMatch(epsRaw));
    if (!epsRaw.trim()) {
      rowErrors.push({ line, column: 'eps', message: 'La EPS es obligatoria.' });
    } else if (!epsMatched) {
      rowErrors.push({
        line,
        column: 'eps',
        message: `La EPS "${epsRaw}" no existe o no está activa en el catálogo de la clínica.`,
      });
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

    // ── email (opcional) ──
    let email: string | null = null;
    const emailRaw = cell('email');
    if (emailRaw) {
      if (!EMAIL_REGEX.test(emailRaw)) {
        rowErrors.push({
          line,
          column: 'email',
          message: `Email inválido "${emailRaw}".`,
        });
      } else {
        email = emailRaw.toLowerCase();
      }
    }

    // ── fecha de nacimiento (opcional) ──
    let dateOfBirth: string | null = null;
    const dobRaw = cell('fecha_nacimiento');
    if (dobRaw) {
      dateOfBirth = normalizeDate(dobRaw);
      if (!dateOfBirth) {
        rowErrors.push({
          line,
          column: 'fecha_nacimiento',
          message: `Fecha de nacimiento inválida "${dobRaw}": use AAAA-MM-DD o DD/MM/AAAA (no futura).`,
        });
      }
    }

    // ── género (opcional) ──
    let gender: 'M' | 'F' | 'OTRO' | null = null;
    const genderRaw = cell('genero');
    if (genderRaw) {
      gender = normalizeGender(genderRaw);
      if (!gender) {
        rowErrors.push({
          line,
          column: 'genero',
          message: `Género inválido "${genderRaw}": use M, F u OTRO.`,
        });
      }
    }

    const address = cell('direccion').trim() || null;

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push({
        line,
        cedula,
        fullName,
        epsName: epsMatched!,
        phone,
        email,
        dateOfBirth,
        gender,
        address,
      });
    }
  }

  if (totalDataRows === 0) {
    errors.push({
      line: 1,
      message: 'El archivo no contiene filas de pacientes (solo encabezado).',
    });
  }

  return {
    ok: errors.length === 0 && totalDataRows > 0,
    totalDataRows,
    validRows,
    errors,
    delimiter,
  };
}
