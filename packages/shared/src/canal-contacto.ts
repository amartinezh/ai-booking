/**
 * ══════════════════════════════════════════════════════════════════════════
 * ¿POR QUÉ CANAL SE LE ESCRIBE A ESTE PACIENTE? (docs/PLAN_TELEGRAM.md, T4)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Un paciente puede tener WhatsApp, Telegram o los dos. La regla aprobada:
 *
 *  1. Por el canal por el que se agendó la cita: `TELEGRAM` → Telegram;
 *     cualquier otro origen (WHATSAPP, MANUAL, MIRROR) → WhatsApp, como
 *     siempre.
 *  2. Si ese canal no está disponible, se cae al otro:
 *     - Telegram no disponible = sin chat, o el paciente bloqueó al bot.
 *     - WhatsApp no disponible = sin teléfono ni BSUID.
 *  3. Sin ninguno, no hay a quién escribir (`null`).
 *
 * Vive en `@agenia/shared` porque la misma pregunta la hacen el botón
 * «Contactar» del panel y el recordatorio de la API: si contestaran distinto,
 * el personal escribiría por un canal y el recordatorio llegaría por otro.
 *
 * El destino de WhatsApp es el de siempre: el BSUID manda sobre el teléfono
 * (es el identificador estable). El de Telegram es el remitente del bot,
 * `tg:<chat_id>`, que es lo que entiende el envío.
 */
import { toTelegramSenderId } from './telegram-identity';

export type CanalDeContacto = 'WHATSAPP' | 'TELEGRAM';

export interface IdentidadDeContacto {
  whatsappId?: string | null;
  bsuid?: string | null;
  telegramChatId?: string | null;
  /** Momento en que Telegram dijo que el paciente bloqueó al bot. */
  telegramBlockedAt?: Date | string | null;
}

export interface DestinoDeContacto {
  canal: CanalDeContacto;
  /** Lo que se pasa al envío: teléfono/BSUID, o `tg:<chat_id>`. */
  destinatario: string;
  /** true si NO es el canal preferido para esta cita (se cayó al otro). */
  esRespaldo: boolean;
}

const limpio = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
};

/** Destino por WhatsApp, o `null` si el paciente no tiene. */
function destinoWhatsapp(p: IdentidadDeContacto): string | null {
  return limpio(p.bsuid) ?? limpio(p.whatsappId);
}

/** Destino por Telegram, o `null` si no tiene chat o bloqueó al bot. */
function destinoTelegram(p: IdentidadDeContacto): string | null {
  if (p.telegramBlockedAt) return null;
  return toTelegramSenderId(limpio(p.telegramChatId));
}

export function destinoDeContacto(
  paciente: IdentidadDeContacto,
  origenDeLaCita?: string | null,
): DestinoDeContacto | null {
  const whatsapp = destinoWhatsapp(paciente);
  const telegram = destinoTelegram(paciente);
  const preferido: CanalDeContacto =
    origenDeLaCita === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP';

  const orden: Array<[CanalDeContacto, string | null]> =
    preferido === 'TELEGRAM'
      ? [
          ['TELEGRAM', telegram],
          ['WHATSAPP', whatsapp],
        ]
      : [
          ['WHATSAPP', whatsapp],
          ['TELEGRAM', telegram],
        ];

  for (const [canal, destinatario] of orden) {
    if (destinatario) {
      return { canal, destinatario, esRespaldo: canal !== preferido };
    }
  }
  return null;
}
