import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import textToSpeech from '@google-cloud/text-to-speech';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramConfigService } from '../telegram/telegram-config.service';
import { TelegramApiClient } from '../telegram/telegram-api.client';
import { CryptoService } from '../common/crypto/crypto.service';
import { urlDelWebhook } from '../support-bot/support-bot-config.service';
import { CheckResult, ServiceConfig } from './services.config';
import { getErrorMessage } from '../common/error-message.util';
import { isGoogleTtsEnabled } from '../audio-config/tts/google-tts.service';
import { compuertasHis, eventoPuedeSalir } from '@agenia/shared';
import { Prisma } from '@agenia/database';

/**
 * Cuántos pendientes (los más viejos) se miran para hallar el más viejo que SÍ
 * puede salir. Con las compuertas cerradas puede haber cientos esperando a
 * propósito; si los 500 más viejos esperan, el checker no ve más allá (y no hay
 * que alarmarse por ellos).
 */
const MAX_PENDIENTES_MIRADOS = 500;

/**
 * Ejecuta el health check concreto de cada servicio externo y normaliza el
 * resultado a `CheckResult`. Compartido por el cron de fondo (MODO A) y el
 * endpoint en vivo (MODO B).
 *
 * Reutiliza `IntegrationsService` (la misma lógica del botón "Verificar
 * Google/Facebook") para Gemini y Meta. Como ese diagnóstico es POR
 * ORGANIZACIÓN y el monitor es global, validamos contra una organización
 * "testigo" designada por `MONITOR_TARGET_ORG_ID`. Google Cloud TTS usa
 * credenciales globales (GOOGLE_APPLICATION_CREDENTIALS), así que no necesita
 * organización.
 */
@Injectable()
export class MonitorCheckers {
  private readonly logger = new Logger(MonitorCheckers.name);
  /** Perezoso: no se crea mientras Google TTS esté apagado (GOOGLE_TTS_ENABLED). */
  private ttsClient?: InstanceType<typeof textToSpeech.TextToSpeechClient>;

