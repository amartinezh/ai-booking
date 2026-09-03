import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SystemLogService } from './system-log.service';

/**
 * Este filtro atrapa CUALQUIER excepción, incluidas las que ocurren antes de
 * que un guard de autenticación corra (una ruta que no existe, por ejemplo).
 * `user`/`session` son opcionales y de forma laxa a propósito: según qué
 * guard alcanzó a correr, `request.user` puede traer `userId` (JWT propio,
 * ver `RolesGuard`) o `id` (otras integraciones) — nunca los dos garantizados.
 */
interface RequestWithAuth extends Request {
  user?: { id?: string; userId?: string; organizationId?: string };
  session?: { userId?: string; organizationId?: string };
}

/**
 * 🛡️ GlobalExceptionFilter
 *
 * Atrapa CUALQUIER excepción no manejada y:
 *   1. Persiste en SystemLog SOLO los fallos del servidor (5xx).
 *   2. Devuelve al cliente una respuesta HTTP coherente (preservando el
 *      statusCode si era un HttpException).
 *
 * ── Por qué los 4xx NO se persisten ──────────────────────────────────────
 * Un 4xx es un error del cliente, no una avería del sistema: una ruta que no
 * existe, un token de webhook que no cuadra, un rol sin permiso. Persistirlos
 * convertía la tabla en un vertedero y, peor, en un vector de agotamiento:
 * cualquiera que escanee la API a ciegas —o un simple healthcheck contra `/`,
 * que devuelve 404 porque AppController no está registrado— genera una fila
 * por petición. Se escriben igual en el stdout del contenedor, que Docker ya
 * rota, así que no se pierde nada para diagnosticar.
 *
 * Para depurar un problema puntual de cliente se puede bajar el umbral con
 * SYSTEMLOG_PERSIST_MIN_STATUS=400 y devolverlo a 500 al terminar.
 *
 * ── Antirrepetición ──────────────────────────────────────────────────────
 * Aun con 5xx, un fallo en bucle (BD caída, cron que revienta cada minuto)
 * escribiría miles de filas idénticas. Se guarda una por combinación
 * estado+método+ruta+mensaje cada DEDUP_WINDOW_MS; el resto solo va al log.
 *
 * IMPORTANTE:
 *   - El filtro NUNCA debe lanzar excepciones propias. Si la escritura
 *     en BD falla, el SystemLogService se encarga de no propagarla.
 *   - El body de la request se sanitiza superficialmente (passwords,
 *     tokens) antes de guardarse en metadata.
 */
