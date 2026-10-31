/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🇨🇴 FESTIVOS DE COLOMBIA (2026-10-31)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Calculados, no escritos a mano: no hay que mantener una lista cada año.
 *
 *  - Fijos: 1 de enero, 1 de mayo, 20 de julio, 7 de agosto, 8 y 25 de diciembre.
 *  - Ley 51 de 1983 («Ley Emiliani»): si no caen en lunes, pasan al lunes
 *    siguiente: Reyes (6 ene), San José (19 mar), San Pedro y San Pablo (29 jun),
 *    Asunción (15 ago), Día de la Raza (12 oct), Todos los Santos (1 nov) e
 *    Independencia de Cartagena (11 nov).
 *  - Según la Pascua: Jueves y Viernes Santo; y, pasados al lunes, Ascensión
 *    (Pascua + 43), Corpus Christi (Pascua + 64) y Sagrado Corazón (Pascua + 71).
 *
 * Para el plazo máximo para agendar (`plazo-agendar.ts`): los domingos y los
 * festivos no cuentan. Puro: sin base de datos.
 */
import { diaDeLaSemana, fechaDe, sumarDiasAFecha } from './bloqueos-agenda';

/** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function domingoDePascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return fechaDe(anio, mes, dia);
}

/** La fecha si es lunes; si no, el lunes siguiente. */
function alLunes(fecha: string): string {
  const dia = diaDeLaSemana(fecha);
  return dia === 1 ? fecha : sumarDiasAFecha(fecha, (8 - dia) % 7);
}

const cache = new Map<number, ReadonlySet<string>>();

/** Los festivos del año ('YYYY-MM-DD'), en orden. */
export function festivosColombia(anio: number): string[] {
  return [...festivosDelAnio(anio)].sort();
}

function festivosDelAnio(anio: number): ReadonlySet<string> {
  const guardados = cache.get(anio);
  if (guardados) return guardados;
  const pascua = domingoDePascua(anio);
  const festivos = new Set<string>([
    fechaDe(anio, 1, 1),
    fechaDe(anio, 5, 1),
    fechaDe(anio, 7, 20),
    fechaDe(anio, 8, 7),
    fechaDe(anio, 12, 8),
    fechaDe(anio, 12, 25),
    alLunes(fechaDe(anio, 1, 6)),
    alLunes(fechaDe(anio, 3, 19)),
    alLunes(fechaDe(anio, 6, 29)),
    alLunes(fechaDe(anio, 8, 15)),
    alLunes(fechaDe(anio, 10, 12)),
    alLunes(fechaDe(anio, 11, 1)),
    alLunes(fechaDe(anio, 11, 11)),
    sumarDiasAFecha(pascua, -3),
    sumarDiasAFecha(pascua, -2),
    sumarDiasAFecha(pascua, 43),
    sumarDiasAFecha(pascua, 64),
    sumarDiasAFecha(pascua, 71),
  ]);
  cache.set(anio, festivos);
  return festivos;
}

/** ¿'YYYY-MM-DD' es festivo en Colombia? */
export function esFestivoColombia(fecha: string): boolean {
  const anio = Number(fecha.slice(0, 4));
  return Number.isInteger(anio) && festivosDelAnio(anio).has(fecha);
}
