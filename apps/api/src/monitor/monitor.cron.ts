import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorCheckers } from './monitor.checkers';
import { ACTIVE_SERVICES, CheckResult } from './services.config';
import { getErrorMessage, getErrorStack } from '../common/error-message.util';
import {
  alertaDeIncidente,
  claveAlerta,
  incidenteDebeAvisar,
} from '@agenia/shared';
import { TechAlertService } from '../tech-alerts/tech-alert.service';

/** Estado en memoria del último resultado conocido de cada servicio. */
interface KnownState {
  status: string; // 'UP' | 'DOWN' | 'DEGRADED'
  incidentId?: string; // incidente abierto asociado (si status != UP)
  /** Chequeos seguidos sin estar UP: confirma la latencia alta (A5). */
  seguidos?: number;
}

/**
 * MODO A — Centinela en background.
 *
 * Cron de NestJS que chequea los servicios cada `MONITOR_BG_INTERVAL_MINUTES`
 * y SOLO escribe en BD ante transiciones: abre un `ServiceIncident` cuando un
 * servicio pasa de UP a DOWN/DEGRADED y lo cierra (resolvedAt) cuando se
 * recupera. Estados estacionarios no se persisten.
 *
 * NO comparte estado con el MODO B (endpoint /monitor/live-check), que es
 * 100% efímero. NO toca `ChatbotCron`.
 *
 * 🚨 Alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md): cada chequeo caído le
 * avisa al grupo técnico (el mismo problema abierto solo suma ocurrencias, no
 * manda otro mensaje), y la recuperación lo resuelve. Una latencia alta se
 * avisa solo si se repite en dos chequeos seguidos: el 2026-10-12 Gemini y Meta
 * «degradaron» en el mismo segundo por un parpadeo de red del VPS (A5).
 */
@Injectable()
export class MonitorCron implements OnModuleInit {
  private readonly logger = new Logger(MonitorCron.name);

