import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorCheckers } from './monitor.checkers';
import { ACTIVE_SERVICES, CheckResult } from './services.config';

/** Estado en memoria del último resultado conocido de cada servicio. */
interface KnownState {
  status: string; // 'UP' | 'DOWN' | 'DEGRADED'
  incidentId?: string; // incidente abierto asociado (si status != UP)
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
      this.config.get('MONITOR_BG_INTERVAL_MINUTES') ?? 15,
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
    } catch (error: any) {
      this.logger.error(
        `No se pudo reconstruir estado de incidentes (¿falta la migración de ServiceIncident?): ${error.message}. El monitor arranca con estado vacío.`,
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
    this.runHealthChecks().catch((err) =>
      this.logger.error(`Error en verificación inicial: ${err.message}`),
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
                errorMessage: settled.reason?.message || 'Promise rejected',
              };

        // Servicio "no aplica" en este ciclo (ej. Gemini/Meta sin organización):
        // no se monitorea, no abre ni cierra incidentes.
        if (result.skip) continue;

        const newStatus = result.status;
        const prev = this.lastKnownStatus.get(svc.key);

        if (!prev) {
          // Primera observación del servicio.
          if (newStatus !== 'UP') {
            await this.openIncident(svc.key, result);
          } else {
            this.lastKnownStatus.set(svc.key, { status: 'UP' });
          }
        } else if (prev.status === 'UP' && newStatus !== 'UP') {
          // UP → DOWN/DEGRADED: abrir incidente.
          await this.openIncident(svc.key, result);
        } else if (prev.status !== 'UP' && newStatus === 'UP') {
          // Recuperación: cerrar incidente.
          if (prev.incidentId) await this.closeIncident(prev.incidentId);
          this.lastKnownStatus.set(svc.key, { status: 'UP' });
        }
        // UP→UP o caído→caído (incluso si cambia DOWN↔DEGRADED): no escribir.
      }
    } catch (error: any) {
      // Nunca re-lanzar: el cron debe sobrevivir al próximo tick.
      this.logger.error(
        `runHealthChecks crasheó: ${error.message}`,
        error.stack,
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
    const result = await this.prisma.serviceIncident.deleteMany({
      where: { resolvedAt: { not: null, lt: cutoff } },
    });
    this.logger.log(
      `🧹 Limpieza: ${result.count} incidente(s) antiguo(s) eliminado(s)`,
    );
  }
}
