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
 * 🛡️ GlobalExceptionFilter
 *
 * Atrapa CUALQUIER excepción no manejada y:
 *   1. La persiste en SystemLog con nivel ERROR + stack trace + contexto.
 *   2. Devuelve al cliente una respuesta HTTP coherente (preservando el
 *      statusCode si era un HttpException).
 *
 * IMPORTANTE:
 *   - El filtro NUNCA debe lanzar excepciones propias. Si la escritura
 *     en BD falla, el SystemLogService se encarga de no propagarla.
 *   - El body de la request se sanitiza superficialmente (passwords,
 *     tokens) antes de guardarse en metadata.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly logs: SystemLogService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let publicMessage: string | object = 'Internal server error';
    let exceptionName = 'Exception';
    let stack: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();
      publicMessage =
        typeof responseBody === 'string'
          ? responseBody
          : ((responseBody as any) ?? exception.message);
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
      params: (request as any)?.params,
      body: this.sanitizeBody((request as any)?.body),
      ip:
        (request?.headers?.['x-forwarded-for'] as string) ||
        (request as any)?.ip ||
        request?.socket?.remoteAddress ||
        null,
      userAgent: request?.headers?.['user-agent'] || null,
      statusCode: status,
      stack: stack ? stack.split('\n').slice(0, 50).join('\n') : null,
    };

    const messageStr =
      typeof publicMessage === 'string'
        ? publicMessage
        : (publicMessage as any)?.message || JSON.stringify(publicMessage);

    // Persistir el ERROR. fire-and-forget — si falla no rompe la respuesta.
    void this.logs.error({
      action: this.deriveAction(request, status),
      message: messageStr.slice(0, 2000),
      metadata,
      userId: this.extractUserId(request),
      organizationId: this.extractOrganizationId(request),
    });

    // También al stdout del contenedor para que aparezca en `docker logs`.
    this.logger.error(
      `🚨 [${status}] ${request?.method} ${request?.originalUrl} — ${messageStr}`,
      stack,
    );

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

  private deriveAction(request: Request | undefined, status: number): string {
    if (!request) return `UNHANDLED_EXCEPTION_${status}`;
    const method = (request.method || 'UNKNOWN').toUpperCase();
    const url = (request.originalUrl || request.url || '/').split('?')[0];
    // Tope de largo para que entre en el índice de SystemLog.action
    const cleanUrl = url.length > 60 ? `${url.slice(0, 57)}...` : url;
    return `HTTP_${status}_${method}_${cleanUrl}`;
  }

  private extractUserId(request: any): string | null {
    return (
      request?.user?.id ||
      request?.user?.userId ||
      request?.session?.userId ||
      null
    );
  }

  private extractOrganizationId(request: any): string | null {
    return (
      request?.user?.organizationId ||
      request?.session?.organizationId ||
      request?.headers?.['x-organization-id'] ||
      null
    );
  }

  /**
   * Sanitiza el body antes de persistirlo: trunca tamaño y oculta secretos.
   * Nunca debe lanzar.
   */
  private sanitizeBody(body: any): any {
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
      const clone: Record<string, any> = Array.isArray(body)
        ? [...body]
        : { ...body };
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
