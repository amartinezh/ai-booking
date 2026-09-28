import { Injectable, Logger } from '@nestjs/common';
import { getErrorMessage } from '../common/error-message.util';
import type {
  TelegramBotInfo,
  TelegramResult,
  TelegramSentMessage,
  TelegramWebhookInfo,
} from './telegram.types';

const API_BASE = 'https://api.telegram.org';

/** Tope de la Bot API para `sendMessage`. */
export const TELEGRAM_MAX_TEXT = 4096;

/** La Bot API no deja descargar archivos de más de 20 MB. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 30_000;

/**
 * Espera máxima que se acepta ante un 429 antes de reintentar UNA vez. Más
 * allá se devuelve el error: un turno del bot no puede quedarse colgado
 * minutos esperando a Telegram.
 */
const MAX_RETRY_AFTER_S = 10;

interface BotApiEnvelope<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

/**
 * Cliente mínimo de la Bot API de Telegram.
 *
 * Dos reglas que no se rompen:
 *
 *  1. **Nunca lanza.** Todo fallo vuelve como `{ ok: false }`. El bot no puede
 *     caerse porque Telegram tardó o dijo que no.
 *  2. **El token nunca aparece en un log ni en un error.** Va en la URL de
 *     cada llamada (así lo exige Telegram), así que ningún mensaje de error se
 *     construye a partir de la URL o del objeto de la petición: solo de la
 *     `description` que responde Telegram o del nombre del fallo de red.
 */
@Injectable()
export class TelegramApiClient {
  private readonly logger = new Logger(TelegramApiClient.name);

