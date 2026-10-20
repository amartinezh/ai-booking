import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { Prisma, SupportBotConfig } from '@agenia/database';
import {
  AJUSTES_SOPORTE_POR_DEFECTO,
  COMANDOS_SOPORTE,
  horarioEquipoDe,
  type HorarioEquipo,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { getErrorMessage } from '../common/error-message.util';
import { TelegramApiClient } from '../telegram/telegram-api.client';
import { BOT_TOKEN_RE } from '../telegram/telegram-config.service';
import type {
  PublicSupportBotConfig,
  SupportBotActor,
  SupportBotRuntime,
  SupportBotSettingsInput,
} from './support-bot.types';

const CONFIG_ID = 'global';
/** La configuración se relee de la base como mucho cada 30 s (y al cambiarla). */
const CACHE_MS = 30_000;
/** La salud del bot («último envío bueno») se escribe como mucho cada 5 min. */
const SALUD_MS = 5 * 60_000;

/** Lo que el asistente le pide a Telegram: mensajes y toques de sus botones. */
export const ACTUALIZACIONES_DEL_ASISTENTE = ['message', 'callback_query'];

/** Rangos aceptados para cada ajuste del panel. */
const RANGOS = {
  conversationIdleMinutes: [5, 240],
  maxMessagesPerHour: [5, 500],
  // Telegram corta en 4 096 caracteres.
  maxMessageChars: [200, 4000],
  // 0 = la clínica se atiende siempre sin IA.
  maxAiTurnsPerOrgPerDay: [0, 10_000],
} as const;

/**
 * La configuración del asistente de soporte (docs/PLAN_BOT_SOPORTE.md §3.7): el
 * bot PROPIO de la plataforma, su webhook y los ajustes. Solo del SUPER_ADMIN.
 *
 * Un bot no puede ser a la vez el de soporte, el de las alertas técnicas y el de
 * una clínica: se valida en las tres direcciones (aquí, en TechAlertConfigService y
 * en TelegramConfigService). En los de las clínicas escriben pacientes, y el de
 * alertas no tiene webhook.
 *
 * La IA NO se configura aquí: el asistente usa la de la clínica de cada empleado (S5).
 */
@Injectable()
export class SupportBotConfigService {
  private readonly logger = new Logger(SupportBotConfigService.name);
  private cache: { at: number; runtime: SupportBotRuntime | null } | null =
    null;
  private ultimoOkGuardado = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CryptoService,
    private readonly api: TelegramApiClient,
  ) {}

  // ── Para el resto del módulo ───────────────────────────────────────────

  /**
   * Token, ruta, secreto y ajustes en claro, o `null` si no hay bot conectado. Con
   * caché corta: el webhook lo consulta en cada mensaje.
   */
  async runtime(): Promise<SupportBotRuntime | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.runtime;
    }
    const row = await this.findRow();
    const runtime = this.toRuntime(row);
    this.cache = { at: Date.now(), runtime };
    return runtime;
  }

  /** ¿La ruta y el secreto que llegaron son los del bot conectado? Tiempo constante. */
  async destinoDelWebhook(
    routeKey: string,
    secreto: string | undefined,
  ): Promise<SupportBotRuntime | null> {
    const rt = await this.runtime();
    if (
      !rt ||
      rt.routeKey !== routeKey ||
      !mismoSecreto(secreto, rt.webhookSecret)
    ) {
      return null;
    }
    return rt;
  }

  async horario(): Promise<HorarioEquipo> {
    return horarioEquipoDe(await this.findRow());
  }

  /** Salud para el panel: último envío bueno o último error de Telegram. Nunca lanza. */
  async registrarEnvio(ok: boolean, error?: string): Promise<void> {
    try {
      if (ok) {
        if (Date.now() - this.ultimoOkGuardado < SALUD_MS) return;
        this.ultimoOkGuardado = Date.now();
        await this.prisma.supportBotConfig.updateMany({
          where: { id: CONFIG_ID },
          data: { lastOkAt: new Date() },
        });
        return;
      }
      this.ultimoOkGuardado = 0;
      await this.prisma.supportBotConfig.updateMany({
        where: { id: CONFIG_ID },
        data: {
          lastError: (error ?? 'error').slice(0, 300),
          lastErrorAt: new Date(),
        },
      });
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo guardar la salud del bot: ${getErrorMessage(e)}`,
      );
    }
  }

  // ── Panel del super admin ──────────────────────────────────────────────

  async getPublic(): Promise<PublicSupportBotConfig> {
    const row = await this.findRow();
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    let webhook: PublicSupportBotConfig['webhook'] = null;
    if (token && row?.routeKey) {
      const info = await this.api.getWebhookInfo(token);
      webhook = info.ok
        ? {
            ok: info.result.url === urlDelWebhook(row.routeKey),
            pendientes: info.result.pending_update_count ?? null,
            ultimoError: info.result.last_error_message ?? null,
          }
        : { ok: false, pendientes: null, ultimoError: info.description };
    }
    const horario = horarioEquipoDe(row);
    return {
      conectado: !!token,
      botUsername: row?.botUsername ?? null,
      enabled: !!row?.enabled && !!token,
      webhook,
      horario,
      conversacionMinutos:
        row?.conversationIdleMinutes ??
        AJUSTES_SOPORTE_POR_DEFECTO.conversationIdleMinutes,
      limites: {
        mensajesPorHora:
          row?.maxMessagesPerHour ??
          AJUSTES_SOPORTE_POR_DEFECTO.maxMessagesPerHour,
        caracteresPorMensaje:
          row?.maxMessageChars ?? AJUSTES_SOPORTE_POR_DEFECTO.maxMessageChars,
        turnosIaPorClinicaAlDia:
          row?.maxAiTurnsPerOrgPerDay ??
          AJUSTES_SOPORTE_POR_DEFECTO.maxAiTurnsPerOrgPerDay,
      },
      ultimoError: row?.lastError ?? null,
      ultimoErrorEn: row?.lastErrorAt?.toISOString() ?? null,
      actualizadoPor: row?.updatedByEmail ?? null,
      actualizadoEn: row?.updatedAt?.toISOString() ?? null,
    };
  }

  /**
   * Conecta (o renueva) el bot: valida el token con Telegram, comprueba que no sea
   * el de las alertas ni el de una clínica, registra el webhook y publica el menú de
   * comandos. Nada se guarda si Telegram no confirma el webhook. Un bot nuevo nace
   * apagado.
   */
  async connect(
    rawToken: unknown,
    actor: SupportBotActor,
  ): Promise<PublicSupportBotConfig> {
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
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

    const [alertas, deClinica] = await Promise.all([
      this.prisma.techAlertConfig.findUnique({
        where: { id: 'global' },
        select: { botId: true },
      }),
      this.prisma.telegramBotConfig.findUnique({
        where: { botId },
        select: { organizationId: true },
      }),
    ]);
    if (alertas?.botId === botId) {
      throw new BadRequestException(
        'Este bot es el de las alertas técnicas. Cree en @BotFather un bot solo para el asistente de soporte.',
      );
    }
    if (deClinica) {
      throw new BadRequestException(
        'Este bot ya atiende pacientes de una clínica. Cree en @BotFather un bot solo para el asistente de soporte.',
      );
    }

    const actual = await this.findRow();
    const mismoBot = actual?.botId === botId;
    const routeKey =
      mismoBot && actual?.routeKey ? actual.routeKey : llaveAleatoria(24);
    const url = urlDelWebhook(routeKey);
    if (!url.startsWith('https://')) {
      throw new BadRequestException(
        'La URL pública de la API no es HTTPS y Telegram solo llama a HTTPS. Revise PUBLIC_API_URL.',
      );
    }

    // El bot anterior se desengancha: a su webhook le llegaría un secreto que ya no vale.
    if (!mismoBot && actual?.encryptedBotToken) {
      const viejo = this.safeDecrypt(actual.encryptedBotToken);
      if (viejo) await this.api.deleteWebhook(viejo);
    }

    const secreto = llaveAleatoria(32);
    const set = await this.api.setWebhook(token, {
      url,
      secretToken: secreto,
      allowedUpdates: ACTUALIZACIONES_DEL_ASISTENTE,
    });
    if (!set.ok) {
      throw new ServiceUnavailableException(
        `Telegram no aceptó el webhook: ${set.description}`,
      );
    }
    const info = await this.api.getWebhookInfo(token);
    if (!info.ok || info.result.url !== url) {
      throw new ServiceUnavailableException(
        info.ok
          ? 'Telegram no quedó apuntando a AgenIA. Intente conectar de nuevo.'
          : `No se pudo confirmar el webhook: ${info.description}`,
      );
    }
    const comandos = await this.api.setMyCommands(
      token,
      COMANDOS_SOPORTE.map((c) => ({
        command: c.comando,
        description: c.descripcion,
      })),
    );
    if (!comandos.ok) {
      this.logger.warn(
        `setMyCommands del asistente falló: ${comandos.description}`,
      );
    }

    const datos = {
      encryptedBotToken: this.cipher.encrypt(token),
      botId,
      botUsername,
      routeKey,
      encryptedWebhookSecret: this.cipher.encrypt(secreto),
      lastError: null,
      lastErrorAt: null,
      updatedByUserId: actor.userId,
      updatedByEmail: actor.email,
    };
    await this.prisma.$transaction([
      this.prisma.supportBotConfig.upsert({
        where: { id: CONFIG_ID },
        create: { id: CONFIG_ID, ...datos, enabled: false },
        update: mismoBot ? datos : { ...datos, enabled: false },
      }),
      this.audit(
        actor,
        mismoBot
          ? `renovó el token del bot @${botUsername ?? botId}`
          : `conectó el bot @${botUsername ?? botId}`,
        { botId, botUsername, cambioDeBot: !mismoBot },
      ),
    ]);
    this.invalidar();
    this.logger.log(
      `Bot del asistente de soporte conectado: @${botUsername ?? botId}.`,
    );
    return this.getPublic();
  }

  /** Apaga el asistente y olvida el bot. Las conversaciones dejan de recibir respuesta. */
  async disconnect(actor: SupportBotActor): Promise<PublicSupportBotConfig> {
    const row = await this.findRow();
    if (!row?.encryptedBotToken) return this.getPublic();
    const token = this.safeDecrypt(row.encryptedBotToken);
    if (token) {
      const r = await this.api.deleteWebhook(token);
      if (!r.ok)
        this.logger.warn(`deleteWebhook del asistente falló: ${r.description}`);
    }
    await this.prisma.$transaction([
      this.prisma.supportBotConfig.update({
        where: { id: CONFIG_ID },
        data: {
          enabled: false,
          encryptedBotToken: null,
          botId: null,
          botUsername: null,
          routeKey: null,
          encryptedWebhookSecret: null,
          updatedByUserId: actor.userId,
          updatedByEmail: actor.email,
        },
      }),
      this.audit(actor, `desconectó el bot @${row.botUsername ?? row.botId}`, {
        botId: row.botId,
      }),
    ]);
    this.invalidar();
    return this.getPublic();
  }

  /** Encender/apagar, horario del equipo, minutos de la conversación y límites. */
  async updateSettings(
    input: SupportBotSettingsInput,
    actor: SupportBotActor,
  ): Promise<PublicSupportBotConfig> {
    const data: Prisma.SupportBotConfigUpdateInput = {};
    const cambios: string[] = [];
    const row = await this.findRow();

    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') {
        throw new BadRequestException('«enabled» debe ser verdadero o falso.');
      }
      if (input.enabled && !row?.encryptedBotToken) {
        throw new BadRequestException('Conecte primero el bot.');
      }
      data.enabled = input.enabled;
      cambios.push(
        input.enabled ? 'encendió el asistente' : 'apagó el asistente',
      );
    }

    if (input.teamDays !== undefined) {
      const dias = input.teamDays;
      if (
        !Array.isArray(dias) ||
        dias.length === 0 ||
        dias.some(
          (d) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7,
        )
      ) {
        throw new BadRequestException(
          'Los días del equipo van de 1 (lunes) a 7 (domingo).',
        );
      }
      data.teamDays = [...new Set(dias as number[])].sort((a, b) => a - b);
      cambios.push('cambió los días del equipo');
    }

    const desde = input.teamFromHour ?? row?.teamFromHour ?? 8;
    const hasta = input.teamToHour ?? row?.teamToHour ?? 17;
    if (input.teamFromHour !== undefined || input.teamToHour !== undefined) {
      if (
        !Number.isInteger(desde) ||
        !Number.isInteger(hasta) ||
        (desde as number) < 0 ||
        (hasta as number) > 24 ||
        (desde as number) >= (hasta as number)
      ) {
        throw new BadRequestException(
          'El horario del equipo va de una hora entera a otra mayor (0 a 24).',
        );
      }
      data.teamFromHour = desde as number;
      data.teamToHour = hasta as number;
      cambios.push(
        `dejó el horario del equipo de ${desde as number}:00 a ${hasta as number}:00`,
      );
    }

    for (const campo of Object.keys(RANGOS) as Array<keyof typeof RANGOS>) {
      const valor = input[campo];
      if (valor === undefined) continue;
      const [min, max] = RANGOS[campo];
      if (
        !Number.isInteger(valor) ||
        (valor as number) < min ||
        (valor as number) > max
      ) {
        throw new BadRequestException(
          `«${campo}» debe ser un entero entre ${min} y ${max}.`,
        );
      }
      data[campo] = valor as number;
      cambios.push(`cambió ${campo} a ${valor as number}`);
    }

    if (cambios.length === 0) return this.getPublic();
    data.updatedByUserId = actor.userId;
    data.updatedByEmail = actor.email;
    await this.prisma.$transaction([
      this.prisma.supportBotConfig.upsert({
        where: { id: CONFIG_ID },
        create: {
          id: CONFIG_ID,
          ...(data as Prisma.SupportBotConfigCreateInput),
        },
        update: data,
      }),
      this.audit(actor, cambios.join(', '), { cambios }),
    ]);
    this.invalidar();
    return this.getPublic();
  }

  // ── Internos ───────────────────────────────────────────────────────────

  private invalidar(): void {
    this.cache = null;
  }

  private findRow(): Promise<SupportBotConfig | null> {
    return this.prisma.supportBotConfig.findUnique({
      where: { id: CONFIG_ID },
    });
  }

  private toRuntime(row: SupportBotConfig | null): SupportBotRuntime | null {
    if (
      !row?.encryptedBotToken ||
      !row.routeKey ||
      !row.encryptedWebhookSecret
    ) {
      return null;
    }
    const token = this.safeDecrypt(row.encryptedBotToken);
    const webhookSecret = this.safeDecrypt(row.encryptedWebhookSecret);
    if (!token || !webhookSecret) return null;
    return {
      enabled: row.enabled,
      token,
      botUsername: row.botUsername,
      routeKey: row.routeKey,
      webhookSecret,
      conversationIdleMinutes: row.conversationIdleMinutes,
      maxMessagesPerHour: row.maxMessagesPerHour,
      maxMessageChars: row.maxMessageChars,
    };
  }

  private safeDecrypt(valor: string): string | null {
    try {
      return this.cipher.decrypt(valor);
    } catch (e: unknown) {
      this.logger.error(
        `No se pudo descifrar un dato del asistente: ${getErrorMessage(e)}`,
      );
      return null;
    }
  }

  private audit(
    actor: SupportBotActor,
    mensaje: string,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.globalAuditLog.create({
      data: {
        action: 'SUPPORT_BOT_CONFIG_CHANGED',
        message: `Asistente de soporte: ${actor.email ?? 'un super admin'} ${mensaje}.`,
        actorId: actor.userId,
        actorEmail: actor.email,
        ipAddress: actor.ip,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

/** `<PUBLIC_API_URL>/support-bot/webhook/<routeKey>`. */
export function urlDelWebhook(routeKey: string): string {
  const base = (
    process.env.PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'https://api.agendamiento-ia.com'
  ).replace(/\/+$/, '');
  return `${base}/support-bot/webhook/${routeKey}`;
}

function llaveAleatoria(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** Compara el secreto del header con el guardado en tiempo constante. */
export function mismoSecreto(
  recibido: string | undefined,
  esperado: string,
): boolean {
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
