/**
 * ✉️ El mensaje que el personal le escribe al paciente desde la Bandeja
 * (2026-10-29): los textos sugeridos. Lo puro; el envío vive en
 * `mensaje-al-paciente.service.ts`.
 *
 * Son un punto de partida que la persona edita antes de enviar: el asistente no
 * decide qué pasó con la cita. Van en «usted» porque los firma el hospital, no el
 * asistente.
 */

/** Largo máximo del mensaje (WhatsApp acepta 4096; un aviso del personal no necesita más). */
export const MAX_MENSAJE_AL_PACIENTE = 1000;

export interface DatosDelMensaje {
  /** Nombre completo del paciente; se usa el primero. */
  paciente: string | null | undefined;
  clinica: string | null | undefined;
  servicio: string | null | undefined;
  /** La fecha ya formateada para el paciente («viernes, 30 de octubre a las 06:30 a. m.»). */
  fecha: string;
  /** El médico ya rotulado («Dr(a). …» o el nombre de la agenda). */
  medico: string | null | undefined;
  /** El teléfono de la clínica para el paciente, si lo tiene. */
  telefonoClinica: string | null | undefined;
}

export interface SugerenciasMensaje {
  /** «Su cita fue cancelada», con disculpas. */
  cancelada: string;
  /** «Su cita quedó registrada», con disculpas por la demora. */
  confirmada: string;
  /** Solo el saludo, para escribir lo demás. */
  saludo: string;
}

/** «MARIA ROSALBA» → «Maria». */
export function primerNombre(
  nombreCompleto: string | null | undefined,
): string {
  const primero = (nombreCompleto ?? '').trim().split(/\s+/)[0] ?? '';
  return primero
    ? primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase()
    : '';
}

export function sugerenciasDeMensaje(d: DatosDelMensaje): SugerenciasMensaje {
  const nombre = primerNombre(d.paciente);
  const clinica = (d.clinica ?? '').trim();
  const servicio = (d.servicio ?? '').trim() || 'consulta';
  const medico = (d.medico ?? '').trim();
  const conMedico = medico ? ` con ${medico}` : '';
  const telefono = (d.telefonoClinica ?? '').trim();
  const contacto = telefono ? `el hospital al ${telefono}` : 'el hospital';

  const deLaClinica = clinica ? `de ${clinica}` : 'del hospital';
  const saludo = `Hola${nombre ? `, ${nombre}` : ''}. Le escribimos ${deLaClinica}.`;
  const cita = `su cita de ${servicio} del ${d.fecha}${conMedico}`;

  return {
    cancelada:
      `${saludo}\n\n` +
      `Lamentamos informarle que ${cita} fue cancelada. ` +
      `Le pedimos disculpas por el inconveniente.\n\n` +
      `Si desea una nueva cita, puede escribirnos por este medio o comunicarse con ${contacto}.`,
    confirmada:
      `${saludo}\n\n` +
      `Le confirmamos que ${cita} quedó registrada en el hospital. ` +
      `Le pedimos disculpas por la demora en la confirmación.`,
    saludo: `${saludo}\n\n`,
  };
}
