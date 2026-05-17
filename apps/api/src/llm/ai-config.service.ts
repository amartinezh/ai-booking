import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  DecryptedAiConfig,
  PROVIDER_MODELS,
} from './interfaces/llm-provider.interface';
import type {
  PublicAiConfig,
  SaveAiConfigInput,
} from './dto/ai-config.types';

@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getPublic(organizationId: string): Promise<PublicAiConfig> {
    const row = await this.prisma.aiProviderConfig.findUnique({
      where: { organizationId },
    });

    if (!row) {
      return {
        activeProvider: 'NONE',
        model: null,
        hasApiKey: false,
        apiKeyLast4: null,
        openaiOrganizationId: null,
        updatedAt: null,
      };
    }

    let decoded: DecryptedAiConfig | null = null;
    if (row.encryptedApiConfig) {
      try {
        decoded = this.crypto.decryptJson<DecryptedAiConfig>(
          row.encryptedApiConfig,
        );
      } catch {
        decoded = null;
      }
    }

    return {
      activeProvider: row.activeProvider,
      model: decoded?.model ?? null,
      hasApiKey: Boolean(decoded?.apiKey),
      apiKeyLast4: decoded?.apiKey ? decoded.apiKey.slice(-4) : null,
      openaiOrganizationId: decoded?.organizationId ?? null,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(
    organizationId: string,
    input: SaveAiConfigInput,
  ): Promise<PublicAiConfig> {
    const { activeProvider } = input;

    if (activeProvider === 'NONE') {
      // Desactivar IA: limpiamos el blob encriptado.
      await this.prisma.aiProviderConfig.upsert({
        where: { organizationId },
        create: {
          organizationId,
          activeProvider: 'NONE',
          encryptedApiConfig: null,
        },
        update: { activeProvider: 'NONE', encryptedApiConfig: null },
      });
      return this.getPublic(organizationId);
    }

    // Validar modelo contra catálogo permitido por proveedor.
    const allowedModels: readonly string[] =
      PROVIDER_MODELS[activeProvider as keyof typeof PROVIDER_MODELS] ?? [];
    const model =
      input.model && allowedModels.includes(input.model)
        ? input.model
        : allowedModels[0];

    // Si el frontend NO mandó apiKey, conservamos la existente (UX "no rotar").
    let apiKey = input.apiKey?.trim() || '';
    if (!apiKey) {
      const existing = await this.prisma.aiProviderConfig.findUnique({
        where: { organizationId },
      });
      if (existing?.encryptedApiConfig) {
        try {
          const decoded = this.crypto.decryptJson<DecryptedAiConfig>(
            existing.encryptedApiConfig,
          );
          apiKey = decoded.apiKey;
        } catch {
          // Si no se puede leer, exigimos nueva apiKey.
        }
      }
    }
    if (!apiKey) {
      throw new BadRequestException(
        'apiKey es requerida para activar este proveedor de IA.',
      );
    }

    const decoded: DecryptedAiConfig = {
      apiKey,
      model,
      ...(activeProvider === 'CHATGPT' && input.openaiOrganizationId
        ? { organizationId: input.openaiOrganizationId }
        : {}),
    };

    const encryptedApiConfig = this.crypto.encryptJson(decoded);

    await this.prisma.aiProviderConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        activeProvider,
        encryptedApiConfig,
      },
      update: { activeProvider, encryptedApiConfig },
    });

    return this.getPublic(organizationId);
  }
}
