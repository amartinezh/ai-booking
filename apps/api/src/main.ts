import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { Logger } from '@nestjs/common';

// ══════════════════════════════════════════════════════════════
// 🛡️ CAPTURA GLOBAL DE EXCEPCIONES NO MANEJADAS
// Cualquier promesa rechazada o excepción no atrapada se loguea
// pero NO tumba el proceso. Esto evita que un error de Meta, Prisma,
// o cualquier librería externa mate el contenedor entero.
// ══════════════════════════════════════════════════════════════
process.on('unhandledRejection', (reason: any) => {
  Logger.error(
    `🚨 UnhandledRejection capturada (proceso sigue vivo): ${reason?.message || JSON.stringify(reason)
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
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '50mb' }));
  await app.listen(process.env.PORT ?? 3001);
  Logger.log(`🚀 API escuchando en puerto ${process.env.PORT ?? 3001}`, 'Bootstrap');
}

bootstrap();