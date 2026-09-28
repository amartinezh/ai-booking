/**
 * El canal que el panel le NOMBRA al personal en el botón de recordatorio.
 *
 * Es el canal por el que el recordatorio saldrá DE VERDAD: se calcula con la
 * misma regla que usa el envío (`destinoDeContacto`, en @agenia/shared; T4 de
 * docs/PLAN_TELEGRAM.md). Así una cita de Telegram de un paciente que bloqueó
 * al bot dice «WhatsApp», que es por donde le llegará.
 *
 * Sin destinatario posible se nombra WhatsApp, como siempre: el envío lo
 * rechazará con su motivo («no tiene número de WhatsApp registrado»).
 */
import { destinoDeContacto, type IdentidadDeContacto } from '@agenia/shared';

export type NombreDeCanal = 'WhatsApp' | 'Telegram';

export function canalDelRecordatorio(
    paciente: IdentidadDeContacto | null | undefined,
    origenDeLaCita: string | null | undefined,
): NombreDeCanal {
    const destino = paciente ? destinoDeContacto(paciente, origenDeLaCita) : null;
    return destino?.canal === 'TELEGRAM' ? 'Telegram' : 'WhatsApp';
}
