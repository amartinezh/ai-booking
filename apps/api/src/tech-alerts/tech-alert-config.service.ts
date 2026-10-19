import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Prisma, TechAlertConfig } from '@agenia/database';
import {
  OPCIONES_SILENCIO,
  baseDelPanel,
  codigoVinculacion,
  codigoVinculacionVigente,
  extraerCodigoVinculacion,
  finDelSilencio,
  leerCategorias,
  normalizarConfigAlertas,
  textoPrueba,
  textoVinculado,
  UMBRALES_ALERTAS,
  type OpcionSilencio,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { getErrorMessage } from '../common/error-message.util';
import { TelegramApiClient } from '../telegram/telegram-api.client';
import { BOT_TOKEN_RE } from '../telegram/telegram-config.service';
import type {
  PublicTechAlertConfig,
  TechAlertActor,
  TechAlertChannel,
  TechAlertLinkResult,
  TechAlertSendResult,
  TechAlertSettingsInput,
} from './tech-alerts.types';

const CONFIG_ID = 'global';
/** La copia en memoria se relee de la base como mucho cada minuto. */
const CACHE_MS = 60_000;
const MS_MIN = 60_000;

/**
 * El canal con el equipo técnico (docs/PLAN_ALERTAS_TECNICAS.md §3.1): un bot
 * PROPIO de la plataforma que le escribe a UN grupo. Solo del SUPER_ADMIN.
 *
 * ═══ Cómo se vincula el grupo, sin webhook ═══
 * El panel da un código de un solo uso; alguien agrega el bot al grupo y escribe
 * `/vincular@Bot CÓDIGO`; «Buscar el grupo» lee los mensajes del bot UNA vez con
 * `getUpdates` y guarda ese grupo. El bot no recibe nada de internet: no hay ruta
 * pública nueva que abrir en el proxy (que es una lista blanca) ni que proteger.
 *
 * ═══ Si la base se cae ═══
 * El envío no puede depender de ella: es justo la falla más grave. El token y el
 * grupo se guardan también en memoria (`canal`), y con la base caída se usa la
 * última copia.
 */
@Injectable()
export class TechAlertConfigService implements OnModuleInit {
  private readonly logger = new Logger(TechAlertConfigService.name);
  private cache: { at: number; canal: TechAlertChannel | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CryptoService,
    private readonly api: TelegramApiClient,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tener la copia en memoria desde el arranque: si la base cae después, se avisa igual.
    await this.canal({ fresco: true });
  }

  // ── Panel ───────────────────────────────────────────────────────────────

  async getPublic(): Promise<PublicTechAlertConfig> {
    return this.toPublic(await this.findRow());
  }

  /**
   * Conecta (o renueva) el bot con su token de BotFather. Un bot nuevo no está en
   * el grupo de antes: cambiar de bot obliga a vincular de nuevo y deja el canal
   * apagado.
   */
  async connect(
    rawToken: unknown,
    actor: TechAlertActor,
  ): Promise<PublicTechAlertConfig> {
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

    // A1: nunca el bot de una clínica. Esos tienen webhook y en ellos escriben pacientes.
    const deClinica = await this.prisma.telegramBotConfig.findUnique({
      where: { botId },
      select: { organizationId: true },
    });
    if (deClinica) {
      throw new BadRequestException(
        'Este bot ya atiende pacientes de una clínica. Cree en @BotFather un bot solo para las alertas técnicas.',
      );
    }

    // Sin webhook: con uno puesto, `getUpdates` no funciona. Si falla no bloquea:
    // «Buscar el grupo» lo vuelve a intentar.
    const sinWebhook = await this.api.deleteWebhook(token);
    if (!sinWebhook.ok) {
      this.logger.warn(
        `deleteWebhook del bot de alertas falló: ${sinWebhook.description}`,
      );
    }

    const actual = await this.findRow();
    const mismoBot = actual?.botId === botId;
    const datos = {
      encryptedBotToken: this.cipher.encrypt(token),
      botId,
      botUsername,
      lastError: null,
      lastErrorAt: null,
      updatedByUserId: actor.userId,
      updatedByEmail: actor.email,
    };
    const otroBot = {
      chatId: null,
      chatTitle: null,
      enabled: false,
      linkCode: null,
      linkCodeExpiresAt: null,
    };
    await this.prisma.$transaction([
      this.prisma.techAlertConfig.upsert({
        where: { id: CONFIG_ID },
        create: { id: CONFIG_ID, ...datos, ...otroBot },
        update: mismoBot ? datos : { ...datos, ...otroBot },
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
      `Bot de alertas técnicas conectado: @${botUsername ?? botId}.`,
    );
    return this.getPublic();
  }

  /**
   * Apaga el canal y olvida bot y grupo. Antes, si puede, se despide del grupo:
   * así nadie cree que el silencio es «todo bien».
   */
  async disconnect(actor: TechAlertActor): Promise<PublicTechAlertConfig> {
    const row = await this.findRow();
    if (!row?.encryptedBotToken) return this.toPublic(row);

    const token = this.safeDecrypt(row.encryptedBotToken);
    if (token && row.chatId) {
      const adios = await this.api.sendMessage(
        token,
        row.chatId,
        '🔕 Este grupo ya no recibirá las alertas técnicas de AgenIA: se desconectaron desde el panel del super admin.',
      );
      if (!adios.ok) {
        this.logger.warn(`No se pudo despedir del grupo: ${adios.description}`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.techAlertConfig.update({
        where: { id: CONFIG_ID },
        data: {
          encryptedBotToken: null,
          botId: null,
          botUsername: null,
          chatId: null,
          chatTitle: null,
          enabled: false,
          linkCode: null,
          linkCodeExpiresAt: null,
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

  /** Genera el código de un solo uso para vincular el grupo (vence en 15 min). */
  async startLink(actor: TechAlertActor): Promise<PublicTechAlertConfig> {
    const row = await this.findRow();
    if (!row?.encryptedBotToken) {
      throw new BadRequestException('Primero conecte el bot.');
    }
    const largo = UMBRALES_ALERTAS.codigoVinculacion.largo;
    await this.prisma.techAlertConfig.update({
      where: { id: CONFIG_ID },
      data: {
        linkCode: codigoVinculacion(randomBytes(largo)),
        linkCodeExpiresAt: new Date(
          Date.now() + UMBRALES_ALERTAS.codigoVinculacion.vigenciaMin * MS_MIN,
        ),
        updatedByUserId: actor.userId,
        updatedByEmail: actor.email,
      },
    });
    return this.getPublic();
  }

  /**
   * «Buscar el grupo»: lee los mensajes del bot, busca el código y, si lo escribieron
   * en un grupo, lo vincula, le da la bienvenida y enciende el canal.
   */
  async findLink(actor: TechAlertActor): Promise<TechAlertLinkResult> {
    const row = await this.findRow();
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    if (!row || !token) {
      throw new BadRequestException('Primero conecte el bot.');
    }
    if (!row.linkCode) {
      return {
        found: false,
        reason: 'SIN_CODIGO',
        message: 'Genere primero un código de vinculación.',
      };
    }
    const ahora = new Date();
    if (
      !codigoVinculacionVigente(
        row.linkCodeExpiresAt?.toISOString() ?? null,
        ahora.toISOString(),
      )
    ) {
      return {
        found: false,
        reason: 'VENCIDO',
        message: 'El código venció. Genere uno nuevo.',
      };
    }

    let updates = await this.api.getUpdates(token, {
      allowedUpdates: ['message'],
    });
    if (!updates.ok && updates.errorCode === 409) {
      // Alguien le puso un webhook al bot por fuera: se quita y se reintenta.
      await this.api.deleteWebhook(token);
      updates = await this.api.getUpdates(token, {
        allowedUpdates: ['message'],
      });
    }
    if (!updates.ok) {
      if (updates.errorCode === 401) {
        throw new BadRequestException(
          'Telegram rechazó el token (¿se revocó en @BotFather?). Vuelva a conectar el bot.',
        );
      }
      throw new ServiceUnavailableException(
        `No se pudieron leer los mensajes del bot (${updates.description}).`,
      );
    }

    let grupo: { id: string; title: string | null } | null = null;
    let enPrivado = false;
    for (const u of [...updates.result].reverse()) {
      const m = u.message;
      if (m?.chat?.id === undefined) continue;
      if (extraerCodigoVinculacion(m.text) !== row.linkCode) continue;
      if (m.chat.type === 'group' || m.chat.type === 'supergroup') {
        grupo = { id: String(m.chat.id), title: m.chat.title ?? null };
        break;
      }
      enPrivado = true;
    }

    // Lo leído se confirma: Telegram lo olvida y la próxima búsqueda no lo relee.
    const ultimo = updates.result.reduce(
      (max, u) => Math.max(max, u.update_id ?? -1),
      -1,
    );
    if (ultimo >= 0) {
      await this.api.getUpdates(token, { offset: ultimo + 1, limit: 1 });
    }

    if (!grupo) {
      return enPrivado
        ? {
            found: false,
            reason: 'CHAT_PRIVADO',
            message:
              'El código llegó por un chat privado. Agregue el bot a un GRUPO del equipo y escríbalo allí.',
          }
        : {
            found: false,
            reason: 'NO_LLEGO',
            message:
              'Todavía no llega el código. Agregue el bot al grupo y escriba allí el comando, tal cual.',
          };
    }

    let chatId = grupo.id;
    let hola = await this.api.sendMessage(token, chatId, textoVinculado());
    if (!hola.ok && hola.migrateToChatId) {
      chatId = hola.migrateToChatId;
      hola = await this.api.sendMessage(token, chatId, textoVinculado());
    }
    if (!hola.ok) {
      throw new ServiceUnavailableException(
        `El grupo se encontró, pero Telegram no deja escribirle (${hola.description}). Revise que el bot pueda enviar mensajes en el grupo.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.techAlertConfig.update({
        where: { id: CONFIG_ID },
        data: {
          chatId,
          chatTitle: grupo.title,
          linkCode: null,
          linkCodeExpiresAt: null,
          enabled: true,
          // La bienvenida cuenta como el resumen de hoy: el primero llega mañana a
          // las 7, no un minuto después de vincular.
          lastDailySummaryAt: ahora,
          lastOkAt: ahora,
          lastError: null,
          lastErrorAt: null,
          updatedByUserId: actor.userId,
          updatedByEmail: actor.email,
        },
      }),
      this.audit(actor, `vinculó el grupo «${grupo.title ?? chatId}»`, {
        chatId,
        chatTitle: grupo.title,
      }),
    ]);
    this.invalidar();
    return { found: true, config: await this.getPublic() };
  }

  /** Encendido, categorías, antirruido, resumen diario y URL de los enlaces. */
  async updateSettings(
    input: TechAlertSettingsInput,
    actor: TechAlertActor,
  ): Promise<PublicTechAlertConfig> {
    const row = await this.findRow();
    const n = normalizarConfigAlertas({
      reminderMinutes: input.reminderMinutes ?? row?.reminderMinutes,
      maxReminders: input.maxReminders ?? row?.maxReminders,
      quietHoursEnabled: input.quietHoursEnabled ?? row?.quietHoursEnabled,
      quietFromHour: input.quietFromHour ?? row?.quietFromHour,
      quietToHour: input.quietToHour ?? row?.quietToHour,
      categories: input.categories ?? row?.categories,
    });

    let enabled = row?.enabled ?? false;
    if (typeof input.enabled === 'boolean') {
      if (input.enabled && !(row?.encryptedBotToken && row.chatId)) {
        throw new BadRequestException(
          'Para encender las alertas, conecte el bot y vincule el grupo.',
        );
      }
      enabled = input.enabled;
    }

    let panelBaseUrl = row?.panelBaseUrl ?? null;
    if (input.panelBaseUrl !== undefined) {
      const url =
        typeof input.panelBaseUrl === 'string' ? input.panelBaseUrl.trim() : '';
      if (url && !baseDelPanel(url, null)) {
        throw new BadRequestException(
          'La URL del panel debe empezar por https:// (o http://).',
        );
      }
      panelBaseUrl = url ? baseDelPanel(url, null) : null;
    }

    const dailySummaryEnabled =
      typeof input.dailySummaryEnabled === 'boolean'
        ? input.dailySummaryEnabled
        : (row?.dailySummaryEnabled ?? true);

    const data = {
      enabled,
      categories: n.categories as Prisma.InputJsonValue,
      reminderMinutes: n.reminderMinutes,
      maxReminders: n.maxReminders,
      quietHoursEnabled: n.quietHoursEnabled,
      quietFromHour: n.quietFromHour,
      quietToHour: n.quietToHour,
      dailySummaryEnabled,
      panelBaseUrl,
      updatedByUserId: actor.userId,
      updatedByEmail: actor.email,
    };
    await this.prisma.$transaction([
      this.prisma.techAlertConfig.upsert({
        where: { id: CONFIG_ID },
        create: { id: CONFIG_ID, ...data },
        update: data,
      }),
      this.audit(
        actor,
        enabled !== (row?.enabled ?? false)
          ? enabled
            ? 'encendió las alertas'
            : 'apagó las alertas'
          : 'cambió los ajustes',
        {
          enabled,
          categories: n.categories,
          reminderMinutes: n.reminderMinutes,
          maxReminders: n.maxReminders,
          quietHours: n.quietHoursEnabled
            ? `${n.quietFromHour}-${n.quietToHour}`
            : null,
          dailySummaryEnabled,
          panelBaseUrl,
        },
      ),
    ]);
    this.invalidar();
    return this.getPublic();
  }

  /** Silencio planeado: los problemas se registran, pero no se envía nada. */
  async mute(
    opcion: unknown,
    actor: TechAlertActor,
  ): Promise<PublicTechAlertConfig> {
    if (!OPCIONES_SILENCIO.includes(opcion as OpcionSilencio)) {
      throw new BadRequestException('Opción de silencio desconocida.');
    }
    const hasta = finDelSilencio(opcion as OpcionSilencio, new Date());
    await this.setMute(hasta, actor, `silenció hasta ${hasta.toISOString()}`);
    return this.getPublic();
  }

  async unmute(actor: TechAlertActor): Promise<PublicTechAlertConfig> {
    await this.setMute(null, actor, 'quitó el silencio');
    return this.getPublic();
  }

  /** «Enviar mensaje de prueba»: sale aunque el canal esté apagado o en silencio. */
  async sendTest(): Promise<TechAlertSendResult> {
    const row = await this.findRow();
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    if (!token || !row?.chatId) {
      throw new BadRequestException(
        'Conecte el bot y vincule el grupo antes de probar.',
      );
    }
    return this.enviarA(
      token,
      row.chatId,
      textoPrueba(new Date().toISOString()),
    );
  }

  // ── Envío ───────────────────────────────────────────────────────────────

  /**
   * Token, grupo y ajustes para enviar, o `null` si el canal no está conectado y
   * vinculado. Con la base caída devuelve la última copia en memoria.
   */
  async canal(
    opts: { fresco?: boolean } = {},
  ): Promise<TechAlertChannel | null> {
    if (!opts.fresco && this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.canal;
    }
    try {
      const canal = this.toCanal(await this.findRow());
      this.cache = { at: Date.now(), canal };
      return canal;
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo leer la configuración de alertas (${getErrorMessage(error)}): se usa la última copia.`,
      );
      return this.cache?.canal ?? null;
    }
  }

  /** Envía al grupo vinculado. Nunca lanza. */
  async enviar(
    texto: string,
    opts: { silent?: boolean; canal?: TechAlertChannel | null } = {},
  ): Promise<TechAlertSendResult> {
    const canal = opts.canal ?? (await this.canal());
    if (!canal) {
      return { ok: false, errorCode: null, error: 'Canal sin conectar.' };
    }
    return this.enviarA(canal.token, canal.chatId, texto, opts.silent);
  }

  /**
   * El envío de verdad: sigue al grupo si pasó a supergrupo y deja la salud del
   * canal (último envío bueno, último error) para el panel. Nunca lanza.
   */
  private async enviarA(
    token: string,
    chatId: string,
    texto: string,
    silent = false,
  ): Promise<TechAlertSendResult> {
    let r = await this.api.sendMessage(token, chatId, texto, { silent });
    if (!r.ok && r.migrateToChatId) {
      const nuevo = r.migrateToChatId;
      await this.prisma.techAlertConfig
        .update({ where: { id: CONFIG_ID }, data: { chatId: nuevo } })
        .catch((e: unknown) =>
          this.logger.warn(
            `No se pudo guardar el id nuevo del supergrupo: ${getErrorMessage(e)}`,
          ),
        );
      this.invalidar();
      r = await this.api.sendMessage(token, nuevo, texto, { silent });
    }

    const ahora = new Date();
    const error = r.ok ? null : this.motivoLegible(r.errorCode, r.description);
    await this.prisma.techAlertConfig
      .update({
        where: { id: CONFIG_ID },
        data: r.ok
          ? { lastOkAt: ahora }
          : { lastError: error, lastErrorAt: ahora },
      })
      .catch(() => undefined); // con la base caída, el envío vale igual
    if (r.ok) return { ok: true };
    this.logger.warn(`Alerta técnica no enviada a Telegram: ${error}`);
    return { ok: false, errorCode: r.errorCode, error: error ?? '' };
  }

  // ── internos ────────────────────────────────────────────────────────────

  invalidar(): void {
    this.cache = null;
  }

  private motivoLegible(errorCode: number | null, description: string): string {
    if (errorCode === 401) {
      return 'Telegram rechazó el token (¿se revocó en @BotFather?). Vuelva a conectar el bot.';
    }
    if (errorCode === 403) {
      return `El bot ya no puede escribir en el grupo (¿lo sacaron?): ${description}`;
    }
    return description;
  }

  private async setMute(
    hasta: Date | null,
    actor: TechAlertActor,
    mensaje: string,
  ): Promise<void> {
    const row = await this.findRow();
    if (!row) throw new BadRequestException('Primero conecte el bot.');
    await this.prisma.$transaction([
      this.prisma.techAlertConfig.update({
        where: { id: CONFIG_ID },
        data: {
          mutedUntil: hasta,
          updatedByUserId: actor.userId,
          updatedByEmail: actor.email,
        },
      }),
      this.audit(actor, mensaje, { mutedUntil: hasta?.toISOString() ?? null }),
    ]);
    this.invalidar();
  }

  private audit(
    actor: TechAlertActor,
    mensaje: string,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.globalAuditLog.create({
      data: {
        action: 'TECH_ALERTS_CONFIG_CHANGED',
        message: `Alertas técnicas: ${actor.email ?? 'un super admin'} ${mensaje}.`,
        actorId: actor.userId,
        actorEmail: actor.email,
        ipAddress: actor.ip,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private findRow(): Promise<TechAlertConfig | null> {
    return this.prisma.techAlertConfig.findUnique({ where: { id: CONFIG_ID } });
  }

  private toCanal(row: TechAlertConfig | null): TechAlertChannel | null {
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    if (!row || !token || !row.chatId) return null;
    return {
      token,
      chatId: row.chatId,
      enabled: row.enabled,
      mutedUntilIso: row.mutedUntil?.toISOString() ?? null,
      antirruido: normalizarConfigAlertas(row),
      dailySummaryEnabled: row.dailySummaryEnabled,
      lastDailySummaryIso: row.lastDailySummaryAt?.toISOString() ?? null,
      panelBase: baseDelPanel(row.panelBaseUrl, process.env.PUBLIC_API_URL),
    };
  }

  private toPublic(row: TechAlertConfig | null): PublicTechAlertConfig {
    const token = row?.encryptedBotToken
      ? this.safeDecrypt(row.encryptedBotToken)
      : null;
    const n = normalizarConfigAlertas(row ?? {});
    const vigente =
      row?.linkCode &&
      codigoVinculacionVigente(
        row.linkCodeExpiresAt?.toISOString() ?? null,
        new Date().toISOString(),
      );
    return {
      connected: Boolean(token),
      botUsername: row?.botUsername ?? null,
      botLink: row?.botUsername ? `https://t.me/${row.botUsername}` : null,
      botTokenLast4: token ? token.slice(-4) : null,
      chatLinked: Boolean(row?.chatId),
      chatTitle: row?.chatTitle ?? null,
      linkPending:
        vigente && row?.linkCode && row.linkCodeExpiresAt
          ? {
              code: row.linkCode,
              command: row.botUsername
                ? `/vincular@${row.botUsername} ${row.linkCode}`
                : `/vincular ${row.linkCode}`,
              expiresAt: row.linkCodeExpiresAt,
            }
          : null,
      enabled: row?.enabled ?? false,
      mutedUntil: row?.mutedUntil ?? null,
      categories: leerCategorias(row?.categories),
      reminderMinutes: n.reminderMinutes,
      maxReminders: n.maxReminders,
      quietHoursEnabled: n.quietHoursEnabled,
      quietFromHour: n.quietFromHour,
      quietToHour: n.quietToHour,
      dailySummaryEnabled: row?.dailySummaryEnabled ?? true,
      panelBaseUrl: row?.panelBaseUrl ?? null,
      panelBaseEffective: baseDelPanel(
        row?.panelBaseUrl,
        process.env.PUBLIC_API_URL,
      ),
      lastOkAt: row?.lastOkAt ?? null,
      lastError: row?.lastError ?? null,
      lastErrorAt: row?.lastErrorAt ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  /** Un valor que no se puede descifrar (llave rotada) cuenta como ausente. */
  private safeDecrypt(value: string): string | null {
    try {
      return this.cipher.decrypt(value) || null;
    } catch {
      return null;
    }
  }
}