const DEFAULT_PERSIST_MIN_STATUS = 500;
const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_KEYS = 500;
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /** Última vez que se persistió cada firma de error (para no repetir). */
  private readonly lastPersisted = new Map<string, number>();

  constructor(private readonly logs: SystemLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // `number`, no `HttpStatus`: exception.getStatus() devuelve cualquier
    // codigo HTTP, no solo los que HttpStatus nombra.
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let publicMessage: string | object = 'Internal server error';
    let exceptionName = 'Exception';
    let stack: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();
      // `getResponse()` de un HttpException siempre devuelve algo (nunca
      // null/undefined) — o el string que se le pasó al constructor, o el
      // objeto `{ message, error, statusCode }` que arma NestJS por defecto.
      publicMessage =
        typeof responseBody === 'string' ? responseBody : responseBody;
      exceptionName = exception.constructor.name;
      stack = exception.stack;
    } else if (exception instanceof Error) {
      exceptionName = exception.constructor.name;
      stack = exception.stack;
      publicMessage = exception.message || publicMessage;
    } else {
      try {
        publicMessage = JSON.stringify(exception);
      } catch {
        publicMessage = String(exception);
      }
    }

    // Construir metadata enriquecida para soporte técnico.
    const metadata = {
      exception: exceptionName,
      method: request?.method,
      path: request?.originalUrl || request?.url,
      query: request?.query,
      params: request.params,
      body: this.sanitizeBody(request.body),
      ip:
        (request.headers['x-forwarded-for'] as string) ||
        request.ip ||
        request.socket?.remoteAddress ||
        null,
      userAgent: request?.headers?.['user-agent'] || null,
      statusCode: status,
      stack: stack ? stack.split('\n').slice(0, 50).join('\n') : null,
    };

    const messageStr =
      typeof publicMessage === 'string'
        ? publicMessage
        : ((publicMessage as { message?: unknown }).message as string) ||
          JSON.stringify(publicMessage);

    const route = `${request?.method} ${request?.originalUrl || request?.url}`;

    // Persistir solo lo que de verdad es una avería, y solo una vez por
    // ventana. fire-and-forget — si falla no rompe la respuesta.
    if (this.shouldPersist(status, request, messageStr)) {
      // El `.catch` no es decorativo: `void` sobre una promesa rechazada es
      // una unhandled rejection, y Node 15+ mata el proceso por eso. Hoy
      // SystemLogService se traga sus propios fallos, así que nunca pasa —
      // pero el filtro no puede depender de la buena educación de su
      // colaborador para cumplir su única regla dura: nunca lanzar.
      this.logs
        .error({
          action: this.deriveAction(request, status),
          message: messageStr.slice(0, 2000),
          metadata,
          userId: this.extractUserId(request),
          organizationId: this.extractOrganizationId(request),
        })
        .catch((e) =>
          this.logger.warn(
            `No se pudo persistir el error en SystemLog: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }

    // Al stdout del contenedor va TODO, con el nivel que le corresponde:
    // Docker ya rota estos logs, así que aquí no hay riesgo de acumulación.
    if (status >= 500) {
      this.logger.error(`🚨 [${status}] ${route} — ${messageStr}`, stack);
    } else if (status === (HttpStatus.NOT_FOUND as number)) {
      this.logger.verbose(`[404] ${route}`);
    } else {
      this.logger.warn(`[${status}] ${route} — ${messageStr}`);
    }

    // Responder al cliente con un payload predecible.
    if (response && typeof response.status === 'function') {
      response.status(status).json({
        statusCode: status,
        message: publicMessage,
        timestamp: new Date().toISOString(),
        path: request?.originalUrl || request?.url,
      });
    }
  }

  // ── helpers ────────────────────────────────────────────────

  /**
   * Decide si el error merece una fila en SystemLog.
   *
   * Dos filtros: el umbral por código de estado (5xx por defecto) y una
   * ventana antirrepetición por firma del error. El mapa se poda solo para
   * que no crezca sin límite en un proceso de larga vida.
   */
  private shouldPersist(
    status: number,
    request: Request | undefined,
    messageStr: string,
  ): boolean {
    const min = Number(process.env.SYSTEMLOG_PERSIST_MIN_STATUS);
    const threshold =
      Number.isFinite(min) && min > 0 ? min : DEFAULT_PERSIST_MIN_STATUS;
    if (status < threshold) return false;

    const path = (request?.originalUrl || request?.url || '/').split('?')[0];
    const key = `${status}:${request?.method}:${path}:${messageStr.slice(0, 120)}`;
    const now = Date.now();

    const last = this.lastPersisted.get(key);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;

    if (this.lastPersisted.size >= DEDUP_MAX_KEYS) {
      for (const [k, t] of this.lastPersisted) {
        if (now - t > DEDUP_WINDOW_MS) this.lastPersisted.delete(k);
      }
      // Si aun así sigue lleno, se descarta todo: perder la memoria de
      // repeticiones es preferible a que el mapa crezca sin control.
      if (this.lastPersisted.size >= DEDUP_MAX_KEYS) this.lastPersisted.clear();
    }
    this.lastPersisted.set(key, now);
    return true;
  }

  private deriveAction(request: Request | undefined, status: number): string {
    if (!request) return `UNHANDLED_EXCEPTION_${status}`;
    const method = (request.method || 'UNKNOWN').toUpperCase();
    const url = (request.originalUrl || request.url || '/').split('?')[0];
    // Tope de largo para que entre en el índice de SystemLog.action
    const cleanUrl = url.length > 60 ? `${url.slice(0, 57)}...` : url;
    return `HTTP_${status}_${method}_${cleanUrl}`;
  }

  private extractUserId(request: RequestWithAuth | undefined): string | null {
    return (
      request?.user?.id ||
      request?.user?.userId ||
      request?.session?.userId ||
      null
    );
  }

  private extractOrganizationId(
    request: RequestWithAuth | undefined,
  ): string | null {
    return (
      request?.user?.organizationId ||
      request?.session?.organizationId ||
      (request?.headers?.['x-organization-id'] as string) ||
      null
    );
  }

  /**
   * Sanitiza el body antes de persistirlo: trunca tamaño y oculta secretos.
   * Nunca debe lanzar.
   */
  private sanitizeBody(body: unknown): unknown {
    try {
      if (!body || typeof body !== 'object') return body ?? null;
      const SECRETS = [
        'password',
        'token',
        'authorization',
        'apiKey',
        'api_key',
        'secret',
      ];
      const clone: Record<string, unknown> | unknown[] = Array.isArray(body)
        ? [...(body as unknown[])]
        : { ...(body as Record<string, unknown>) };
      for (const key of Object.keys(clone)) {
        if (SECRETS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
          clone[key] = '[REDACTED]';
        }
      }
      const serialized = JSON.stringify(clone);
      if (serialized.length > 6000) {
        return { _truncated: true, preview: serialized.slice(0, 6000) };
      }
      return clone;
    } catch {
      return { _unserializable: true };
    }
  }
}
