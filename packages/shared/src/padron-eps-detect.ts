// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — detección automática de la EPS de un archivo.
//
// La EPS de un archivo la elige siempre la persona en la pantalla (un
// archivo = una EPS, ver padron-csv.ts) — esto NUNCA decide por sí solo ni
// importa nada. Solo PRE-SELECCIONA el selector cuando encuentra una
// coincidencia inequívoca, para que quien carga el archivo la revise y
// confirme en vez de tener que buscarla manualmente.
//
// Los candidatos SIEMPRE vienen de la lista de EPS activas de la clínica que
// ya alimenta el selector (ver getActiveEpsOptionsAction) — hoy son solo dos
// para el hospital piloto, pero esto no depende de una lista fija: el
// candidato válido es, por definición, "una EPS autorizada" porque es una de
// las que la clínica ya tiene activas.
//
// Dos fuentes, en orden de confianza:
//   1) Una columna tipo `eps`/`aseguradora` en el archivo: se toma el valor
//      más frecuente entre las filas de datos.
//   2) El nombre del archivo (p. ej. "Base de Datos Salud total 10-08-2026").
//
// Si cualquiera de las dos fuentes coincide con MÁS de una EPS candidata (o
// con ninguna), se devuelve null: mejor no adivinar que adivinar mal.
// ─────────────────────────────────────────────────────────────

import { detectDelimiter, normalizeForMatch, splitCsvLine } from './padron-csv';

export interface PadronEpsCandidate {
  id: string;
  name: string;
}

export interface PadronEpsDetection {
  eps: PadronEpsCandidate;
  /** De dónde salió la coincidencia — se muestra en pantalla para que se pueda verificar. */
  source: 'columna del archivo' | 'nombre del archivo';
}

const EPS_COLUMN_ALIASES = [
  'eps',
  'aseguradora',
  'entidad',
  'nombre eps',
  'nombre de la eps',
  'eps afiliado',
];

/** Líneas iniciales donde se busca una columna tipo `eps`/`aseguradora`. */
const HEADER_SEARCH_MAX_LINES = 25;
/** Filas de datos que se muestrean para hallar el valor más frecuente de esa columna. */
const SAMPLE_DATA_ROWS = 200;

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, '');
}

/** Candidatos cuyo nombre normalizado coincide (igual o contenido) con `text`. */
function matchCandidates(text: string, candidates: PadronEpsCandidate[]): PadronEpsCandidate[] {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) return [];
  return candidates.filter((candidate) => {
    const normalizedName = normalizeForMatch(candidate.name);
    if (!normalizedName) return false;
    return normalizedText.includes(normalizedName) || normalizedName.includes(normalizedText);
  });
}

/** Busca una columna tipo `eps` en las primeras líneas y toma su valor más frecuente. */
function detectFromColumn(
  csvText: string,
  candidates: PadronEpsCandidate[],
): PadronEpsCandidate | null {
  const lines = csvText.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const scanLimit = Math.min(lines.length, HEADER_SEARCH_MAX_LINES);

  for (let h = 0; h < scanLimit; h++) {
    const headerLine = lines[h];
    if (!headerLine || !headerLine.trim()) continue;

    const delimiter = detectDelimiter(headerLine);
    const headerCells = splitCsvLine(headerLine, delimiter);
    const epsColumnIndex = headerCells.findIndex((cell) =>
      EPS_COLUMN_ALIASES.includes(normalizeForMatch(cell)),
    );
    if (epsColumnIndex === -1) continue;

    const counts = new Map<string, number>();
    let sampled = 0;
    let nonEmpty = 0;
    for (let i = h + 1; i < lines.length && sampled < SAMPLE_DATA_ROWS; i++) {
      const rawLine = lines[i];
      if (!rawLine || !rawLine.trim()) continue;
      sampled++;
      const cells = splitCsvLine(rawLine, delimiter);
      const value = (cells[epsColumnIndex] ?? '').trim();
      if (!value) continue;
      nonEmpty++;
      const key = normalizeForMatch(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    if (counts.size === 0) return null; // había columna eps pero venía vacía: no adivinar

    let bestKey = '';
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestKey = key;
        bestCount = count;
      }
    }

    // Solo se confía en el valor dominante si es una MAYORÍA real de las
    // celdas con dato (no un empate entre varios valores distintos, p. ej.
    // un archivo consolidado con filas de EPS distintas mezcladas): adivinar
    // sobre un empate es peor que no adivinar.
    if (bestCount / nonEmpty <= 0.5) return null;

    const matches = matchCandidates(bestKey, candidates);
    return matches.length === 1 ? matches[0] : null;
  }

  return null; // ninguna línea escaneada trae una columna reconocible como EPS
}

/**
 * Intenta identificar a cuál de las EPS activas de la clínica corresponde el
 * archivo. Nunca lanza y nunca decide por ambigüedad: solo devuelve una
 * coincidencia cuando es inequívoca.
 */
export function detectPadronEps(
  csvText: string,
  fileName: string,
  candidates: PadronEpsCandidate[],
): PadronEpsDetection | null {
  if (candidates.length === 0) return null;

  const fromColumn = detectFromColumn(csvText, candidates);
  if (fromColumn) return { eps: fromColumn, source: 'columna del archivo' };

  const fromFileNameMatches = matchCandidates(stripExtension(fileName), candidates);
  if (fromFileNameMatches.length === 1) {
    return { eps: fromFileNameMatches[0], source: 'nombre del archivo' };
  }

  return null;
}
