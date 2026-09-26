// Nombre canónico de la EPS de pago directo ("Particular"). Una cita Particular
// NO requiere que el paciente esté dado de alta en el padrón EPS: cualquiera
// puede pagar de su bolsillo. Fuente única de verdad compartida entre la API
// (chatbot) y la web (agendamiento manual del staff), para que la detección de
// "Particular" sea idéntica en ambos flujos.
export const PARTICULAR_EPS_NAME = 'Particular';

/** true si el nombre de EPS corresponde a "Particular" (case-insensitive). */
export function isParticularEps(epsName: string | null | undefined): boolean {
  return (epsName ?? '').trim().toLowerCase() === PARTICULAR_EPS_NAME.toLowerCase();
}

/**
 * ¿Esta cita se va a quedar sin entregar al hospital por falta de régimen?
 *
 * Es la MISMA regla con la que el driver del espejo elige el convenio
 * (`resolveConvenio` en el mirror-agent): si la cita viaja con el NIT de una
 * EPS, hace falta el régimen, porque la misma EPS tiene un convenio por régimen
 * (Salud Total subsidiado es el 475 y contributivo el 476). El despachador solo
 * manda el NIT cuando la EPS lo tiene, así que la condición es esa, no el nombre.
 *
 * Se comprueba ANTES de reservar. Caso real del 2026-09-26: el bot confirmó por
 * WhatsApp la cita de una paciente de Salud Total que ya existía sin régimen; el
 * agente la rechazó diez veces, se rindió, y el hospital nunca la tuvo mientras
 * la paciente creía tener cita. Sin espejo activo no aplica: una clínica sin HIS
 * no factura contra convenios de nadie.
 */
export function faltaRegimenParaElEspejo(datos: {
  espejoActivo: boolean;
  epsNit: string | null | undefined;
  regimen: string | null | undefined;
}): boolean {
  return datos.espejoActivo && !!datos.epsNit?.trim() && !datos.regimen?.trim();
}

/** Lo que ve el personal cuando `faltaRegimenParaElEspejo` frena una cita desde el panel. */
export const MSG_FALTA_REGIMEN =
  'Falta el régimen del paciente (subsidiado o contributivo). Sin él el hospital no puede elegir el convenio de su EPS y la cita no llegaría al HIS.';
