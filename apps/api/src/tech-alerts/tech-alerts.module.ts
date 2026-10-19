import { Global, Module } from '@nestjs/common';
import { TelegramCoreModule } from '../telegram/telegram-core.module';
import { TechAlertConfigService } from './tech-alert-config.service';
import { TechAlertDispatcher } from './tech-alert.dispatcher';
import { TechAlertService } from './tech-alert.service';
import { TechAlertsController } from './tech-alerts.controller';

/**
 * 🚨 Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md): el canal del
 * SUPER_ADMIN con el equipo técnico.
 *
 * Global a propósito: lo inyectan el monitor, el espejo, los crones y el filtro de
 * errores (Fase 2), y así ninguno tiene que importarlo. Por la misma razón NO
 * importa ningún módulo de negocio —solo el cliente de Telegram, que no importa
 * nada—: si importara a uno de los que lo usan, el ciclo de `import` dejaría un
 * módulo `undefined` y la API no arrancaría (lección de la Fase 2 de Telegram; lo
 * vigila app.module.imports.spec.ts). Prisma y Crypto son globales.
 *
 * NO depende de `TELEGRAM_ENABLED`, que es el interruptor del canal de pacientes.
 */
@Global()
@Module({
  imports: [TelegramCoreModule],
  controllers: [TechAlertsController],
  providers: [TechAlertConfigService, TechAlertDispatcher, TechAlertService],
  exports: [TechAlertService],
})
export class TechAlertsModule {}
