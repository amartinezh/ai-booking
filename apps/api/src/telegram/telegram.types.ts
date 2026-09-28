/**
 * Tipos del canal de Telegram (docs/PLAN_TELEGRAM.md).
 *
 * Solo se declara la parte de la Bot API que el canal usa. Todo campo que
 * llega de Telegram es opcional: el payload real varía según el tipo de
 * mensaje y nunca se asume presente.
 */
import type { TelegramMessageKind } from '@agenia/database';

// ── Bot API: lo que Telegram nos manda ─────────────────────────────────────

export interface TelegramUser {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id?: number;
  /** 'private' | 'group' | 'supergroup' | 'channel' */
  type?: string;
}

export interface TelegramMessage {
  message_id?: number;
  date?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: string;
  /** Nota de voz (OGG/Opus). */
  voice?: { file_id?: string; duration?: number; file_size?: number };
  // Presentes solo para reconocer lo que el bot no atiende (T8).
  audio?: unknown;
  photo?: unknown;
  document?: unknown;
  sticker?: unknown;
  video?: unknown;
  video_note?: unknown;
  animation?: unknown;
  location?: unknown;
  contact?: unknown;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: unknown;
  my_chat_member?: unknown;
}

// ── Bot API: respuestas ────────────────────────────────────────────────────

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name?: string;
}

export interface TelegramWebhookInfo {
  url: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
}

export interface TelegramSentMessage {
  message_id: number;
}

/**
 * Resultado de una llamada a la Bot API. El cliente NUNCA lanza: un fallo es
 * un valor, igual que `sendWhatsAppMessage` devuelve `null`.
 *
 * `errorCode` es el `error_code` de Telegram (400, 401, 403, 429…) o `null`
 * cuando ni siquiera hubo respuesta (red, timeout).
 */
export type TelegramResult<T> =
  | { ok: true; result: T }
  | { ok: false; errorCode: number | null; description: string };

// ── Configuración por clínica ──────────────────────────────────────────────

/** Credenciales en claro — solo se materializan dentro del backend. */
export interface ResolvedTelegramCredentials {
  organizationId: string;
  botToken: string;
  botId: string | null;
  isActive: boolean;
}

/** Lo que el webhook necesita para aceptar (o no) un update. */
export interface TelegramWebhookTarget {
  organizationId: string;
  botToken: string;
  webhookSecret: string;
  isActive: boolean;
}

export interface SaveTelegramConfigInput {
  botToken?: string | null;
}

/** Vista segura para el panel: nunca expone el token ni el secreto. */
export interface PublicTelegramConfig {
  connected: boolean;
  isActive: boolean;
  botUsername: string | null;
  botLink: string | null;
  botTokenLast4: string | null;
  lastWebhookSetAt: Date | null;
  lastError: string | null;
  updatedAt: Date | null;
}

export interface TelegramWebhookStatus extends PublicTelegramConfig {
  webhookOk: boolean;
  pendingUpdateCount: number | null;
  telegramLastError: string | null;
}

// ── Envío ──────────────────────────────────────────────────────────────────

export interface TelegramOutboundContext {
  kind?: TelegramMessageKind;
  appointmentId?: string | null;
}

export interface TelegramSendOutcome {
  ok: boolean;
  /** `message_id` del último fragmento entregado. */
  messageId: number | null;
  errorCode: number | null;
  /** El paciente bloqueó al bot (403). El recordatorio debe caer a WhatsApp (T4). */
  blocked: boolean;
}
