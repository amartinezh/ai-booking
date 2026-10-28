/**
 * Parser determinista de la "hora preferida" que el paciente expresa en
 * lenguaje natural ("a las 3", "3 de la tarde", "15:30", "a las 9 y media")
 * hacia una hora de reloj comparable contra `ScheduleSlot.startTime`.
 *
 * Hermano de `parse-fecha-preferida.ts`: el LLM transcribe el audio a texto
 * natural (`transcript`), pero la RESOLUCIÓN a una hora concreta y el match
 * contra la agenda real ocurren en el servidor. Así la voz recorre el mismo
 * camino determinista que el texto y no dependemos de que el modelo "adivine".
 *
 * Regla de oro (igual que la fecha): si la frase no se reconoce con confianza,
 * devolvemos `null`. El consumidor interpreta `null` como "sin preferencia de
 * hora" y cae al comportamiento actual (ofrecer los próximos cupos).
 *
 * Ambigüedad AM/PM: cuando el paciente NO marca franja ("a las 3", sin "de la
 * tarde"), no adivinamos aquí. Devolvemos `meridiemKnown: false` y dejamos que
 * `matchesHora` acepte tanto la lectura de 12h como su +12h; el match contra la
 * agenda real desambigua (una clínica no tiene cupos a las 3 a. m.). Si resulta
 * ambiguo contra la agenda, el flujo simplemente cae a listar cupos: nunca
 * agenda a ciegas.
 */

import { DEFAULT_TIMEZONE } from './date-format';

export interface HoraPreferida {
  /** Hora en formato 24h (0-23) de la interpretación primaria. */
  hour24: number;
  /** Minuto (0-59), o `null` cuando el paciente no lo precisó ("a las 3"). */
  minute: number | null;
  /**
   * `true` si el paciente marcó franja de forma inequívoca ("de la tarde",
   * "p. m.", "de la mañana"). Si es `false`, `matchesHora` acepta también la
   * lectura +12h para desambiguar contra la agenda real.
   */
  meridiemKnown: boolean;
}

export interface HoraMatchOptions {
  /** IANA timezone. Default = `America/Bogota`. */
  timeZone?: string;
}

/** Números escritos en palabras (voz) → dígito. Cubre 0-24 de forma laxa. */
const NUM_WORDS: Record<string, number> = {
  cero: 0,
  una: 1,
  un: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuna: 21,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
};

/**
 * Minutos en palabras, para «dos y cuarenta» (2026-10-28). «Cuarenta y cinco»
 * llega aquí como «cuarentaycinco» (ver `normalize`).
 */
const MINUTE_WORDS: Record<string, number> = {
  cinco: 5,
  diez: 10,
  quince: 15,
  veinte: 20,
  veinticinco: 25,
  treinta: 30,
  treintaycinco: 35,
  cuarenta: 40,
  cuarentaycinco: 45,
  cincuenta: 50,
  cincuentaycinco: 55,
};

/**
 * Minúsculas, sin acentos, espacios colapsados. Y lo que el paciente teclea de
 * afán (2026-10-28, frases reales del menú de cupos): «9am» y «3:00pm» con la
 * franja pegada, «alas 9» por «a las 9», «11;20» con punto y coma.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\b(\d{1,2})[;,](\d{2})\b/g, '$1:$2')
    .replace(/\balas\b/g, 'a las')
    .replace(/\b(treinta|cuarenta|cincuenta)\s+y\s+cinco\b/g, '$1ycinco')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte un token numérico ("3" o "tres") a número, o `null`. */
function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (token in NUM_WORDS) return NUM_WORDS[token];
  return null;
}

/** Los minutos de «y cuarenta», «y 20»: número o palabra. */
function toMinute(token: string | undefined): number | null {
  if (token && token in MINUTE_WORDS) return MINUTE_WORDS[token];
  return toNumber(token);
}

/**
 * Detecta la franja horaria explícita en la frase.
 *   'am'  → mañana / madrugada
 *   'pm'  → tarde / noche
 *   null  → el paciente no la marcó
 * Solo cuenta como franja cuando aparece como inciso ("de/por/en la tarde") o
 * como sufijo de reloj ("a m"/"p m"/"am"/"pm"); así "mañana" (día siguiente)
 * NO se confunde con "de la mañana".
 */
function detectMeridiem(norm: string): 'am' | 'pm' | null {
  if (/\b(de|por|en)\s+la\s+(tarde|noche)\b/.test(norm)) return 'pm';
  if (/\b(de|por|en)\s+la\s+(manana|madrugada)\b/.test(norm)) return 'am';
  if (/\bp\.?\s*m\.?\b/.test(norm)) return 'pm';
  if (/\ba\.?\s*m\.?\b/.test(norm)) return 'am';
  return null;
}

/** Aplica la franja a una hora de 12h para llevarla a 24h. */
function applyMeridiem(hour: number, meridiem: 'am' | 'pm'): number {
  if (meridiem === 'pm') return hour === 12 ? 12 : hour + 12;
  // am
  return hour === 12 ? 0 : hour;
}

/**
 * Convierte la frase del paciente en una hora de reloj, o `null` si no se
 * reconoce con confianza.
 */
