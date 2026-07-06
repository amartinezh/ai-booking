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
