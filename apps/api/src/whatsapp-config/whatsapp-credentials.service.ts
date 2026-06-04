import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { ResolvedWhatsappCredentials } from './dto/whatsapp-config.types';

/**
 * Resolución de credenciales WhatsApp por organización.
 *
 * Centraliza la lectura/desencriptación del `accessToken` y la búsqueda
 * por `phoneNumberId` (para enrutamiento entrante) y `verifyToken`
 * (para validación del webhook GET de Meta).
 *
 * El access token NUNCA sale de este servicio en claro hacia el frontend:
 * sólo se materializa hacia el `ChatbotService` justo antes de invocar
 * la Graph API.
 */
@Injectable()
export class WhatsappCredentialsService {
  private readonly logger = new Logger(WhatsappCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Resuelve credenciales completas (con token en claro) por organizationId. */
  async forOrg(
    organizationId: string,
  ): Promise<ResolvedWhatsappCredentials | null> {
    const row = await this.prisma.whatsappAccountConfig.findUnique({
      where: { organizationId },
    });
    return this.materialize(row);
  }

  /**
   * Resuelve credenciales por `phone_number_id` que viene en el payload
   * entrante de Meta. Es la ruta crítica del webhook POST: aquí decidimos
   * a qué tenant pertenece cada mensaje.
   */
  async forPhoneNumberId(
    phoneNumberId: string,
  ): Promise<ResolvedWhatsappCredentials | null> {
    if (!phoneNumberId) return null;
    const row = await this.prisma.whatsappAccountConfig.findUnique({
      where: { phoneNumberId },
    });
    return this.materialize(row);
  }

  /**
   * Resuelve la organización por `verify_token` enviado en el webhook GET
   * de verificación de Meta. Devuelve sólo el organizationId — el GET no
   * necesita las credenciales completas.
   */
  async organizationIdByVerifyToken(
    verifyToken: string,
  ): Promise<string | null> {
    if (!verifyToken) return null;
    const row = await this.prisma.whatsappAccountConfig.findUnique({
      where: { verifyToken },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private materialize(
    row: {
      organizationId: string;
      phoneNumberId: string | null;
      encryptedAccessToken: string | null;
      isActive: boolean;
    } | null,
  ): ResolvedWhatsappCredentials | null {
    if (!row) return null;
    if (!row.phoneNumberId) return null;
    if (!row.encryptedAccessToken) return null;
    try {
      const accessToken = this.crypto.decrypt(row.encryptedAccessToken);
      if (!accessToken) return null;
      return {
        organizationId: row.organizationId,
        phoneNumberId: row.phoneNumberId,
        accessToken,
        isActive: row.isActive,
      };
    } catch (e: any) {
      this.logger.error(
        `Falló desencriptado de access token para org ${row.organizationId}: ${e.message}`,
      );
      return null;
    }
  }
}
