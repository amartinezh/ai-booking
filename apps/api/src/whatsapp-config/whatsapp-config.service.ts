import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import type {
  PublicWhatsappConfig,
  SaveWhatsappConfigInput,
} from './dto/whatsapp-config.types';

/**
 * CRUD del canal WhatsApp para que el ORG_ADMIN configure sus credenciales.
 *
 * - Encripta `accessToken` con AES-256-GCM antes de almacenarlo.
 * - Devuelve `PublicWhatsappConfig` (sin token en claro) hacia el frontend.
 * - Genera/persiste `verifyToken` aleatorio si la clínica no provee uno.
 */
@Injectable()
export class WhatsappConfigService {
  private readonly logger = new Logger(WhatsappConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Devuelve la URL del webhook que la clínica debe pegar en Meta. */
  buildWebhookUrl(): string {
    const base =
      process.env.PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://api.agendamiento-ia.com';
    return `${base.replace(/\/+$/, '')}/chatbot/webhook`;
  }

  async getPublic(organizationId: string): Promise<PublicWhatsappConfig> {
    const row = await this.prisma.whatsappAccountConfig.findUnique({
      where: { organizationId },
    });

    let accessTokenLast4: string | null = null;
    let hasAccessToken = false;
    if (row?.encryptedAccessToken) {
      try {
        const token = this.crypto.decrypt(row.encryptedAccessToken);
        hasAccessToken = Boolean(token);
        accessTokenLast4 = token ? token.slice(-4) : null;
      } catch {
        hasAccessToken = false;
      }
    }

    return {
      phoneNumberId: row?.phoneNumberId ?? null,
      businessAccountId: row?.businessAccountId ?? null,
      displayPhoneNumber: row?.displayPhoneNumber ?? null,
      verifyToken: row?.verifyToken ?? null,
      hasAccessToken,
      accessTokenLast4,
      isActive: row?.isActive ?? false,
      webhookCallbackUrl: this.buildWebhookUrl(),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async upsert(
    organizationId: string,
    input: SaveWhatsappConfigInput,
  ): Promise<PublicWhatsappConfig> {
    const existing = await this.prisma.whatsappAccountConfig.findUnique({
      where: { organizationId },
    });

    // Normalizar inputs vacíos → null para evitar guardar "" en columnas UNIQUE.
    const phoneNumberId = normalizeOrNull(input.phoneNumberId);
    const businessAccountId = normalizeOrNull(input.businessAccountId);
    const displayPhoneNumber = normalizeOrNull(input.displayPhoneNumber);

    // verifyToken: si el frontend no manda uno y no existe previo, generamos uno.
    let verifyToken = normalizeOrNull(input.verifyToken);
    if (!verifyToken) {
      verifyToken = existing?.verifyToken ?? this.generateVerifyToken();
    }

    // accessToken: si viene vacío, conservamos el actual (UX "no rotar").
    let encryptedAccessToken = existing?.encryptedAccessToken ?? null;
    const incomingToken = normalizeOrNull(input.accessToken);
    if (incomingToken) {
      encryptedAccessToken = this.crypto.encrypt(incomingToken);
    }

    // Validación de unicidad anticipada (mejor UX que un error de Prisma).
    if (phoneNumberId) {
      const collision = await this.prisma.whatsappAccountConfig.findUnique({
        where: { phoneNumberId },
      });
      if (collision && collision.organizationId !== organizationId) {
        throw new BadRequestException(
          'Este Phone Number ID ya está registrado por otra clínica en AgenIA.',
        );
      }
    }
    if (verifyToken) {
      const collision = await this.prisma.whatsappAccountConfig.findUnique({
        where: { verifyToken },
      });
      if (collision && collision.organizationId !== organizationId) {
        // Si el token chocó (poco probable), regenera y reintenta una vez.
        verifyToken = this.generateVerifyToken();
      }
    }

    // isActive automático: requerimos phoneNumberId + access token cifrado.
    const isActive = Boolean(
      input.isActive ??
        (phoneNumberId && (encryptedAccessToken ?? null)),
    );

    await this.prisma.whatsappAccountConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        phoneNumberId,
        businessAccountId,
        displayPhoneNumber,
        verifyToken,
        encryptedAccessToken,
        isActive,
      },
      update: {
        phoneNumberId,
        businessAccountId,
        displayPhoneNumber,
        verifyToken,
        encryptedAccessToken,
        isActive,
      },
    });

    return this.getPublic(organizationId);
  }

  private generateVerifyToken(): string {
    // 32 bytes hex = 64 chars; suficientemente impredecible para Meta.
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.randomBytes(32).toString('hex');
  }
}

function normalizeOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
