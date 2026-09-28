import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { getErrorMessage } from '../common/error-message.util';
import { TelegramApiClient } from './telegram-api.client';
import type {
  PublicTelegramConfig,
  ResolvedTelegramCredentials,
  TelegramWebhookStatus,
  TelegramWebhookTarget,
} from './telegram.types';

/** Formato del token de BotFather: `<id del bot>:<secreto>`. */
const BOT_TOKEN_RE = /^(\d{5,20}):[A-Za-z0-9_-]{30,}$/;

/** Columnas de `TelegramBotConfig` que este servicio lee. */
interface TelegramBotConfigRow {
  organizationId: string;
  botId: string | null;
  botUsername: string | null;
  encryptedBotToken: string | null;
  webhookRouteKey: string;
  encryptedWebhookSecret: string | null;
  isActive: boolean;
  lastWebhookSetAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

/**
 * Canal de Telegram de cada clínica: conectar, desconectar, verificar y
 * resolver credenciales (docs/PLAN_TELEGRAM.md §4.4, T1, T9).
 *
 * «Conectar» es todo lo que la clínica hace: pega el token de BotFather. El
 * resto lo hace este servicio, y el canal NO queda activo hasta que Telegram
 * confirma que el webhook apunta a nosotros. Un paso fallido deja el canal
 * apagado con el motivo en `lastError`, nunca a medias y encendido.
 */
@Injectable()
export class TelegramConfigService {
  private readonly logger = new Logger(TelegramConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly api: TelegramApiClient,
  ) {}

  /** URL pública del webhook de una clínica. Telegram exige HTTPS. */
  buildWebhookUrl(routeKey: string): string {
    const base = (
      process.env.PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://api.agendamiento-ia.com'
    ).replace(/\/+$/, '');
    return `${base}/telegram/webhook/${routeKey}`;
  }

  async getPublic(organizationId: string): Promise<PublicTelegramConfig> {
    const row = await this.findRow(organizationId);
    return this.toPublic(row);
  }

