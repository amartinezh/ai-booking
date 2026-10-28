/**
 * 🎯 Cómo elige el paciente un cupo del menú cuando no escribe solo la letra.
 *
 * POR QUÉ EXISTE (2026-10-28)
 * El diagnóstico del martes 27 y el miércoles 28 con las frases reales:
 *  · «Para las 3:30 el jueves» mostraba la tarde desde el principio (12:50,
 *    1:30, 2:30); una paciente preguntó seis veces hasta ver las 5:50.
 *  · «Miércoles 28 alas 9am con el doctor Santiago», «A las dos y cuarenta con
 *    el doctor Cárdenas»: dos cupos a esa hora y el asistente pedía la letra,
 *    aunque el paciente ya había dicho el médico.
 *  · «Perdón es B», «Laletra B»: la letra dentro de una frase no se leía, y a
 *    una paciente eso la sacó del agendamiento por demasiados intentos.
 *
 * Puro: sin base de datos ni Redis. Nunca adivina: si no hay una sola
 * respuesta, el asistente sigue pidiendo la letra.
 */
import { DEFAULT_TIMEZONE } from "./date-format";
import type { HoraPreferida } from "./parse-hora-preferida";

/** Minúsculas, sin tildes, sin signos, espacios colapsados. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minutos desde la medianoche de `fecha`, en la hora de la clínica. */
function minutoDelDia(fecha: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(fecha);
  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return (valor("hour") % 24) * 60 + valor("minute");
}

/**
 * Los `cuantos` cupos más cercanos a la hora pedida, en orden de fecha. A igual
 * distancia, el más próximo en el calendario. Sin «de la tarde», de 1 a 6 es de
 * la tarde y de 7 a 11 de la mañana, como lee la franja el menú de cupos: en un
 * hospital no hay citas a las 3 a. m., y medir contra las 3 a. m. traería los
 * cupos más tempranos de la mañana.
 */
export function cuposMasCercanosALaHora<T extends { fecha: Date }>(
  cupos: readonly T[],
  hora: HoraPreferida,
  cuantos: number,
  opts: { timeZone?: string } = {},
): T[] {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const h =
    !hora.meridiemKnown && hora.hour24 >= 1 && hora.hour24 <= 6
      ? hora.hour24 + 12
      : hora.hour24;
  const objetivo = h * 60 + (hora.minute ?? 0);
  const distancia = (c: T) => Math.abs(minutoDelDia(c.fecha, tz) - objetivo);
  return [...cupos]
    .map((c) => ({ c, d: distancia(c) }))
    .sort((a, b) => a.d - b.d || a.c.fecha.getTime() - b.c.fecha.getTime())
    .slice(0, Math.max(0, cuantos))
    .map((x) => x.c)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}

/** Lo que el paciente antepone a la letra: «perdón, B», «mejor la C». */
const ANTES_DE_LA_LETRA =
  "(?:perdon|perdone|disculpe|disculpa|ok|okay|listo|bueno|vale|si|entonces|mejor|ah|ay|uy)";
/** Verbos que eligen: «es la B», «elijo la C», «me quedo con la A». */
const VERBO_QUE_ELIGE =
  "(?:es|era|seria|sera|elijo|escojo|tomo|quiero|prefiero|deme|dame|me\\s+quedo\\s+con|me\\s+sirve)";

/**
 * La letra que eligió dentro de una frase, en mayúscula, o '' si no hay una
 * sola. Quien llama comprueba que sea una de las que se le ofrecieron.
 *   «Perdón es B», «Laletra B», «la opción c», «mejor la A», «elijo la D».
 */
export function letraEnLaFrase(texto: string | null | undefined): string {
  if (!texto) return "";
  const t = normalizar(texto)
    .replace(/\bla(letra|opcion)\b/g, "la $1")
    .replace(/\s+/g, " ");
  if (!t) return "";
  const patrones = [
    /\b(?:letra|opcion)\s+([a-h])$/,
    new RegExp(
      `\\b${VERBO_QUE_ELIGE}\\s+(?:la\\s+)?(?:letra\\s+|opcion\\s+)?([a-h])$`,
    ),
    new RegExp(
      `^${ANTES_DE_LA_LETRA}(?:\\s+${ANTES_DE_LA_LETRA})*\\s+(?:la\\s+)?([a-h])$`,
    ),
  ];
  for (const p of patrones) {
    const m = t.match(p);
    if (m) return m[1].toUpperCase();
  }
  return "";
}

/** Palabras del nombre de un médico que no lo distinguen de otro. */
const NO_DISTINGUEN = new Set([
  "dr",
  "dra",
  "doctor",
  "doctora",
  "medico",
  "medica",
  "agenda",
  "consulta",
  "hospital",
  "disponible",
  "general",
  "medicina",
]);

/**
 * De los cupos, los del médico que nombra el paciente («con el doctor
 * Santiago», «Dr Germán García»). Vacío si no nombra a ninguno de ellos.
 * Cuenta un nombre o apellido de 4 letras o más dicho como palabra entera.
 */
export function cuposDelMedicoNombrado<T extends { medico: string }>(
  texto: string | null | undefined,
  cupos: readonly T[],
): T[] {
  if (!texto) return [];
  const palabras = new Set(normalizar(texto).split(" "));
  return cupos.filter((c) =>
    normalizar(c.medico)
      .split(" ")
      .some((p) => p.length >= 4 && !NO_DISTINGUEN.has(p) && palabras.has(p)),
  );
}
