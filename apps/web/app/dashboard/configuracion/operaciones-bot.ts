/**
 * Lo que comparten los tres interruptores de operaciones (agendar, cancelar,
 * cambiar la fecha).
 *
 * Con el espejo del hospital activo (2026-10-15, `compuerta-his.ts`) cada
 * interruptor manda en todo: encendido, la operación se hace por el asistente y
 * desde el panel y llega al sistema del hospital; apagado, no se puede hacer en
 * AgenIA (lo frena la base) y se hace directamente en el sistema del hospital.
 */
export const notaCompuertaHis = (queLlega: string): string =>
    `Si la clínica está conectada al sistema del hospital, este interruptor manda en todo: encendido, ${queLlega} se hacen por el asistente y desde el panel y llegan al sistema del hospital (el asistente solo le confirma al paciente cuando el hospital lo registró); apagado, no se pueden hacer en AgenIA —ni por el asistente ni desde el panel— y se hacen directamente en el sistema del hospital. Nada queda en cola.`;