export function parseHoraPreferida(
  natural: string | null | undefined,
): HoraPreferida | null {
  if (!natural) return null;
  const norm = normalize(natural);
  if (!norm) return null;

  const meridiem = detectMeridiem(norm);

  // ── Expresiones especiales ───────────────────────────────────
  if (/\bmedio\s?dia\b/.test(norm)) {
    return { hour24: 12, minute: 0, meridiemKnown: true };
  }
  if (/\bmedia\s?noche\b/.test(norm)) {
    return { hour24: 0, minute: 0, meridiemKnown: true };
  }

  // ── Reloj explícito "HH:MM" / "HH.MM" ────────────────────────
  const reloj = norm.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (reloj) {
    const h = Number(reloj[1]);
    const mi = Number(reloj[2]);
    if (h > 23 || mi > 59) return null;
    // Con franja explícita reinterpretamos como 12h; sin ella respetamos el
    // valor tal cual (un "15:30" ya es inequívoco).
    if (meridiem && h >= 1 && h <= 12) {
      return { hour24: applyMeridiem(h, meridiem), minute: mi, meridiemKnown: true };
    }
    return { hour24: h, minute: mi, meridiemKnown: h > 12 || meridiem != null };
  }

  // ── "HH y media" / "HH y cuarto" / "HH y MM" ─────────────────
  const conFraccion = norm.match(
    /\b(\d{1,2}|[a-z]+)\s+y\s+(media|cuarto|\d{1,2}|[a-z]+)\b/,
  );
  if (conFraccion) {
    const h = toNumber(conFraccion[1]);
    if (h != null && h <= 23) {
      let mi: number | null = null;
      if (conFraccion[2] === 'media') mi = 30;
      else if (conFraccion[2] === 'cuarto') mi = 15;
      else mi = toMinute(conFraccion[2]);
      if (mi != null && mi <= 59) {
        return finalize(h, mi, meridiem);
      }
    }
  }

  // ── "a las 7 50", "jueves 7 50": hora y minutos separados por un espacio ──
  // Solo detrás de «a las» o de un día: «7 50» suelto puede ser cualquier cosa.
  const conEspacio = norm.match(
    /\b(?:a\s+las?|las|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)\s+(\d{1,2})\s+([0-5]\d)\b/,
  );
  if (conEspacio) {
    const h = Number(conEspacio[1]);
    if (h <= 23) return finalize(h, Number(conEspacio[2]), meridiem);
  }

  // ── "a las 930", "jueves 29 750": la hora sin separador ──────
  const compacta = norm.match(
    /\b(?:a\s+las?|las|(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+\d{1,2})\s+(\d{1,2})([0-5]\d)\b/,
  );
  if (compacta) {
    const h = Number(compacta[1]);
    if (h <= 23) return finalize(h, Number(compacta[2]), meridiem);
  }

  // ── "a la(s) HH" / "las HH" ──────────────────────────────────
  // Exigimos "a la", "a las" o "las" para no confundir el artículo "la"
  // ("la quiero...") con una hora.
  const conLas = norm.match(/\b(?:a\s+las?|las)\s+(\d{1,2}|[a-z]+)\b/);
  if (conLas) {
    const h = toNumber(conLas[1]);
    if (h != null && h <= 23) return finalize(h, null, meridiem);
  }

  // ── Número suelto acompañado de franja explícita ─────────────
  // "3 de la tarde", "3 pm", "tres de la tarde": la franja da el contexto de
  // que ese número es una hora (sin ella, un dígito suelto es demasiado
  // ambiguo y devolvemos null).
  if (meridiem) {
    const digito = norm.match(/\b(\d{1,2})\b/);
    if (digito) {
      const h = Number(digito[1]);
      if (h <= 23) return finalize(h, null, meridiem);
    }
    for (const [word, val] of Object.entries(NUM_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(norm)) {
        return finalize(val, null, meridiem);
      }
    }
  }

  return null;
}

/** Construye el `HoraPreferida` aplicando (o no) la franja detectada. */
function finalize(
  hour: number,
  minute: number | null,
  meridiem: 'am' | 'pm' | null,
): HoraPreferida {
  if (meridiem && hour >= 1 && hour <= 12) {
    return { hour24: applyMeridiem(hour, meridiem), minute, meridiemKnown: true };
  }
  return { hour24: hour, minute, meridiemKnown: hour > 12 || meridiem != null };
}

/** Hora/minuto de pared de `date` en `timeZone`. */
function wallHourMinute(
  date: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return { hour, minute: Number(map.minute) };
}

/**
 * ¿El instante `date` cae en la hora preferida `hora`?
 * - El minuto solo se exige cuando el paciente lo precisó (`hora.minute`).
 * - Si la franja NO era inequívoca (`meridiemKnown === false`), se acepta tanto
 *   la lectura de 12h como su +12h; el match contra la agenda real desambigua.
 */
export function matchesHora(
  date: Date,
  hora: HoraPreferida,
  opts: HoraMatchOptions = {},
): boolean {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const { hour, minute } = wallHourMinute(date, tz);

  const acceptableHours = new Set<number>([hora.hour24]);
  if (!hora.meridiemKnown && hora.hour24 >= 1 && hora.hour24 <= 11) {
    acceptableHours.add(hora.hour24 + 12);
  }

  if (!acceptableHours.has(hour)) return false;
  if (hora.minute != null && minute !== hora.minute) return false;
  return true;
}
