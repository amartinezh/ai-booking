/**
 * 🪪 Nombres y apellidos de un paciente nuevo, cuando los repite.
 *
 * El bot los pide en dos pasos porque el HIS los guarda en columnas propias. El
 * 2026-10-22 (primer día con agendar encendido) un paciente escribió su nombre
 * COMPLETO cuando se le pedían solo los nombres —«Juan camilo hurtado ramos»— y
 * luego sus apellidos —«Hurtado ramos»—: quedó «Juan camilo hurtado ramos Hurtado
 * ramos», y así habría ido al sistema del hospital.
 *
 * Solo se corrige lo que no tiene otra lectura:
 *  - los nombres terminan con los apellidos que dio (o empiezan a repetirlos)
 *    y lo repetido son DOS palabras o más: «Juan Camilo Hurtado Ramos» + «Hurtado
 *    Ramos», o + «Hurtado» (y entonces «Ramos» también es apellido);
 *  - los apellidos empiezan repitiendo los nombres, de dos palabras o más:
 *    «Juan Camilo» + «Juan Camilo Hurtado Ramos».
 * Con una sola palabra repetida no se toca: «María José» + «José», o «Juan
 * Hurtado» + «Hurtado», pueden ser así de verdad.
 *
 * Si escribió exactamente lo mismo en los dos pasos, no hay forma de saber dónde
 * termina el nombre: `repetido`, y el bot vuelve a pedir solo los apellidos.
 */

export interface NombresYApellidos {
  nombres: string;
  apellidos: string;
  /** Escribió lo mismo en los dos pasos: hay que volver a pedir los apellidos. */
  repetido: boolean;
}

const palabras = (texto: string): string[] =>
  (texto ?? '').trim().split(/\s+/).filter(Boolean);

/** Para comparar: sin mayúsculas ni tildes. */
const clave = (palabra: string): string =>
  palabra.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function separarNombresYApellidos(
  nombresDados: string,
  apellidosDados: string,
): NombresYApellidos {
  const n = palabras(nombresDados);
  const a = palabras(apellidosDados);
  const nn = n.map(clave);
  const aa = a.map(clave);
  const tal = (): NombresYApellidos => ({
    nombres: n.join(' '),
    apellidos: a.join(' '),
    repetido: false,
  });
  if (n.length === 0 || a.length === 0) return tal();

  // Lo mismo en los dos pasos: no se puede saber dónde termina el nombre.
  if (nn.length === aa.length && nn.every((p, i) => p === aa[i])) {
    return { nombres: n.join(' '), apellidos: a.join(' '), repetido: true };
  }

  // Los nombres traen los apellidos: desde la posición i (deja al menos un
  // nombre) aparecen todos los apellidos dados, seguidos.
  for (let i = 1; i < n.length; i++) {
    const coinciden = aa.every((p, k) => nn[i + k] === p);
    const cola = n.slice(i);
    if (coinciden && cola.length >= 2) {
      return {
        nombres: n.slice(0, i).join(' '),
        // Lo que respondió a «apellidos»; si ahí dio menos («Hurtado») y en los
        // nombres hay más («Hurtado Ramos»), lo más completo.
        apellidos: (cola.length > a.length ? cola : a).join(' '),
        repetido: false,
      };
    }
  }

  // Los apellidos repiten los nombres al principio.
  if (n.length >= 2 && a.length > n.length && nn.every((p, i) => aa[i] === p)) {
    return {
      nombres: n.join(' '),
      apellidos: a.slice(n.length).join(' '),
      repetido: false,
    };
  }

  return tal();
}
