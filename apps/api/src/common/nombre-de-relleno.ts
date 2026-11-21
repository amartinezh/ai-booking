/**
 * 🪪 El nombre de relleno de una ficha de paciente (2026-11-21).
 *
 * Cuando el chat llegaba a agendar sin saber el nombre del paciente, la ficha
 * nacía con «Paciente Registrado» (y el resumen decía «Listo, Paciente»). Pasaba
 * por el atajo que salta el paso del documento: con el documento dado antes de
 * buscar al paciente —en el primer mensaje, o al elegir un sábado sin ser de zona
 * rural— nadie le preguntaba el nombre. El 21-nov, a las 9:31, el hospital rechazó
 * así una cita (sin nacimiento ni sexo) y, al reintentar, la ficha ya existía con
 * ese nombre: el agente dio de alta en el sistema del hospital a un paciente
 * llamado «PACIENTE REGISTRADO». En AgenIA había 10 fichas así.
 *
 * Con esto se reconoce ese nombre (y el vacío) para tratarlo como «sin nombre»:
 * el chat se lo pregunta, la ficha se corrige y el sistema del hospital nunca
 * recibe con qué crear un paciente con ese nombre.
 */

/** Lo que se guarda cuando de verdad no hay otro nombre (la columna no admite vacío). */
export const NOMBRE_DE_RELLENO = 'Paciente Registrado';

/** Sin tildes, sin mayúsculas y con un solo espacio. */
const comparable = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const RELLENOS = new Set(['paciente', 'paciente registrado']);

/** ¿Es un nombre de relleno, o no hay nombre? Entonces la ficha no tiene nombre. */
export function esNombreDeRelleno(nombre: string | null | undefined): boolean {
  const t = comparable(nombre ?? '');
  return t === '' || RELLENOS.has(t);
}
