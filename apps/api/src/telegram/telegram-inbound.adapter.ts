import { toTelegramSenderId } from '@agenia/shared';
import {
  TELEGRAM_ORIGIN,
  type TelegramOrigin,
  type WhatsappInboundEvent,
} from '../chatbot/sender-identity';
import type { TelegramMessage, TelegramUpdate } from './telegram.types';

/**
 * Evento de Telegram con la forma que el bot ya sabe leer.
 *
 * Reutiliza `WhatsappInboundEvent` (texto en `text.body`, voz en `audio.id`,
 * id del mensaje en `id`) para que la voz y el texto recorran el MISMO camino
 * del bot que en WhatsApp. Lo que lo distingue es la marca `TELEGRAM_ORIGIN`
 * (un `Symbol`, que ningún JSON puede falsificar): de ahí saca el bot quién
 * escribió y de qué clínica.
 *
 * Deliberadamente NO lleva `from` ni `user_id`: esos campos significan
 * «teléfono» y «BSUID» de WhatsApp, y un `chat_id` puesto ahí se guardaría
 * como teléfono del paciente.
 */
export interface TelegramInboundEvent extends WhatsappInboundEvent {
  type: 'text' | 'audio';
  [TELEGRAM_ORIGIN]: TelegramOrigin;
}

/** Qué hacer con un update. */
export type TelegramUpdateDecision =
  /** Se descarta en silencio (con log): grupos, canales, ediciones, bots… */
  | { action: 'ignore'; reason: string }
  /** Chat privado con algo que el bot no entiende: se le avisa (T8). */
  | {
      action: 'unsupported';
      chatId: string;
      senderId: string;
      dedupKey: string;
      what: string;
    }
  /** Texto o nota de voz: va al bot. */
  | {
      action: 'message';
      event: TelegramInboundEvent;
      senderId: string;
      dedupKey: string;
    };

/** Lo que se le contesta a una foto, sticker, documento… (T8). */
export const TELEGRAM_UNSUPPORTED_REPLY =
  'Por ahora solo entiendo mensajes de texto y notas de voz. 🙏 Escríbame o envíeme un audio y con gusto le ayudo.';

/** `/start` es el «Hola» de Telegram: abre el bot desde el enlace t.me. */
const START_TEXT = 'Hola';

/**
 * Traduce un update de Telegram a una decisión. Función pura: toda la
 * política de T8 vive aquí y se prueba sin red ni base de datos.
 *
 * `routeKey` entra en la llave de deduplicación porque `update_id` solo es
 * único dentro de un bot: dos clínicas pueden recibir el mismo número.
 */
export function adaptTelegramUpdate(
  update: TelegramUpdate | null | undefined,
  organizationId: string,
  routeKey: string,
): TelegramUpdateDecision {
  if (!update || typeof update.update_id !== 'number') {
    return { action: 'ignore', reason: 'update sin update_id' };
  }
  const updateId = update.update_id;

  if (update.edited_message || update.edited_channel_post) {
    return { action: 'ignore', reason: 'mensaje editado' };
  }
  if (update.channel_post) {
    return { action: 'ignore', reason: 'publicación de canal' };
  }
  const msg = update.message;
  if (!msg) {
    return { action: 'ignore', reason: 'update sin message' };
  }
  if (msg.chat?.type !== 'private') {
    return {
      action: 'ignore',
      reason: `chat no privado (${msg.chat?.type ?? 'desconocido'})`,
    };
  }
  if (msg.from?.is_bot) {
    return { action: 'ignore', reason: 'remitente es un bot' };
  }

  const senderId = toTelegramSenderId(msg.chat.id);
  if (!senderId) {
    return { action: 'ignore', reason: 'chat.id inválido' };
  }
  const chatId = String(msg.chat.id);
  const dedupKey = `tg:${routeKey}:${updateId}`;

  const base = {
    id: dedupKey,
    [TELEGRAM_ORIGIN]: { organizationId, chatId, senderId },
  };

  if (typeof msg.text === 'string') {
    const text = normalizeCommand(msg.text);
    if (text.length === 0) {
      return { action: 'ignore', reason: 'texto vacío' };
    }
    return {
      action: 'message',
      senderId,
      dedupKey,
      event: { ...base, type: 'text', text: { body: text } },
    };
  }

  if (msg.voice?.file_id) {
    return {
      action: 'message',
      senderId,
      dedupKey,
      event: { ...base, type: 'audio', audio: { id: msg.voice.file_id } },
    };
  }

  return {
    action: 'unsupported',
    chatId,
    senderId,
    dedupKey,
    what: describeUnsupported(msg),
  };
}

/**
 * `/start` (con o sin parámetro, con o sin `@bot`) → «Hola». El resto de
 * comandos se pasa tal cual: el bot los trata como texto libre.
 */
function normalizeCommand(text: string): string {
  const trimmed = text.trim();
  if (/^\/start(@\w+)?(\s|$)/i.test(trimmed)) return START_TEXT;
  return trimmed;
}

function describeUnsupported(msg: TelegramMessage): string {
  const kinds: Array<keyof TelegramMessage> = [
    'photo',
    'sticker',
    'document',
    'audio',
    'video',
    'video_note',
    'animation',
    'location',
    'contact',
  ];
  return kinds.find((k) => msg[k] !== undefined) ?? 'otro';
}