  /** Último estado conocido por servicio. Se reconstruye al arrancar. */
  private lastKnownStatus: Map<string, KnownState> = new Map();

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly checkers: MonitorCheckers,
    // Opcional: sin él (tests), el monitor funciona igual, solo no avisa.
    @Optional() private readonly alertas?: TechAlertService,
  ) {}

  async onModuleInit() {
    const enabled =
      this.config.get<string>('MONITOR_ENABLED', 'true') === 'true';
    if (!enabled) {
      this.logger.warn(
        '🚫 Monitor de fondo deshabilitado por .env (MONITOR_ENABLED=false)',
      );
      return;
    }

    const intervalMinutes = Number(
      this.config.get('MONITOR_BG_INTERVAL_MINUTES') ?? 5,
    );

    // 1️⃣ Reconstruir estado desde incidentes abiertos en BD (resolvedAt = null).
    //    Evita abrir incidentes duplicados si el API se reinició estando caído.
    //    CRÍTICO: si esto falla (p.ej. la tabla aún no existe porque no se corrió
    //    la migración), NO debe abortar el arranque de toda la API. Lo aislamos.
    try {
      const openIncidents = await this.prisma.serviceIncident.findMany({
        where: { resolvedAt: null },
      });
      for (const inc of openIncidents) {
        this.lastKnownStatus.set(inc.serviceKey, {
          status: inc.status,
          incidentId: inc.id,
        });
      }
      this.logger.log(
        `📋 Estado reconstruido: ${openIncidents.length} incidente(s) abierto(s)`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo reconstruir estado de incidentes (¿falta la migración de ServiceIncident?): ${getErrorMessage(error)}. El monitor arranca con estado vacío.`,
      );
    }

    // 2️⃣ Registrar cron dinámico con el intervalo del .env (sin segundos).
    const cronExpr = `*/${intervalMinutes} * * * *`;
    const job = new CronJob(cronExpr, () => {
      void this.runHealthChecks();
    });
    this.schedulerRegistry.addCronJob('monitorBgCheck', job);
    job.start();
    this.logger.log(
      `✅ Monitor de fondo registrado — cada ${intervalMinutes} min (cron: ${cronExpr})`,
    );

    // 3️⃣ Primera verificación inmediata (background) para conocer el estado ya,
    //    sin esperar al primer tick.
    this.runHealthChecks().catch((err: unknown) =>
      this.logger.error(
        `Error en verificación inicial: ${getErrorMessage(err)}`,
      ),
    );

    // 4️⃣ Limpieza diaria a las 3 AM (retención de incidentes resueltos).
    const cleanupJob = new CronJob('0 0 3 * * *', () => {
      void this.cleanOldIncidents();
    });
    this.schedulerRegistry.addCronJob('monitorCleanup', cleanupJob);
    cleanupJob.start();
  }

  private async runHealthChecks() {
    try {
      const results = await Promise.allSettled(
        ACTIVE_SERVICES.map((svc) => this.checkers.checkService(svc)),
      );

      for (let i = 0; i < results.length; i++) {
        const svc = ACTIVE_SERVICES[i];
        const settled = results[i];
        const result: CheckResult =
          settled.status === 'fulfilled'
            ? settled.value
            : {
                status: 'DOWN',
                latencyMs: null,
                errorCode: 'UNHANDLED',
                errorMessage:
                  getErrorMessage(settled.reason) || 'Promise rejected',
              };

        // Servicio "no aplica" en este ciclo (ej. Gemini/Meta sin organización):
        // no se monitorea, no abre ni cierra incidentes.
        if (result.skip) continue;

        const newStatus = result.status;
        const prev = this.lastKnownStatus.get(svc.key);

        if (newStatus === 'UP') {
          if (prev && prev.status !== 'UP') {
            // Recuperación: cerrar incidente.
            if (prev.incidentId) await this.closeIncident(prev.incidentId);
            await this.alertas?.resolver(claveAlerta.servicio(svc.key));
          }
          this.lastKnownStatus.set(svc.key, { status: 'UP' });
          continue;
        }

        // Caído: abre incidente si viene de UP (o es la primera observación). Si
        // ya estaba caído no escribe en ServiceIncident, aunque cambie
        // DOWN↔DEGRADED: es el mismo incidente.
        const seguidos =
          prev && prev.status !== 'UP' ? (prev.seguidos ?? 1) + 1 : 1;
        if (!prev || prev.status === 'UP') {
          await this.openIncident(svc.key, result);
        }
        const estado = this.lastKnownStatus.get(svc.key);
        this.lastKnownStatus.set(svc.key, {
          ...estado,
          status: newStatus,
          seguidos,
        });

        if (this.alertas && incidenteDebeAvisar(result, seguidos)) {
          await this.alertas.avisar({
            ...alertaDeIncidente({
              serviceKey: svc.key,
              displayName: svc.displayName,
              status: newStatus,
              errorMessage: result.errorMessage,
            }),
            serviceIncidentId: estado?.incidentId ?? null,
            fuente: 'centinela del monitor',
          });
        }
      }
      await this.alertas?.cronBien('centinela');
    } catch (error: unknown) {
      // Nunca re-lanzar: el cron debe sobrevivir al próximo tick.
      this.logger.error(
        `runHealthChecks crasheó: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      // Con la base caída es justo aquí donde revienta (abrir el incidente): el
      // aviso sale igual, por el camino sin base.
      await this.alertas?.cronFallo(
        'centinela',
        'Centinela del monitor',
        error,
      );
    }
  }

  private async openIncident(serviceKey: string, result: CheckResult) {
    const incident = await this.prisma.serviceIncident.create({
      data: {
        serviceKey,
        status: result.status, // 'DOWN' o 'DEGRADED'
        startedAt: new Date(),
        errorMessage: result.errorMessage ?? null,
        errorCode: result.errorCode ?? null,
        httpStatus: result.httpStatus ?? null,
        latencyMs: result.latencyMs ?? null,
      },
    });
    this.lastKnownStatus.set(serviceKey, {
      status: result.status,
      incidentId: incident.id,
    });
    this.logger.warn(`🚨 Incidente abierto: ${serviceKey} → ${result.status}`);
  }

  private async closeIncident(incidentId: string) {
    const incident = await this.prisma.serviceIncident.update({
      where: { id: incidentId },
      data: { resolvedAt: new Date() },
    });
    const durationMs =
      incident.resolvedAt!.getTime() - incident.startedAt.getTime();
    this.logger.log(
      `✅ Incidente cerrado: ${incident.serviceKey} (duración: ${Math.round(
        durationMs / 1000,
      )}s)`,
    );
  }

  private async cleanOldIncidents() {
    const retentionDays = Number(
      this.config.get('MONITOR_RETENTION_DAYS') ?? 365,
    );
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      const result = await this.prisma.serviceIncident.deleteMany({
        where: { resolvedAt: { not: null, lt: cutoff } },
      });
      this.logger.log(
        `🧹 Limpieza: ${result.count} incidente(s) antiguo(s) eliminado(s)`,
      );
      await this.alertas?.cronBien('limpieza-monitor');
    } catch (error: unknown) {
      this.logger.error(
        `La limpieza de incidentes falló: ${getErrorMessage(error)}`,
      );
      await this.alertas?.cronFallo(
        'limpieza-monitor',
        'Limpieza del monitor',
        error,
      );
    }
  }
}
