import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LlmProvider } from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  DecryptedAiConfig,
  LLMProvider,
  MultiProviderBlob,
  decodeMultiProviderBlob,
} from './interfaces/llm-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { ChatGptProvider } from './providers/chatgpt.provider';
import { ClaudeProvider } from './providers/claude.provider';

export class NoActiveLlmProviderError extends Error {
  constructor(organizationId: string) {
    super(
      `La organización ${organizationId} todavía no tiene un proveedor de IA configurado. ` +
        `Configúralo en /dashboard/configuracion → Integración de IA.`,
    );
    this.name = 'NoActiveLlmProviderError';
  }
}

/**
 * Resuelve, por `organizationId`, qué `LLMProvider` debe atender la petición.
 *
 *   1. Lee `AiProviderConfig` por organización.
 *   2. Desencripta `encryptedApiConfig` con CryptoService.
 *   3. Construye e instancia el provider correcto.
 *
 * El resultado NO se cachea entre requests para evitar arrastrar credenciales
 * obsoletas cuando la clínica rota su API key; los providers son baratos de
 * construir (solo guardan apiKey/model).
 */
@Injectable()
export class LlmFactoryService {
  private readonly logger = new Logger(LlmFactoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Lanza si la organización no tiene proveedor configurado.
   * Usar cuando la operación NO puede continuar sin LLM (ej. dictado clínico).
   */
  async forOrg(organizationId: string): Promise<LLMProvider> {
    const provider = await this.forOrgOrNull(organizationId);
    if (!provider) throw new NoActiveLlmProviderError(organizationId);
    return provider;
  }

  /**
   * Devuelve `null` cuando la organización no tiene proveedor activo.
   * Usar cuando el caller tiene un fallback degradado (ej. ChatbotService).
   * No cachea: cada llamada relee BD para que un cambio en la UI se aplique
   * en el siguiente turno sin reiniciar el contenedor.
   */
  async forOrgOrNull(organizationId: string): Promise<LLMProvider | null> {
    const config = await this.prisma.aiProviderConfig.findUnique({
      where: { organizationId },
    });

    if (!config || config.activeProvider === 'NONE') return null;
    if (!config.encryptedApiConfig) {
      this.logger.warn(
        `AiProviderConfig de ${organizationId} tiene activeProvider=${config.activeProvider} pero encryptedApiConfig vacío.`,
      );
      return null;
    }

    const byProvider = this.readByProvider(
      config.encryptedApiConfig,
      config.activeProvider,
    );
    const cfg = byProvider[config.activeProvider];
    if (!cfg) {
      this.logger.warn(
        `Org ${organizationId} marca activeProvider=${config.activeProvider} pero el blob no trae sus credenciales.`,
      );
      return null;
    }
    return this.build(config.activeProvider, cfg);
  }

  /**
   * Construye un proveedor ESPECÍFICO (no necesariamente el activo) a partir
   * de las credenciales guardadas de la org. Devuelve null si esa org no
   * tiene key para ese proveedor en BD. Usado por el failover del chatbot:
   * cuando el activo cae, el siguiente intento usa otra entrada del MISMO
   * mapa multi-proveedor, sin tocar el `.env`.
   */
  async forOrgByProvider(
    organizationId: string,
    provider: 'GEMINI' | 'CHATGPT' | 'CLAUDE',
  ): Promise<LLMProvider | null> {
    const config = await this.prisma.aiProviderConfig.findUnique({
      where: { organizationId },
    });
    if (!config || !config.encryptedApiConfig) return null;

    const byProvider = this.readByProvider(
      config.encryptedApiConfig,
      config.activeProvider,
    );
    const cfg = byProvider[provider];
    if (!cfg?.apiKey) return null;
    return this.build(provider, cfg);
  }

  /** Desencripta y normaliza al mapa multi-proveedor (con compat single-provider). */
  private readByProvider(
    encrypted: string,
    activeProvider: 'GEMINI' | 'CHATGPT' | 'CLAUDE' | 'NONE',
  ): MultiProviderBlob['byProvider'] {
    try {
      const decoded = this.crypto.decryptJson<unknown>(encrypted);
      return decodeMultiProviderBlob(decoded, activeProvider);
    } catch (e: any) {
      this.logger.error(
        `Falló desencriptado de AiProviderConfig: ${e.message}`,
      );
      return {};
    }
  }

  private build(provider: LlmProvider, config: DecryptedAiConfig): LLMProvider {
    switch (provider) {
      case 'GEMINI':
        return new GeminiProvider(config);
      case 'CHATGPT':
        return new ChatGptProvider(config);
      case 'CLAUDE':
        return new ClaudeProvider(config);
      case 'NONE':
      default:
        throw new NotFoundException(`Proveedor LLM no soportado: ${provider}`);
    }
  }
}
