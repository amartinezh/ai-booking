/**
 * ══════════════════════════════════════════════════════════════════════════
 * IDENTIDAD DE TELEGRAM: el remitente `tg:<chat_id>`
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El bot guarda la sesión, la auditoría y el destinatario de cada respuesta
 * bajo un único `senderId`. En WhatsApp es un teléfono (solo dígitos), un
 * BSUID (`CO.…`) o un PSID (dígitos). El `chat_id` de Telegram TAMBIÉN es un
 * número: sin marca, el chat 3001234567 sería indistinguible del celular
 * 3001234567 y compartiría su sesión, su tenant cacheado y sus recordatorios.
 *
 * Por eso el remitente de Telegram lleva siempre el prefijo `tg:`. Ningún
 * identificador de WhatsApp lo lleva, así que `isTelegramSender` es la única
 * pregunta que el bot necesita para saber por qué canal responder — y para
 * todo identificador de WhatsApp contesta `false`, dejando intacto su camino.
 *
 * Vive en `@agenia/shared` porque el panel necesita la misma respuesta: un
 * `tg:…` no es un teléfono y no se le puede armar un enlace `wa.me`.
 *
 * Ver docs/PLAN_TELEGRAM.md §3.
 */

export const TELEGRAM_SENDER_PREFIX = 'tg:';

/**
 * ¿Este remitente es de Telegram?
 *
 * Basta con el prefijo, a propósito: un `tg:` malformado tampoco es de
 * WhatsApp, y es preferible que el envío falle en el cliente de Telegram a que
 * viaje a la API de Meta como si fuera un BSUID.
 */
export function isTelegramSender(
  identifier: string | null | undefined,
): boolean {
  if (typeof identifier !== 'string') return false;
  return identifier.trim().startsWith(TELEGRAM_SENDER_PREFIX);
}

/**
 * `chat_id` de Telegram → remitente del bot. `null` si no es un entero: el
 * llamador (el webhook) descarta el update en vez de inventar una sesión.
 *
 * Se aceptan negativos aunque el bot solo atienda chats privados (positivos):
 * filtrar grupos es decisión del webhook (T8), no de la identidad.
 */
export function toTelegramSenderId(
  chatId: number | string | null | undefined,
): string | null {
  const raw = typeof chatId === 'number' ? String(chatId) : chatId?.trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  if (typeof chatId === 'number' && !Number.isSafeInteger(chatId)) return null;
  return `${TELEGRAM_SENDER_PREFIX}${raw}`;
}

/**
 * Remitente del bot → `chat_id` que espera la API de Telegram, como texto
 * (los ids pueden pasar de 2^31 y la API los acepta como cadena). `null` si
 * no es un remitente de Telegram bien formado.
 */
export function chatIdFromTelegramSender(
  identifier: string | null | undefined,
): string | null {
  if (!isTelegramSender(identifier)) return null;
  const chatId = (identifier as string)
    .trim()
    .slice(TELEGRAM_SENDER_PREFIX.length);
  return /^-?\d+$/.test(chatId) ? chatId : null;
}
