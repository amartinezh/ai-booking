import { isAxiosError } from 'axios';

/**
 * `catch (e)` en este proyecto tipa `e` como `any` (el `tsconfig` de `api` no
 * activa `strict`, así que TS no cae a `unknown` como en TS 4.4+ estricto).
 * Eso dejaba pasar sin avisar cosas como `e.message` cuando lo que se lanzó
 * no era un `Error` — un `throw 'texto'`, un rechazo de una librería externa
 * con forma rara, un `undefined`. `.message` da `undefined` en silencio y el
 * log queda mudo justo cuando algo salió mal.
 *
 * Captura siempre como `unknown` y usa este helper para el mensaje.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** El `stack` solo existe en instancias de `Error`. */
export function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * Detalle de un error de `axios`/`HttpService` para loguear: el cuerpo que
 * devolvió el servidor remoto si lo hay (WhatsApp/Meta manda el motivo real
 * ahí, no en `.message`), o el mensaje del error si no.
 */
export function getAxiosErrorDetail(error: unknown): string {
  if (isAxiosError(error)) {
    const body: unknown = error.response?.data;
    if (body !== undefined) {
      if (typeof body === 'object' && body !== null)
        return JSON.stringify(body);
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
    return error.message;
  }
  return getErrorMessage(error);
}

/**
 * `true` si un error de `axios` trae el código de error `code` de Meta
 * Graph API (`error.response.data.error.code`) — p.ej. `190` = token vencido.
 */
export function isMetaGraphErrorCode(error: unknown, code: number): boolean {
  if (!isAxiosError(error)) return false;
  const body = error.response?.data as
    | { error?: { code?: number } }
    | undefined;
  return body?.error?.code === code;
}

/**
 * Código HTTP que algunos SDK de LLM (Anthropic, OpenAI, Google Generative
 * AI) adjuntan a su error como `.status` — ninguno lo tipa formalmente hacia
 * afuera, así que se lee con una guarda en vez de asumir la forma.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Mensaje de un error de un cliente gRPC (Google Cloud: TTS, Speech...).
 * `.details` trae el motivo real que manda el servidor; `.message` de gRPC
 * suele ser un envoltorio genérico ("13 INTERNAL: ..."). Ningún cliente lo
 * tipa hacia afuera, así que se lee por duck-typing.
 */
export function getGrpcErrorDetail(error: unknown): string {
  const details =
    typeof error === 'object' && error !== null && 'details' in error
      ? (error as { details: unknown }).details
      : undefined;
  return typeof details === 'string' && details
    ? details
    : getErrorMessage(error);
}
