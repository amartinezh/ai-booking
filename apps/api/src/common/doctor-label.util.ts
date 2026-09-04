/**
 * Cómo se nombra a un médico cuando el texto lo va a leer un PACIENTE.
 *
 * El honorífico estaba quemado en doce plantillas (`👨‍⚕️ Dr(a). ${doctor}`) y
 * en cuatro listados del chatbot (`· Dr. ${...}`). Funciona mientras el perfil
 * sea una persona. Deja de funcionar en cuanto no lo es:
 *
 *     👨‍⚕️ Dr(a). MEDICO ATENCIÓN HTA 2
 *     👨‍⚕️ Dr(a). ENFERMERA SALUD REPRODUCTIVA
 *
 * Y no es un caso de borde. Los cuatro perfiles con los que arranca el piloto
 * de Anserma —76, 077, 91-1 y 91-2— son agendas funcionales del HIS, no
 * personas, así que eso es lo que leería prácticamente todo el mundo.
 *
 * La decisión del honorífico se toma AQUÍ y una sola vez: quien renderiza
 * recibe el nombre ya listo para mostrar. Añadir una plantilla nueva no vuelve
 * a plantear la pregunta.
 */

/** Lo mínimo que hace falta saber de un médico para nombrarlo. */
export interface DoctorNameParts {
  fullName: string;
  /** `DoctorProfile.isFunctionalAgenda` — true si el perfil es un programa. */
  isFunctionalAgenda?: boolean | null;
}

/**
 * `Dr(a).` y no `Dr.`: es la forma que ya usaban las plantillas, y la que el
 * normalizador de voz sabe expandir para que el TTS no lea el paréntesis.
 */
const HONORIFICO = 'Dr(a).';

/**
 * Nombre de un médico tal y como debe salir hacia el paciente.
 *
 *   { fullName: 'Juan Pérez' }                            → 'Dr(a). Juan Pérez'
 *   { fullName: 'Programa de Hipertensión',
 *     isFunctionalAgenda: true }                          → 'Programa de Hipertensión'
 *
 * Un nombre vacío devuelve cadena vacía en vez de un honorífico suelto: un
 * `👨‍⚕️ Dr(a).` sin nombre detrás se lee como un error del sistema.
 */
export function doctorLabel(
  doctor: DoctorNameParts | null | undefined,
): string {
  const nombre = (doctor?.fullName ?? '').trim();
  if (!nombre) return '';
  if (doctor?.isFunctionalAgenda) return nombre;
  return `${HONORIFICO} ${nombre}`;
}
