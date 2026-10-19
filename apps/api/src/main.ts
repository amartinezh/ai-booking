import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './system-log/global-exception.filter';
import { SystemLogService } from './system-log/system-log.service';
import { getErrorMessage, getErrorStack } from './common/error-message.util';
import { claveAlerta } from '@agenia/shared';
import { TechAlertService } from './tech-alerts/tech-alert.service';

/**
 * 🚨 Alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md): los manejadores del
 * proceso se registran antes de que exista la app; cuando arranca, se les da el
 * servicio. Antes de eso, una excepción solo va al log.
 */
let alertasTecnicas: TechAlertService | null = null;

function avisarExcepcionDelProceso(
  origen: 'unhandledRejection' | 'uncaughtException',
  error: unknown,
): void {
  const clase = error instanceof Error ? error.constructor.name : typeof error;
  void alertasTecnicas?.avisar({
    kind: 'PROCESO_EXCEPCION',
    dedupeKey: claveAlerta.proceso(origen, clase),
    title: `${origen}: ${clase}`,
    detail: getErrorMessage(error).slice(0, 300),
    fuente: 'proceso de la API',
  });
}

// ══════════════════════════════════════════════════════════════
// 🛡️ CAPTURA GLOBAL DE EXCEPCIONES NO MANEJADAS
// Cualquier promesa rechazada o excepción no atrapada se loguea
// pero NO tumba el proceso. Esto evita que un error de Meta, Prisma,
// o cualquier librería externa mate el contenedor entero.
// ══════════════════════════════════════════════════════════════
process.on('unhandledRejection', (reason: unknown) => {
  Logger.error(
    `🚨 UnhandledRejection capturada (proceso sigue vivo): ${getErrorMessage(reason)}`,
    getErrorStack(reason) || 'GlobalErrorHandler',
  );
  avisarExcepcionDelProceso('unhandledRejection', reason);
});

process.on('uncaughtException', (error: Error) => {
  Logger.error(
    `🚨 UncaughtException capturada (proceso sigue vivo): ${error.message}`,
    error.stack || 'GlobalErrorHandler',
  );
  avisarExcepcionDelProceso('uncaughtException', error);
});

async function bootstrap() {
  // `rawBody: true` conserva el body crudo de cada request: es indispensable
  // para verificar la firma X-Hub-Signature-256 del webhook de Meta (HMAC
  // byte a byte sobre el payload original, antes de parsear el JSON).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // El webhook de Meta pesa unos KB; un límite de 50 MB era un vector de
  // agotamiento de memoria (un atacante podía empujar payloads enormes). 1 MB
  // da holgura de sobra para cualquier evento legítimo de WhatsApp.
  app.useBodyParser('json', { limit: '1mb' });

  // 🛡️ Registrar el filtro global de excepciones. Cualquier excepción
  // no atrapada en controllers/services queda persistida en SystemLog
  // con nivel ERROR + stack trace + contexto de la request.
  const logService = app.get(SystemLogService);
  const alertas = app.get(TechAlertService);
  alertasTecnicas = alertas;
  app.useGlobalFilters(new GlobalExceptionFilter(logService, alertas));

  await app.listen(process.env.PORT ?? 3001);
  Logger.log(
    `🚀 API escuchando en puerto ${process.env.PORT ?? 3001}`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    `🚨 El servidor no pudo arrancar: ${getErrorMessage(error)}`,
    getErrorStack(error) || 'Bootstrap',
  );
  process.exit(1);
});
