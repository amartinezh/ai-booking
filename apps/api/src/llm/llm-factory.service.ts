import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LlmProvider } from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  DecryptedAiConfig,
  LLMProvider,
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

    let decoded: DecryptedAiConfig;
    try {
      decoded = this.crypto.decryptJson<DecryptedAiConfig>(
        config.encryptedApiConfig,
      );
    } catch (e: any) {
      this.logger.error(
        `Falló desencriptado de AiProviderConfig para org ${organizationId}: ${e.message}`,
      );
      return null;
    }

    return this.build(config.activeProvider, decoded);
  }

  private build(
    provider: LlmProvider,
    config: DecryptedAiConfig,
  ): LLMProvider {
    switch (provider) {
      case 'GEMINI':
        return new GeminiProvider(config);
      case 'CHATGPT':
        return new ChatGptProvider(config);
      case 'CLAUDE':
        return new ClaudeProvider(config);
      case 'NONE':
      default:
        throw new NotFoundException(
          `Proveedor LLM no soportado: ${provider}`,
        );
    }
  }
}