  /**
   * Conecta (o reconecta) el bot de la clínica con el token de BotFather.
   *
   *  1. `getMe` valida el token y dice qué bot es.
   *  2. Un bot no puede ser de dos clínicas.
   *  3. Se guarda token y secreto nuevos con el canal APAGADO: así, cuando
   *     Telegram empiece a llamar, el webhook ya conoce el secreto.
   *  4. `setWebhook` y `getWebhookInfo`; solo si la URL coincide se enciende.
   */
  async connect(
    organizationId: string,
    rawToken: string | null | undefined,
  ): Promise<PublicTelegramConfig> {
    const token = (rawToken ?? '').trim();
    if (!BOT_TOKEN_RE.test(token)) {
      throw new BadRequestException(
        'El token no tiene el formato de BotFather (números, dos puntos y una clave larga).',
      );
    }

    const me = await this.api.getMe(token);
    if (!me.ok) {
      if (me.errorCode === 401 || me.errorCode === 404) {
        throw new BadRequestException(
          'Telegram rechazó el token. Cópielo de nuevo desde @BotFather.',
        );
      }
      throw new ServiceUnavailableException(
        `No se pudo contactar a Telegram (${me.description}). Intente de nuevo en unos minutos.`,
      );
    }
    const botId = String(me.result.id);
    const botUsername = me.result.username ?? null;

    const owner = await this.prisma.telegramBotConfig.findUnique({
      where: { botId },
      select: { organizationId: true },
    });
    if (owner && owner.organizationId !== organizationId) {
      throw new BadRequestException(
        'Este bot ya está conectado a otra clínica en AgenIA. Cree un bot propio en @BotFather.',
      );
    }

    const existing = await this.findRow(organizationId);
    const switchingBot = !!existing?.botId && existing.botId !== botId;

    // Si la clínica cambia de bot, el viejo se desengancha (a su webhook le
    // llegaría un secreto que ya no vale y Telegram reintentaría para siempre)
    // y la ruta se renueva. Mejor esfuerzo: un token viejo revocado no puede
    // impedir conectar el nuevo.
    if (switchingBot && existing?.encryptedBotToken) {
      const oldToken = this.safeDecrypt(existing.encryptedBotToken);
      if (oldToken) await this.api.deleteWebhook(oldToken);
    }

    const routeKey =
      existing && !switchingBot ? existing.webhookRouteKey : randomKey(24);
    const secret = randomKey(32);
    const encryptedBotToken = this.crypto.encrypt(token);
    const encryptedWebhookSecret = this.crypto.encrypt(secret);

    await this.prisma.telegramBotConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        botId,
        botUsername,
        encryptedBotToken,
        webhookRouteKey: routeKey,
        encryptedWebhookSecret,
        isActive: false,
        lastError: null,
      },
      update: {
        botId,
        botUsername,
        encryptedBotToken,
        webhookRouteKey: routeKey,
        encryptedWebhookSecret,
        isActive: false,
        lastError: null,
      },
    });

    const url = this.buildWebhookUrl(routeKey);
    if (!url.startsWith('https://')) {
      return this.fail(
        organizationId,
        'La URL pública de la API no es HTTPS y Telegram solo llama a HTTPS. Revise PUBLIC_API_URL.',
      );
    }

    const set = await this.api.setWebhook(token, { url, secretToken: secret });
    if (!set.ok) {
      return this.fail(
        organizationId,
        `Telegram no aceptó el webhook: ${set.description}`,
      );
    }

    const info = await this.api.getWebhookInfo(token);
    if (!info.ok || info.result.url !== url) {
      return this.fail(
        organizationId,
        info.ok
          ? 'Telegram no quedó apuntando a AgenIA. Intente conectar de nuevo.'
          : `No se pudo confirmar el webhook: ${info.description}`,
      );
    }

    await this.prisma.telegramBotConfig.update({
      where: { organizationId },
      data: { isActive: true, lastWebhookSetAt: new Date(), lastError: null },
    });
    this.logger.log(
      `Telegram conectado para org ${organizationId} (@${botUsername ?? botId}).`,
    );
    return this.getPublic(organizationId);
  }

  /**
   * Apaga el canal: Telegram deja de llamar y el bot deja de contestar. El
   * token se conserva cifrado para poder reconectar sin volver a BotFather.
   */
  async disconnect(organizationId: string): Promise<PublicTelegramConfig> {
    const row = await this.findRow(organizationId);
    if (!row) return this.toPublic(null);

    const token = row.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    if (token) {
      const res = await this.api.deleteWebhook(token);
      if (!res.ok) {
        // No bloquea: con el canal apagado el webhook descarta todo igual.
        this.logger.warn(
          `deleteWebhook falló para org ${organizationId}: ${res.description}`,
        );
      }
    }

    await this.prisma.telegramBotConfig.update({
      where: { organizationId },
      data: { isActive: false },
    });
    return this.getPublic(organizationId);
  }

  /**
   * Lo que el panel muestra en «Verificar»: si Telegram sigue apuntando a
   * nosotros, cuántos mensajes tiene retenidos y el último error que vio.
   */
  async verify(organizationId: string): Promise<TelegramWebhookStatus> {
    const row = await this.findRow(organizationId);
    const base = this.toPublic(row);
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    if (!row || !token) {
      return {
        ...base,
        webhookOk: false,
        pendingUpdateCount: null,
        telegramLastError: null,
      };
    }

    const info = await this.api.getWebhookInfo(token);
    if (!info.ok) {
      if (info.errorCode === 401) {
        await this.markTokenRevoked(organizationId);
        return {
          ...(await this.getPublic(organizationId)),
          webhookOk: false,
          pendingUpdateCount: null,
          telegramLastError: null,
        };
      }
      return {
        ...base,
        webhookOk: false,
        pendingUpdateCount: null,
        telegramLastError: info.description,
      };
    }

    const webhookOk =
      info.result.url === this.buildWebhookUrl(row.webhookRouteKey);
    return {
      ...base,
      webhookOk,
      pendingUpdateCount: info.result.pending_update_count ?? null,
      telegramLastError: info.result.last_error_message ?? null,
    };
  }

  /** Credenciales para enviar. `null` si la clínica no tiene Telegram. */
  async forOrg(
    organizationId: string,
  ): Promise<ResolvedTelegramCredentials | null> {
    const row = await this.findRow(organizationId);
    if (!row?.encryptedBotToken) return null;
    const botToken = this.safeDecrypt(row.encryptedBotToken);
    if (!botToken) return null;
    return {
      organizationId,
      botToken,
      botId: row.botId,
      isActive: row.isActive,
    };
  }

  /**
   * Resuelve la clínica dueña de una ruta de webhook. Es la ruta crítica de
   * cada update entrante: aquí se decide a qué tenant pertenece (T1).
   */
  async forRouteKey(routeKey: string): Promise<TelegramWebhookTarget | null> {
    if (!routeKey || routeKey.length > 128) return null;
    const row = await this.prisma.telegramBotConfig.findUnique({
      where: { webhookRouteKey: routeKey },
    });
    if (!row?.encryptedBotToken || !row.encryptedWebhookSecret) return null;
    const botToken = this.safeDecrypt(row.encryptedBotToken);
    const webhookSecret = this.safeDecrypt(row.encryptedWebhookSecret);
    if (!botToken || !webhookSecret) return null;
    return {
      organizationId: row.organizationId,
      botToken,
      webhookSecret,
      isActive: row.isActive,
    };
  }

  /**
   * Telegram respondió 401: el token se revocó en BotFather. Se apaga el
   * canal y se deja el motivo para el panel. Nunca lanza.
   */
  async markTokenRevoked(organizationId: string): Promise<void> {
    try {
      await this.prisma.telegramBotConfig.update({
        where: { organizationId },
        data: {
          isActive: false,
          lastError:
            'Telegram rechazó el token (¿se revocó en @BotFather?). Vuelva a conectar el bot.',
        },
      });
      this.logger.error(
        `🚨 Token de Telegram revocado para org ${organizationId}: canal apagado.`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo marcar el token revocado de org ${organizationId}: ${getErrorMessage(error)}`,
      );
    }
  }

  // ── internos ────────────────────────────────────────────────────────────

  private async fail(
    organizationId: string,
    reason: string,
  ): Promise<PublicTelegramConfig> {
    await this.prisma.telegramBotConfig.update({
      where: { organizationId },
      data: { isActive: false, lastError: reason },
    });
    throw new BadRequestException(reason);
  }

  private findRow(
    organizationId: string,
  ): Promise<TelegramBotConfigRow | null> {
    return this.prisma.telegramBotConfig.findUnique({
      where: { organizationId },
    });
  }

  private toPublic(row: TelegramBotConfigRow | null): PublicTelegramConfig {
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    return {
      connected: Boolean(token),
      isActive: row?.isActive ?? false,
      botUsername: row?.botUsername ?? null,
      botLink: row?.botUsername ? `https://t.me/${row.botUsername}` : null,
      botTokenLast4: token ? token.slice(-4) : null,
      lastWebhookSetAt: row?.lastWebhookSetAt ?? null,
      lastError: row?.lastError ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Un valor que no se puede descifrar (llave rotada) cuenta como ausente. */
  private safeDecrypt(value: string): string | null {
    try {
      return this.crypto.decrypt(value) || null;
    } catch {
      return null;
    }
  }
}

/** Aleatorio URL-safe; también cumple el alfabeto de `secret_token`. */
function randomKey(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
