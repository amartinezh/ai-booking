/**
 * Lo que el asistente de soporte atiende de un update de Telegram, y lo que no.
 *
 * Solo chats PRIVADOS y personas (no bots). Grupos, canales y mensajes editados se
 * ignoran: el asistente conversa con una persona verificada, no con un grupo.
 */

interface UsuarioTelegram {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
}

interface MensajeTelegram {
  message_id?: number;
  from?: UsuarioTelegram;
  chat?: { id?: number; type?: string };
  text?: string;
}

/** La parte del update que importa al asistente. Todo campo es opcional. */
export interface UpdateDelAsistente {
  update_id?: number;
  message?: MensajeTelegram;
  edited_message?: unknown;
  callback_query?: {
    id?: string;
    from?: UsuarioTelegram;
    data?: string;
    message?: MensajeTelegram;
  };
}

export type EntradaDelAsistente =
  | { accion: 'ignorar'; motivo: string }
  | {
      accion: 'mensaje';
      updateId: string;
      telegramUserId: string;
      chatId: string;
      nombre: string | null;
      /** `null`: no es texto (foto, audio, sticker…). */
      texto: string | null;
    }
  | {
      accion: 'boton';
      updateId: string;
      telegramUserId: string;
      chatId: string;
      nombre: string | null;
      callbackId: string;
      datos: string;
    };

const nombreDe = (u?: UsuarioTelegram) =>
  u?.first_name?.trim().slice(0, 64) || null;

export function leerUpdate(
  update: UpdateDelAsistente | null | undefined,
): EntradaDelAsistente {
  if (!update || typeof update.update_id !== 'number') {
    return { accion: 'ignorar', motivo: 'sin update_id' };
  }
  const updateId = String(update.update_id);

  const cb = update.callback_query;
  if (cb) {
    const chat = cb.message?.chat;
    if (
      !cb.id ||
      typeof cb.from?.id !== 'number' ||
      typeof chat?.id !== 'number'
    ) {
      return { accion: 'ignorar', motivo: 'botón incompleto' };
    }
    if (chat.type !== 'private')
      return { accion: 'ignorar', motivo: 'botón fuera de un chat privado' };
    return {
      accion: 'boton',
      updateId,
      telegramUserId: String(cb.from.id),
      chatId: String(chat.id),
      nombre: nombreDe(cb.from),
      callbackId: cb.id,
      datos: typeof cb.data === 'string' ? cb.data : '',
    };
  }

  const m = update.message;
  if (!m) return { accion: 'ignorar', motivo: 'no es un mensaje nuevo' };
  if (m.chat?.type !== 'private')
    return { accion: 'ignorar', motivo: 'no es un chat privado' };
  if (typeof m.from?.id !== 'number' || typeof m.chat.id !== 'number') {
    return { accion: 'ignorar', motivo: 'mensaje sin remitente' };
  }
  if (m.from.is_bot) return { accion: 'ignorar', motivo: 'lo escribió un bot' };
  return {
    accion: 'mensaje',
    updateId,
    telegramUserId: String(m.from.id),
    chatId: String(m.chat.id),
    nombre: nombreDe(m.from),
    texto: typeof m.text === 'string' ? m.text : null,
  };
}
