/**
 * Lo que comparten los tres interruptores de operaciones del asistente
 * (agendar, cancelar, cambiar la fecha).
 *
 * Con el espejo del hospital activo (2026-10-15, una compuerta por operación):
 *   · Agendar necesita además el envío de citas nuevas al hospital (Espejo).
 *   · Cancelar y Cambiar fecha son también su propia compuerta hacia el
 *     hospital: encendidos, esos cambios —del asistente y del panel— llegan al
 *     sistema del hospital aunque el envío de citas nuevas esté apagado.
 */
export const NOTA_ENVIO_AL_HOSPITAL =
    'Si la clínica está conectada al sistema del hospital, el asistente solo agenda con el envío de citas nuevas al hospital encendido (Espejo).';

export const notaCompuertaHis = (queLlega: string): string =>
    `Si la clínica está conectada al sistema del hospital, este interruptor también deja pasar ${queLlega} (del asistente y del panel) a su sistema, aunque el envío de citas nuevas esté apagado: el asistente solo le confirma al paciente cuando el hospital lo registró. Apagado, esos cambios esperan en la cola.`;
