import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  DecryptedAiConfig,
  MultiProviderBlob,
  PROVIDER_MODELS,
  decodeMultiProviderBlob,
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

    // Lee el mapa multi-proveedor (compat con la forma vieja single-provider).
    const byProvider = this.readByProvider(row.encryptedApiConfig, row.activeProvider);
    const activeCfg =
      row.activeProvider !== 'NONE' ? byProvider[row.activeProvider] : undefined;

    return {
      activeProvider: row.activeProvider,
      model: activeCfg?.model ?? null,
      hasApiKey: Boolean(activeCfg?.apiKey),
      apiKeyLast4: activeCfg?.apiKey ? activeCfg.apiKey.slice(-4) : null,
      openaiOrganizationId: activeCfg?.organizationId ?? null,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(
    organizationId: string,
    input: SaveAiConfigInput,
  ): Promise<PublicAiConfig> {
    const { activeProvider } = input;

    if (activeProvider === 'NONE') {
      // Desactivar IA: limpiamos el blob encriptado entero (también las keys
      // de respaldo). Es consistente con "modo manual: nada de IA".
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

    // Leemos el mapa actual para PRESERVAR las credenciales de los otros
    // proveedores. Sin esto, al cambiar de Gemini a OpenAI se perdía la key
    // de Gemini y el failover no tenía a quién recurrir.
    const existing = await this.prisma.aiProviderConfig.findUnique({
      where: { organizationId },
    });
    const byProvider = this.readByProvider(
      existing?.encryptedApiConfig ?? null,
      existing?.activeProvider ?? 'NONE',
    );

    // Si el frontend NO mandó apiKey, conservamos la del proveedor que se
    // está activando (UX "no rotar"). Si tampoco hay key previa, exigimos una.
    let apiKey = input.apiKey?.trim() || '';
    if (!apiKey) {
      apiKey = byProvider[activeProvider]?.apiKey ?? '';
    }
    if (!apiKey) {
      throw new BadRequestException(
        'apiKey es requerida para activar este proveedor de IA.',
      );
    }

    // Merge: actualizamos SOLO la entrada del proveedor que se está guardando.
    byProvider[activeProvider] = {
      apiKey,
      model,
      ...(activeProvider === 'CHATGPT' && input.openaiOrganizationId
        ? { organizationId: input.openaiOrganizationId }
        : {}),
    };

    const blob: MultiProviderBlob = { byProvider };
    const encryptedApiConfig = this.crypto.encryptJson(blob);

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

  /**
   * Desencripta el blob y lo normaliza al mapa por proveedor.
   * Tolerante a la forma vieja (single-provider) y a errores de descifrado.
   */
  private readByProvider(
    encrypted: string | null,
    activeProvider: 'GEMINI' | 'CHATGPT' | 'CLAUDE' | 'NONE',
  ): MultiProviderBlob['byProvider'] {
    if (!encrypted) return {};
    try {
      const decoded = this.crypto.decryptJson<unknown>(encrypted);
      return decodeMultiProviderBlob(decoded, activeProvider);
    } catch {
      return {};
    }
  }
}