  /** Se sobrescribe en los tests para no esperar de verdad un `retry_after`. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getMe(token: string): Promise<TelegramResult<TelegramBotInfo>> {
    return this.call<TelegramBotInfo>(token, 'getMe', {});
  }

  setWebhook(
    token: string,
    params: { url: string; secretToken: string },
  ): Promise<TelegramResult<boolean>> {
    return this.call<boolean>(token, 'setWebhook', {
      url: params.url,
      secret_token: params.secretToken,
      // Solo mensajes: ediciones, canales y botones se ignoran (T8), así que
      // ni siquiera se piden.
      allowed_updates: ['message'],
      // Lo que se acumuló con un webhook anterior (o sin webhook) no se
      // procesa: serían turnos viejos fuera de contexto.
      drop_pending_updates: true,
    });
  }

  deleteWebhook(token: string): Promise<TelegramResult<boolean>> {
    return this.call<boolean>(token, 'deleteWebhook', {
      drop_pending_updates: false,
    });
  }

  getWebhookInfo(token: string): Promise<TelegramResult<TelegramWebhookInfo>> {
    return this.call<TelegramWebhookInfo>(token, 'getWebhookInfo', {});
  }

  /**
   * Envía texto PLANO (sin `parse_mode`): el bot escribe con `*` y `_` de
   * WhatsApp y en Markdown de Telegram un asterisco sin pareja rompe el envío
   * con 400. Quien llame debe partir antes los textos de más de 4 096
   * caracteres (ver `splitTelegramText`).
   */
  sendMessage(
    token: string,
    chatId: string,
    text: string,
  ): Promise<TelegramResult<TelegramSentMessage>> {
    return this.call<TelegramSentMessage>(token, 'sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
    });
  }

  /** Nota de voz. Telegram la muestra como tal solo si es OGG/Opus. */
  sendVoice(
    token: string,
    chatId: string,
    ogg: Buffer,
  ): Promise<TelegramResult<TelegramSentMessage>> {
    const build = () => {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append(
        'voice',
        new Blob([new Uint8Array(ogg)], { type: 'audio/ogg' }),
        'voz.ogg',
      );
      return form;
    };
    return this.callMultipart<TelegramSentMessage>(token, 'sendVoice', build);
  }

  /** Descarga un archivo (la nota de voz del paciente) por su `file_id`. */
  async downloadFile(token: string, fileId: string): Promise<Buffer | null> {
    const info = await this.call<{ file_path?: string; file_size?: number }>(
      token,
      'getFile',
      { file_id: fileId },
    );
    if (!info.ok) {
      this.logger.warn(
        `getFile falló (${info.errorCode ?? 'red'}): ${info.description}`,
      );
      return null;
    }
    const { file_path: filePath, file_size: size } = info.result;
    if (!filePath) return null;
    if (size && size > MAX_DOWNLOAD_BYTES) {
      this.logger.warn(`Archivo de Telegram demasiado grande (${size} bytes).`);
      return null;
    }
    try {
      const res = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
        signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Descarga de archivo de Telegram: HTTP ${res.status}`);
        return null;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return buffer.length > MAX_DOWNLOAD_BYTES ? null : buffer;
    } catch (error: unknown) {
      this.logger.warn(
        `Descarga de archivo de Telegram falló: ${describeNetworkError(error)}`,
      );
      return null;
    }
  }

  // ── internos ────────────────────────────────────────────────────────────

  private call<T>(
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramResult<T>> {
    return this.withRetry<T>(method, () =>
      fetch(`${API_BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
  }

  private callMultipart<T>(
    token: string,
    method: string,
    build: () => FormData,
  ): Promise<TelegramResult<T>> {
    // El FormData se arma de nuevo en cada intento: un cuerpo ya enviado no
    // se puede reutilizar.
    return this.withRetry<T>(method, () =>
      fetch(`${API_BASE}/bot${token}/${method}`, {
        method: 'POST',
        body: build(),
        signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
      }),
    );
  }

  /** Un solo reintento, y solo ante 429 con una espera razonable. */
  private async withRetry<T>(
    method: string,
    request: () => Promise<Response>,
  ): Promise<TelegramResult<T>> {
    const first = await this.execute<T>(request);
    if (first.result.ok || first.retryAfter === null) return first.result;
    if (first.retryAfter > MAX_RETRY_AFTER_S) {
      this.logger.warn(
        `Telegram pidió esperar ${first.retryAfter}s en ${method}: no se reintenta.`,
      );
      return first.result;
    }
    await this.sleep(first.retryAfter * 1000);
    return (await this.execute<T>(request)).result;
  }

  private async execute<T>(
    request: () => Promise<Response>,
  ): Promise<{ result: TelegramResult<T>; retryAfter: number | null }> {
    let res: Response;
    try {
      res = await request();
    } catch (error: unknown) {
      return {
        result: {
          ok: false,
          errorCode: null,
          description: describeNetworkError(error),
        },
        retryAfter: null,
      };
    }

    let envelope: BotApiEnvelope<T> | null = null;
    try {
      envelope = (await res.json()) as BotApiEnvelope<T>;
    } catch {
      envelope = null;
    }

    if (res.ok && envelope?.ok === true && envelope.result !== undefined) {
      return {
        result: { ok: true, result: envelope.result },
        retryAfter: null,
      };
    }

    const errorCode = envelope?.error_code ?? res.status ?? null;
    const retryAfter =
      errorCode === 429 && typeof envelope?.parameters?.retry_after === 'number'
        ? envelope.parameters.retry_after
        : null;
    return {
      result: {
        ok: false,
        errorCode,
        description: envelope?.description ?? `HTTP ${res.status}`,
      },
      retryAfter,
    };
  }
}

/**
 * Nombre del fallo de red SIN la URL. `fetch` de Node pone la causa real en
 * `error.cause` (ENOTFOUND, ECONNRESET…) y no incluye la URL en el mensaje,
 * pero se toma solo el código por si eso cambia.
 */
function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'timeout';
    }
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
    return error.name || 'error de red';
  }
  return getErrorMessage(error).slice(0, 80);
}

/**
 * Parte un texto en trozos de como máximo `max` caracteres, cortando de
 * preferencia en un salto de línea y si no en un espacio, para no partir una
 * palabra ni, sobre todo, un número (una fecha, una cédula).
 */
export function splitTelegramText(
  text: string,
  max: number = TELEGRAM_MAX_TEXT,
): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n');
    if (cut < max / 2) cut = window.lastIndexOf(' ');
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^[\n ]+/, '');
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}
