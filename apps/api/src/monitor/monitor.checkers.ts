import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import textToSpeech from '@google-cloud/text-to-speech';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckResult, ServiceConfig } from './services.config';

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
  private readonly ttsClient = new textToSpeech.TextToSpeechClient();

  /** Umbral de latencia: por encima, un check exitoso se marca DEGRADED. */
  private readonly degradedThresholdMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
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
    } catch (error: any) {
      const isTimeout = error?.name === 'TimeoutError';
      return {
        status: 'DOWN',
        latencyMs: null,
        errorCode: isTimeout ? 'TIMEOUT' : 'UNKNOWN',
        errorMessage: isTimeout
          ? `El check superó el timeout de ${svc.timeoutMs}ms.`
          : error?.message || 'Error desconocido en el check.',
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
      default:
        return Promise.resolve({
          status: 'DOWN',
          latencyMs: null,
          errorCode: 'NO_CHECKER',
          errorMessage: `No hay checker implementado para "${svc.key}".`,
        });
    }
  }

  // ── Gemini ─────────────────────────────────────────────────────────────────

  private async checkGemini(): Promise<CheckResult> {
    const orgId = this.targetOrgId();
    if (!orgId) return this.missingTargetOrg();

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
    const orgId = this.targetOrgId();
    if (!orgId) return this.missingTargetOrg();

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
    const startedAt = Date.now();
    try {
      await this.ttsClient.listVoices({ languageCode: 'es-US' });
      return this.gradeLatency(Date.now() - startedAt, 200);
    } catch (error: any) {
      const raw = error?.details || error?.message || String(error);
      const haystack = String(raw).toLowerCase();
      let errorCode = 'UNKNOWN';
      if (haystack.includes('permission') || haystack.includes('credential') || haystack.includes('unauthenticated')) {
        errorCode = 'AUTH';
      } else if (haystack.includes('deadline') || haystack.includes('timeout')) {
        errorCode = 'TIMEOUT';
      }
      this.logger.warn(`Check TTS falló: ${raw}`);
      return {
        status: 'DOWN',
        latencyMs: Date.now() - startedAt,
        errorCode,
        errorMessage: String(raw),
      };
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private targetOrgId(): string | undefined {
    return this.config.get<string>('MONITOR_TARGET_ORG_ID') || undefined;
  }

  private missingTargetOrg(): CheckResult {
    return {
      status: 'DOWN',
      latencyMs: null,
      errorCode: 'NO_TARGET_ORG',
      errorMessage:
        'Falta MONITOR_TARGET_ORG_ID en el .env. El monitor no sabe qué organización usar para validar credenciales de Gemini/Meta.',
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
