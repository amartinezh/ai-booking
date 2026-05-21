import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import {
  GeminiDiagnosisResult,
  MetaDiagnosisResult,
} from './dto/diagnostics.types';

/** Versión de la Graph API contra la que validamos credenciales. */
const META_GRAPH_VERSION = 'v21.0';
/** Cap de latencia antes de declarar TIMEOUT (alineado con SEMANTIC_MAP_TIMEOUT). */
const GEMINI_TIMEOUT_MS = 8000;
const META_TIMEOUT_MS = 8000;

/**
 * Agente de diagnóstico de integraciones externas (Gemini + Meta).
 *
 * Cada método recibe el `organizationId` ya resuelto desde el token por el
 * RolesGuard y NUNCA acepta credenciales desde el cliente: las lee cifradas
 * de la BD vía los servicios de cada dominio. El objetivo es validar
 * conectividad real con el mínimo costo (un prompt trivial / un GET de
 * verificación) sin emitir mensajes ni dictados reales.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly llmFactory: LlmFactoryService,
    private readonly whatsappCreds: WhatsappCredentialsService,
    private readonly http: HttpService,
  ) {}

  // ── Gemini ────────────────────────────────────────────────────────────────

  /**
   * Ping determinista a la API de Google. Mide el RTT exacto del viaje de
   * ida y vuelta y clasifica el fallo (timeout, auth, etc.) para el panel.
   */
  async diagnoseGemini(organizationId: string): Promise<GeminiDiagnosisResult> {
    const provider = await this.llmFactory.forOrgOrNull(organizationId);
    if (!provider) {
      return {
        success: false,
        error_code: 'NO_PROVIDER',
        error_message:
          'La organización no tiene un proveedor de IA activo. Configúralo en Integración de IA.',
      };
    }

    const startedAt = Date.now();
    try {
      // Prompt minimal y determinista: pedimos un eco corto.
      const modelResponse = await this.withTimeout(
        provider.answerFAQ(
          'Eres un sonda de salud. Responde única y exactamente con el texto que envíe el usuario, sin agregar nada.',
          'echo: ok',
        ),
        GEMINI_TIMEOUT_MS,
        'SEMANTIC_MAP_TIMEOUT',
      );

      const rtt_ms = Date.now() - startedAt;
      return {
        success: true,
        status: 'alive',
        rtt_ms,
        model_response: (modelResponse ?? '').trim() || 'ok',
        model: provider.name,
      };
    } catch (error: any) {
      const rtt_ms = Date.now() - startedAt;
      return this.classifyGeminiError(error, rtt_ms);
    }
  }

  private classifyGeminiError(
    error: any,
    rtt_ms: number,
  ): GeminiDiagnosisResult {
    const raw = this.extractMessage(error);
    const haystack = raw.toLowerCase();

    if (
      haystack.includes('semantic_map_timeout') ||
      haystack.includes('timeout') ||
      haystack.includes('timed out') ||
      haystack.includes('deadline') ||
      haystack.includes('etimedout') ||
      error?.name === 'TimeoutError'
    ) {
      this.logger.warn(`Diagnóstico Gemini TIMEOUT tras ${rtt_ms}ms: ${raw}`);
      return {
        success: false,
        error_code: 'TIMEOUT',
        error_message:
          'La API de Google no respondió a tiempo (SEMANTIC_MAP_TIMEOUT). ' +
          'Reintenta o revisa la latencia/cuota del proyecto en Google AI Studio.',
        rtt_ms,
      };
    }

    if (
      haystack.includes('api key') ||
      haystack.includes('api_key') ||
      haystack.includes('permission') ||
      haystack.includes('401') ||
      haystack.includes('403') ||
      haystack.includes('unauthenticated')
    ) {
      return {
        success: false,
        error_code: 'AUTH',
        error_message: `Gemini rechazó las credenciales: ${raw}`,
        rtt_ms,
      };
    }

    this.logger.error(`Diagnóstico Gemini falló: ${raw}`);
    return {
      success: false,
      error_code: 'UNKNOWN',
      error_message: raw,
      rtt_ms,
    };
  }

  // ── Meta (WhatsApp Business / Graph API) ───────────────────────────────────

  /**
   * Valida las credenciales de Meta llamando al endpoint del phone_number_id
   * (sin enviar mensajes). Sanea el Bearer token antes de armar la cabecera
   * para evitar el error conocido "Invalid character in header".
   */
  async diagnoseMeta(organizationId: string): Promise<MetaDiagnosisResult> {
    const creds = await this.whatsappCreds.forOrg(organizationId);
    if (!creds) {
      return {
        success: false,
        error_code: 'NOT_CONFIGURED',
        error_message:
          'El canal de WhatsApp no tiene Phone Number ID o Access Token configurados.',
      };
    }

    // CRÍTICO: limpieza/validación del token antes de construir la cabecera.
    const sanitized = sanitizeBearerToken(creds.accessToken);
    if (!sanitized.ok) {
      this.logger.error(
        `Token de Meta con formato inválido para org ${organizationId}: ${sanitized.reason}`,
      );
      return {
        success: false,
        error_code: 'INVALID_TOKEN_FORMAT',
        error_message: `El Access Token contiene caracteres no válidos para la cabecera HTTP (${sanitized.reason}). Vuelve a pegarlo sin espacios ni saltos de línea.`,
      };
    }

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${creds.phoneNumberId}`;
    const startedAt = Date.now();
    try {
      const response = await lastValueFrom(
        this.http.get(url, {
          // Cabecera ya saneada: garantizado sin \r \n ni espacios.
          headers: {
            Authorization: `Bearer ${sanitized.token}`,
            'Content-Type': 'application/json',
          },
          params: { fields: 'id,display_phone_number,verified_name' },
          timeout: META_TIMEOUT_MS,
        }),
      );

      const rtt_ms = Date.now() - startedAt;
      const data = response.data ?? {};
      return {
        success: true,
        status: 'verified',
        phone_id: String(data.id ?? creds.phoneNumberId),
        display_number: data.display_phone_number ?? null,
        verified_name: data.verified_name ?? null,
        rtt_ms,
      };
    } catch (error: any) {
      return this.classifyMetaError(error);
    }
  }

  private classifyMetaError(error: any): MetaDiagnosisResult {
    const metaError = error?.response?.data?.error;
    const status = error?.response?.status;

    if (metaError) {
      const code = metaError.code;
      const message: string =
        metaError.error_user_msg || metaError.message || 'Error de Meta.';

      // 190 = token inválido/expirado; 102/2500 también suelen ser auth/sesión.
      if (code === 190 || code === 102 || status === 401) {
        return {
          success: false,
          error_code: 'AUTH',
          error_message: `Meta rechazó el Access Token (code ${code}): ${message}`,
        };
      }
      return {
        success: false,
        error_code: 'BAD_REQUEST',
        error_message: `Meta respondió ${status ?? ''} (code ${code}): ${message}`,
      };
    }

    const raw = this.extractMessage(error);
    if (
      error?.code === 'ECONNABORTED' ||
      raw.toLowerCase().includes('timeout')
    ) {
      return {
        success: false,
        error_code: 'TIMEOUT',
        error_message: 'La Graph API de Meta no respondió a tiempo.',
      };
    }

    this.logger.error(`Diagnóstico Meta falló: ${raw}`);
    return {
      success: false,
      error_code: 'UNKNOWN',
      error_message: raw,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Envuelve una promesa con un timeout duro para no colgar la request HTTP. */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(label);
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() =>
      clearTimeout(timer),
    ) as Promise<T>;
  }

  private extractMessage(error: any): string {
    if (!error) return 'Error desconocido.';
    if (typeof error === 'string') return error;
    if (error.response?.data) {
      return typeof error.response.data === 'object'
        ? JSON.stringify(error.response.data)
        : String(error.response.data);
    }
    return error.message ?? String(error);
  }
}

/**
 * Limpia y valida un Bearer token antes de inyectarlo en una cabecera HTTP.
 *
 * Corrige el error "Invalid character in header content" que Node lanza cuando
 * el token arrastra saltos de línea, tabs o espacios (típico al copiar/pegar
 * desde el panel de Meta). Estrategia:
 *   1. Trim de extremos.
 *   2. Elimina TODO whitespace interno (\r \n \t y espacios) — un token Meta
 *      jamás contiene espacios legítimos.
 *   3. Rechaza si queda vacío o si persisten caracteres de control no ASCII
 *      imprimibles que romperían la cabecera.
 */
export function sanitizeBearerToken(
  rawToken: string,
):
  | { ok: true; token: string }
  | { ok: false; reason: string } {
  if (!rawToken) return { ok: false, reason: 'token vacío' };

  const stripped = rawToken.trim().replace(/\s+/g, '');
  if (!stripped) {
    return { ok: false, reason: 'token vacío tras limpiar espacios' };
  }

  // Las cabeceras HTTP sólo aceptan VCHAR (0x21–0x7E). Cualquier carácter de
  // control o no-ASCII restante haría fallar el envío.
  if (/[^\x21-\x7E]/.test(stripped)) {
    return { ok: false, reason: 'caracteres de control o no-ASCII' };
  }

  return { ok: true, token: stripped };
}