  /** Umbral de latencia: por encima, un check exitoso se marca DEGRADED. */
  private readonly degradedThresholdMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
    private readonly telegramConfig: TelegramConfigService,
    @Optional() private readonly telegramApi?: TelegramApiClient,
    @Optional() private readonly cipher?: CryptoService,
  ) {
    this.degradedThresholdMs =
      Number(this.config.get('MONITOR_DEGRADED_THRESHOLD_MS')) || 3000;
  }

  /**
   * Punto de entrada único. Despacha por `svc.key` y captura CUALQUIER
   * excepción, devolviéndola como DOWN — nunca lanza, para no tumbar al cron
   * ni al endpoint en vivo.
   */
  async checkService(svc: ServiceConfig): Promise<CheckResult> {
    try {
      const result = await this.withTimeout(this.dispatch(svc), svc.timeoutMs);
      return result;
    } catch (error: unknown) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      return {
        status: 'DOWN',
        latencyMs: null,
        errorCode: isTimeout ? 'TIMEOUT' : 'UNKNOWN',
        errorMessage: isTimeout
          ? `El check superó el timeout de ${svc.timeoutMs}ms.`
          : getErrorMessage(error) || 'Error desconocido en el check.',
      };
    }
  }

  private dispatch(svc: ServiceConfig): Promise<CheckResult> {
    switch (svc.key) {
      case 'gemini':
        return this.checkGemini();
      case 'tts':
        return this.checkTts();
      case 'meta':
        return this.checkMeta();
      case 'mirror':
        return this.checkMirror();
      case 'telegram':
        return this.checkTelegram();
      case 'soporte':
        return this.checkSoporte();
      default:
        return Promise.resolve({
          status: 'DOWN',
          latencyMs: null,
          errorCode: 'NO_CHECKER',
          errorMessage: `No hay checker implementado para "${svc.key}".`,
        });
    }
  }

  // ── Espejo con el HIS ──────────────────────────────────────────────────────

  /**
   * Salud REAL del espejo, no solo si el agente respira.
   *
   * El 2026-08-31 se comprobó que el agente mandaba heartbeat puntual mientras
   * fallaba el 100 % de sus eventos: `lastHeartbeatAt` al día, `SyncOutbox`
   * atascado y el hospital sin ver una sola cita. Un operador mirando el panel
   * habría visto todo verde.
   *
   * Se miran tres cosas, en orden de gravedad:
   *   1. Eventos en dead-letter → algo se rindió tras 10 intentos y nadie lo vio.
   *   2. Eventos pendientes viejos → la cola no avanza.
   *   3. Heartbeat ausente → el agente no está corriendo, o perdió la red.
   *   4. El agente late pero NO alcanza la base del hospital (`lastHisReachable`,
   *      que él mismo reporta en cada latido) → ninguna cita llega al HIS. Antes
   *      solo se notaba a los 10 min de cola quieta, y solo si hubo movimiento.
   */
  private async checkMirror(): Promise<CheckResult> {
    const inicio = Date.now();

    const configs = await this.prisma.hospitalMirrorConfig.findMany({
      where: { enabled: true },
      select: {
        organizationId: true,
        lastHeartbeatAt: true,
        lastHisReachable: true,
        lastHisDetail: true,
      },
    });

    // Ninguna organización con espejo: no aplica, ni verde ni rojo.
    if (configs.length === 0) {
      return { status: 'UP', latencyMs: Date.now() - inicio, skip: true };
    }

    const umbralPendienteMs =
      Number(this.config.get('MIRROR_STALE_EVENT_MS')) || 10 * 60_000;
    const umbralHeartbeatMs =
      Number(this.config.get('MIRROR_HEARTBEAT_MAX_AGE_MS')) || 5 * 60_000;
    const ahora = Date.now();

    const problemas: string[] = [];
    let peor: CheckResult['status'] = 'UP';

    for (const cfg of configs) {
      const [deadLetters, pendientes, ajustes] = await Promise.all([
        this.prisma.syncOutbox.count({
          where: { organizationId: cfg.organizationId, deadLettered: true },
        }),
        this.prisma.syncOutbox.findMany({
          where: {
            organizationId: cfg.organizationId,
            deliveredAt: null,
            deadLettered: false,
          },
          orderBy: { createdAt: 'asc' },
          take: MAX_PENDIENTES_MIRADOS,
          select: {
            createdAt: true,
            eventId: true,
            entityType: true,
            op: true,
            payload: true,
          },
        }),
        this.prisma.organizationSettings.findUnique({
          where: { organizationId: cfg.organizationId },
          select: {
            bookingEnabled: true,
            cancelEnabled: true,
            rescheduleEnabled: true,
          },
        }),
      ]);
      // 🚪 El más viejo de los que PUEDEN salir: lo que espera a que se abra su
      // compuerta («Agendar», «Cancelar», «Cambiar fecha») no es una cola
      // atascada, y lo que nunca va al hospital lo cierra la API sola.
      const compuertas = compuertasHis(ajustes);
      const masViejo = pendientes.find((e) => eventoPuedeSalir(e, compuertas));

      if (deadLetters > 0) {
        peor = 'DOWN';
        problemas.push(
          `${deadLetters} evento(s) en dead-letter (org ${cfg.organizationId}): ` +
            `el hospital NO los tiene y nadie los va a reintentar solo.`,
        );
      }

      // Con su compuerta CERRADA a propósito los eventos se quedan en la cola por
      // decisión, no por falla: que no avancen es lo esperado y no se reporta.
      // El dead-letter y el latido se siguen vigilando igual. Mismo criterio que
      // el vigilante de la bandeja (`MirrorWatchdogService`). Antes, dos
      // asistencias retenidas abrieron un incidente falso «mirror DEGRADED: la
      // cola no avanza» (2026-10-05).
      if (masViejo) {
        const antiguedad = ahora - masViejo.createdAt.getTime();
        if (antiguedad > umbralPendienteMs) {
          if (peor !== 'DOWN') peor = 'DEGRADED';
          problemas.push(
            `Evento pendiente desde hace ${Math.round(antiguedad / 60_000)} min ` +
              `(org ${cfg.organizationId}): la cola no avanza.`,
          );
        }
      }

      const heartbeat = cfg.lastHeartbeatAt?.getTime();
      if (!heartbeat || ahora - heartbeat > umbralHeartbeatMs) {
        peor = 'DOWN';
        problemas.push(
          heartbeat
            ? `Sin heartbeat del agente hace ${Math.round((ahora - heartbeat) / 60_000)} min ` +
                `(org ${cfg.organizationId}).`
            : `El agente de la org ${cfg.organizationId} nunca ha hecho handshake.`,
        );
      } else if (cfg.lastHisReachable === false) {
        // Solo con el latido al día: si el agente no late, lo que reportó la última
        // vez ya no dice nada (y el problema de arriba lo cubre).
        peor = 'DOWN';
        problemas.push(
          `El agente de la org ${cfg.organizationId} late, pero no alcanza la base del hospital` +
            (cfg.lastHisDetail ? ` (${cfg.lastHisDetail})` : '') +
            ': ninguna cita llega al HIS.',
        );
      }
    }

    return {
      status: peor,
      latencyMs: Date.now() - inicio,
      errorCode: peor === 'UP' ? null : 'MIRROR_UNHEALTHY',
      errorMessage: problemas.length > 0 ? problemas.join(' | ') : null,
    };
  }

  // ── Telegram ───────────────────────────────────────────────────────────────

  /**
   * Revisa el bot de CADA clínica con Telegram encendido (no una testigo: un
   * webhook caído en una clínica no lo delata otra). `getWebhookInfo` no
   * cuesta nada y es lo mismo que hace el botón «Verificar» del panel.
   *
   *   - Telegram ya no apunta a nosotros o el token fue revocado → DOWN: los
   *     pacientes escriben y nadie los lee.
   *   - Mensajes retenidos por encima del umbral, o retenidos con un error de
   *     entrega → DEGRADED: Telegram no logra entregarnos (el caso del 404).
   */
  private async checkTelegram(): Promise<CheckResult> {
    const inicio = Date.now();
    if (this.config.get<string>('TELEGRAM_ENABLED')?.trim() !== 'true') {
      return { status: 'UP', latencyMs: null, skip: true };
    }

    const bots = await this.prisma.telegramBotConfig.findMany({
      where: { isActive: true, organization: { isActive: true } },
      select: {
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    if (bots.length === 0) {
      return { status: 'UP', latencyMs: Date.now() - inicio, skip: true };
    }

    const umbralRetenidos =
      Number(this.config.get('MONITOR_TELEGRAM_PENDING_MAX')) || 10;
    const problemas: string[] = [];
    let peor: CheckResult['status'] = 'UP';

    const estados = await Promise.all(
      bots.map((b) => this.telegramConfig.verify(b.organizationId)),
    );
    estados.forEach((st, i) => {
      const clinica = bots[i].organization.name;
      const retenidos = st.pendingUpdateCount ?? 0;
      if (!st.webhookOk) {
        peor = 'DOWN';
        problemas.push(
          `${clinica}: Telegram no entrega al webhook` +
            (st.telegramLastError ? ` (${st.telegramLastError})` : '') +
            '.',
        );
      } else if (
        retenidos > umbralRetenidos ||
        (retenidos > 0 && st.telegramLastError)
      ) {
        if (peor !== 'DOWN') peor = 'DEGRADED';
        problemas.push(
          `${clinica}: ${retenidos} mensaje(s) retenidos en Telegram` +
            (st.telegramLastError ? ` — ${st.telegramLastError}` : '') +
            '.',
        );
      }
    });

    return {
      status: peor,
      latencyMs: Date.now() - inicio,
      errorCode: peor === 'UP' ? null : 'TELEGRAM_UNHEALTHY',
      errorMessage: problemas.length > 0 ? problemas.join(' | ') : null,
    };
  }

  // ── Asistente de soporte del personal ──────────────────────────────────────

  /**
   * El bot del asistente de soporte (docs/PLAN_BOT_SOPORTE.md, Fase 5): que
   * Telegram siga apuntando a su webhook y no retenga los mensajes del personal.
   * No aplica sin `SUPPORT_BOT_ENABLED=true` o con el asistente apagado o sin bot.
   * Sus incidentes no se le cuentan al personal (son internos).
   */
  private async checkSoporte(): Promise<CheckResult> {
    const inicio = Date.now();
    const noAplica: CheckResult = { status: 'UP', latencyMs: null, skip: true };
    if (this.config.get<string>('SUPPORT_BOT_ENABLED')?.trim() !== 'true') {
      return noAplica;
    }
    if (!this.telegramApi || !this.cipher) return noAplica;
    let row: {
      enabled: boolean;
      encryptedBotToken: string | null;
      routeKey: string | null;
    } | null;
    try {
      row = await this.prisma.supportBotConfig.findUnique({
        where: { id: 'global' },
        select: { enabled: true, encryptedBotToken: true, routeKey: true },
      });
    } catch (e: unknown) {
      // Sin su tabla (la API nueva arrancó y las migraciones van detrás, en
      // pleno despliegue) no hay asistente que vigilar todavía.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2021'
      ) {
        return noAplica;
      }
      throw e;
    }
    if (!row?.enabled || !row.encryptedBotToken || !row.routeKey) {
      return noAplica;
    }

    let token: string;
    try {
      token = this.cipher.decrypt(row.encryptedBotToken);
    } catch {
      return {
        status: 'DOWN',
        latencyMs: null,
        errorCode: 'AUTH',
        errorMessage:
          'No se pudo descifrar el token del bot del asistente (¿cambió ENCRYPTION_KEY?). Vuelva a conectarlo en «Asistente de soporte».',
      };
    }
    const info = await this.telegramApi.getWebhookInfo(token);
    if (!info.ok) {
      return {
        status: 'DOWN',
        latencyMs: Date.now() - inicio,
        errorCode: info.errorCode === 401 ? 'AUTH' : 'TELEGRAM',
        errorMessage: `Telegram no respondió por el bot del asistente: ${info.description}`,
      };
    }
    const latencyMs = Date.now() - inicio;
    const retenidos = info.result.pending_update_count ?? 0;
    const error = info.result.last_error_message ?? null;
    if (info.result.url !== urlDelWebhook(row.routeKey)) {
      return {
        status: 'DOWN',
        latencyMs,
        errorCode: 'TELEGRAM_UNHEALTHY',
        errorMessage:
          'Telegram no apunta al webhook del asistente: el personal escribe y nadie le responde. Vuelva a conectar el bot en «Asistente de soporte».',
      };
    }
    const umbral =
      Number(this.config.get('MONITOR_TELEGRAM_PENDING_MAX')) || 10;
    if (retenidos > umbral || (retenidos > 0 && error)) {
      return {
        status: 'DEGRADED',
        latencyMs,
        errorCode: 'TELEGRAM_UNHEALTHY',
        errorMessage:
          `${retenidos} mensaje(s) del personal retenidos en Telegram` +
          (error ? ` — ${error}` : '') +
          '.',
      };
    }
    return { status: 'UP', latencyMs, errorCode: null, errorMessage: null };
  }

  // ── Gemini ─────────────────────────────────────────────────────────────────

  private async checkGemini(): Promise<CheckResult> {
    const orgId = await this.resolveOrgId();
    if (!orgId) return this.skippedNoOrg();

    const r = await this.integrations.diagnoseGemini(orgId);
    if (r.success) {
      return this.gradeLatency(r.rtt_ms, 200);
    }
    return {
      status: 'DOWN',
      latencyMs: r.rtt_ms ?? null,
      errorCode: r.error_code,
      errorMessage: r.error_message,
    };
  }

  // ── Meta (WhatsApp Cloud API) ────────────────────────────────────────────────

  private async checkMeta(): Promise<CheckResult> {
    const orgId = await this.resolveOrgId();
    if (!orgId) return this.skippedNoOrg();

    const r = await this.integrations.diagnoseMeta(orgId);
    if (r.success) {
      return this.gradeLatency(r.rtt_ms, 200);
    }
    return {
      status: 'DOWN',
      latencyMs: r.rtt_ms ?? null,
      errorCode: r.error_code,
      errorMessage: r.error_message,
    };
  }

  // ── Google Cloud TTS ─────────────────────────────────────────────────────────

  /**
   * Check liviano: lista las voces disponibles (no sintetiza audio, no cuesta
   * cuota de caracteres). Usa las credenciales globales del cliente TTS.
   */
  private async checkTts(): Promise<CheckResult> {
    // Apagado a propósito: no aplica (ni incidente ni ruido en los logs).
    if (!isGoogleTtsEnabled()) {
      return { status: 'UP', latencyMs: null, skip: true };
    }
    const startedAt = Date.now();
    try {
      this.ttsClient ??= new textToSpeech.TextToSpeechClient();
      await this.ttsClient.listVoices({ languageCode: 'es-US' });
      return this.gradeLatency(Date.now() - startedAt, 200);
    } catch (error: unknown) {
      // El cliente de Google Cloud (gRPC) adjunta `.details`, mas informativo
      // que `.message` para estos errores — ninguna librería de error tipada
      // lo declara, así que se lee por duck-typing.
      const details =
        typeof error === 'object' && error !== null && 'details' in error
          ? (error as { details: unknown }).details
          : undefined;
      const raw =
        (typeof details === 'string' ? details : undefined) ||
        getErrorMessage(error);
      const haystack = raw.toLowerCase();
      let errorCode = 'UNKNOWN';
      if (
        haystack.includes('permission') ||
        haystack.includes('credential') ||
        haystack.includes('unauthenticated')
      ) {
        errorCode = 'AUTH';
      } else if (
        haystack.includes('deadline') ||
        haystack.includes('timeout')
      ) {
        errorCode = 'TIMEOUT';
      }
      this.logger.warn(`Check TTS falló: ${raw}`);
      return {
        status: 'DOWN',
        latencyMs: Date.now() - startedAt,
        errorCode,
        errorMessage: raw,
      };
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * Resuelve la organización "testigo" para Gemini/Meta: la activa más antigua.
   * Devuelve `null` si no hay ninguna → esos checks se omiten (no son fallos).
   */
  private async resolveOrgId(): Promise<string | null> {
    try {
      const org = await this.prisma.organization.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      return org?.id ?? null;
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo resolver organización testigo: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /** Resultado "no aplica": no hay organización contra la cual validar. */
  private skippedNoOrg(): CheckResult {
    return {
      status: 'UP',
      latencyMs: null,
      skip: true,
      errorCode: 'NO_ORG',
      errorMessage:
        'No hay organizaciones activas; este servicio no se monitorea por ahora.',
    };
  }

  /** Un check exitoso es UP, o DEGRADED si supera el umbral de latencia. */
  private gradeLatency(latencyMs: number, httpStatus: number): CheckResult {
    return {
      status: latencyMs > this.degradedThresholdMs ? 'DEGRADED' : 'UP',
      latencyMs,
      httpStatus,
      errorMessage:
        latencyMs > this.degradedThresholdMs
          ? `Latencia ${latencyMs}ms supera el umbral de ${this.degradedThresholdMs}ms.`
          : null,
      errorCode: latencyMs > this.degradedThresholdMs ? 'HIGH_LATENCY' : null,
    };
  }

  /** Envuelve una promesa con un timeout duro. Lanza TimeoutError al vencer. */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`timeout after ${ms}ms`);
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() =>
      clearTimeout(timer),
    ) as Promise<T>;
  }
}
