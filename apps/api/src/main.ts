import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './system-log/global-exception.filter';
import { SystemLogService } from './system-log/system-log.service';

// ══════════════════════════════════════════════════════════════
// 🛡️ CAPTURA GLOBAL DE EXCEPCIONES NO MANEJADAS
// Cualquier promesa rechazada o excepción no atrapada se loguea
// pero NO tumba el proceso. Esto evita que un error de Meta, Prisma,
// o cualquier librería externa mate el contenedor entero.
// ══════════════════════════════════════════════════════════════
process.on('unhandledRejection', (reason: any) => {
  Logger.error(
    `🚨 UnhandledRejection capturada (proceso sigue vivo): ${
      reason?.message || JSON.stringify(reason)
    }`,
    reason?.stack || 'GlobalErrorHandler',
  );
});

process.on('uncaughtException', (error: Error) => {
  Logger.error(
    `🚨 UncaughtException capturada (proceso sigue vivo): ${error.message}`,
    error.stack || 'GlobalErrorHandler',
  );
});

async function bootstrap() {
  // `rawBody: true` conserva el body crudo de cada request: es indispensable
  // para verificar la firma X-Hub-Signature-256 del webhook de Meta (HMAC
  // byte a byte sobre el payload original, antes de parsear el JSON).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.useBodyParser('json', { limit: '50mb' });

  // 🛡️ Registrar el filtro global de excepciones. Cualquier excepción
  // no atrapada en controllers/services queda persistida en SystemLog
  // con nivel ERROR + stack trace + contexto de la request.
  const logService = app.get(SystemLogService);
  app.useGlobalFilters(new GlobalExceptionFilter(logService));

  await app.listen(process.env.PORT ?? 3001);
  Logger.log(
    `🚀 API escuchando en puerto ${process.env.PORT ?? 3001}`,
    'Bootstrap',
  );
}

bootstrap();
