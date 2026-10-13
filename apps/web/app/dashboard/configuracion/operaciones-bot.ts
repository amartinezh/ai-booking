/**
 * Lo que comparten los tres interruptores de operaciones del asistente
 * (agendar, cancelar, cambiar la fecha).
 *
 * Con el espejo del hospital activo, el asistente solo hace una operación si
 * además el envío al hospital está encendido: sin él, la cita nueva, la
 * cancelación o el cambio nunca llegarían al sistema del hospital y el paciente
 * creería algo que el hospital no tiene.
 */
export const NOTA_ENVIO_AL_HOSPITAL =
    'Si la clínica está conectada al sistema del hospital, el asistente solo lo hace con el envío al hospital encendido (Espejo).';
