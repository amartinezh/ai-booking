import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomInt } from 'crypto';
import { Prisma } from '@agenia/database';
import {
  AJUSTES_SOPORTE_POR_DEFECTO,
  LIMITES_SOPORTE,
  accesoAlAsistente,
  conversacionVigente,
  intentosRestantes,
  type MotivoCierre,
  type UserRole,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage } from '../common/error-message.util';
import { SupportBotConfigService } from './support-bot-config.service';
import type {
  CodigoGenerado,
  EstadoAsistenteParaUsuario,
} from './support-bot.types';

const MS_MIN = 60_000;
type TipoCodigo = 'CORTO' | 'ENLACE';

/** Quien conversa, tal como queda tras validar el código o revalidar un mensaje. */
export interface Interlocutor {
  conversationId: string;
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  isTest: boolean;
  chatId: string;
  telegramName: string | null;
}

export type ResultadoCodigo =
  | { tipo: 'BLOQUEADO'; minutos: number }
  | { tipo: 'INVALIDO'; restantes: number }
  | { tipo: 'SIN_ACCESO' }
  | {
      tipo: 'ABIERTA';
      interlocutor: Interlocutor;
      /** Chats de conversaciones vigentes que esta cerró (para avisarles). */
      chatsCerrados: string[];
    };

export type EstadoConversacion =
  | { tipo: 'NINGUNA' }
  | { tipo: 'REVOCADA'; chatId: string }
  | { tipo: 'VIGENTE'; interlocutor: Interlocutor };

/**
 * Códigos y conversaciones del asistente de soporte (docs/PLAN_BOT_SOPORTE.md
 * §3.1, S3): el código del panel se pide EN CADA CONVERSACIÓN.
 *
 *   · El código se genera al pedirlo en Soporte: 6 dígitos para escribir y uno
 *     largo para el QR. Los dos sirven una vez, vencen a los 10 minutos y generar
 *     otro anula el anterior. En la base solo queda su HMAC.
 *   · 5 intentos fallidos por cuenta de Telegram y 1 hora de bloqueo (Redis).
 *   · Una conversación abierta por usuario y por cuenta de Telegram (índices
 *     parciales en la base); abrir otra cierra la anterior en la misma transacción.
 *   · Cada mensaje revalida usuario, rol y clínica.
 */
@Injectable()
export class SupportBotSessionService {
  private readonly logger = new Logger(SupportBotSessionService.name);
  private readonly clave: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: SupportBotConfigService,
  ) {
    this.clave =
      process.env.SUPPORT_BOT_CODE_KEY?.trim() ||
      process.env.ENCRYPTION_KEY?.trim() ||
      null;
  }

  // ── El código, desde el panel ──────────────────────────────────────────

  /**
   * Genera el código de quien lo pide. El rol y la clínica se releen de la base
   * (el token puede ser de antes de un cambio). El super admin solo prueba, y como
   * una clínica que elige.
   */
  async generarCodigo(
    userId: string,
    opts: { testOrganizationId?: string } = {},
  ): Promise<CodigoGenerado> {
    const rt = await this.config.runtime();
    if (!rt?.enabled || !rt.botUsername) {
      throw new ConflictException(
        'El asistente de soporte no está disponible.',
      );
    }
    if (!this.clave) {
      throw new ServiceUnavailableException(
        'El servidor no tiene la clave de los códigos (SUPPORT_BOT_CODE_KEY o ENCRYPTION_KEY).',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        organizationId: true,
        organization: { select: { isActive: true } },
      },
    });
    const acceso = user ? accesoAlAsistente(user.role as UserRole) : 'NINGUNO';
    let testOrganizationId: string | null = null;
    if (acceso === 'PRUEBA') {
      if (!opts.testOrganizationId) {
        throw new BadRequestException(
          'Elija la clínica con la que quiere probar.',
        );
      }
      const org = await this.prisma.organization.findUnique({
        where: { id: opts.testOrganizationId },
        select: { isActive: true },
      });
      if (!org?.isActive)
        throw new BadRequestException(
          'Esa clínica no existe o está suspendida.',
        );
      testOrganizationId = opts.testOrganizationId;
    } else if (acceso !== 'PERSONAL' || !user?.organization?.isActive) {
      throw new ForbiddenException(
        'Tu usuario no tiene acceso al asistente de soporte.',
      );
    }

    const ahora = new Date();
    const expiresAt = new Date(
      ahora.getTime() + LIMITES_SOPORTE.codigoMinutos * MS_MIN,
    );
    // Generar otro anula el anterior (los dos tipos).
    await this.prisma.supportBotCode.deleteMany({
      where: { userId, usedAt: null },
    });

    const enlace = randomBytes(24).toString('base64url');
    await this.prisma.supportBotCode.create({
      data: {
        userId,
        kind: 'ENLACE',
        codeHmac: this.hmac('ENLACE', enlace),
        testOrganizationId,
        expiresAt,
      },
    });

    // Dos códigos de 6 dígitos iguales no pueden convivir: si el sorteo repite uno, otro.
    for (let intento = 0; intento < 8; intento++) {
      const codigo = String(randomInt(0, 1_000_000)).padStart(
        LIMITES_SOPORTE.digitosCodigo,
        '0',
      );
      try {
        await this.prisma.supportBotCode.create({
          data: {
            userId,
            kind: 'CORTO',
            codeHmac: this.hmac('CORTO', codigo),
            testOrganizationId,
            expiresAt,
          },
        });
        return {
          codigo,
          enlace: `https://t.me/${rt.botUsername}?start=${enlace}`,
          botUsername: rt.botUsername,
          venceEn: expiresAt.toISOString(),
        };
      } catch (e: unknown) {
        if (!esUnicoRepetido(e)) throw e;
      }
    }
    throw new ServiceUnavailableException(
      'No se pudo generar un código. Intente de nuevo.',
    );
  }

  // ── El código, desde Telegram ──────────────────────────────────────────

  /**
   * Valida un código escrito (o traído por el QR) y, si sirve, abre la
   * conversación. Un código que no sirve cuenta como intento fallido de esa
   * cuenta de Telegram; al quinto, una hora de bloqueo.
   */
  async validarCodigo(p: {
    codigo: string;
    tipo: TipoCodigo;
    telegramUserId: string;
    chatId: string;
    telegramName: string | null;
    ahora?: Date;
  }): Promise<ResultadoCodigo> {
    const ahora = p.ahora ?? new Date();
    const bloqueo = await this.bloqueo(p.telegramUserId);
    if (bloqueo) return { tipo: 'BLOQUEADO', minutos: bloqueo };

    const fila = this.clave
      ? await this.prisma.supportBotCode.findUnique({
          where: { codeHmac: this.hmac(p.tipo, p.codigo) },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                organizationId: true,
                organization: {
                  select: { id: true, name: true, isActive: true },
                },
              },
            },
          },
        })
      : null;
    if (
      !fila ||
      fila.kind !== p.tipo ||
      fila.usedAt ||
      fila.expiresAt <= ahora
    ) {
      return this.fallo(p.telegramUserId);
    }

    const acceso = accesoAlAsistente(fila.user.role as UserRole);
    const orgId =
      acceso === 'PRUEBA' ? fila.testOrganizationId : fila.user.organizationId;
    const org =
      acceso === 'PRUEBA' && orgId
        ? await this.prisma.organization.findUnique({
            where: { id: orgId },
            select: { id: true, name: true, isActive: true },
          })
        : fila.user.organization;
    if (acceso === 'NINGUNO' || !orgId || !org?.isActive) {
      await this.prisma.supportBotCode.updateMany({
        where: { id: fila.id, usedAt: null },
        data: { usedAt: ahora },
      });
      return { tipo: 'SIN_ACCESO' };
    }

    const minutos = (await this.config.runtime())?.conversationIdleMinutes;
    const abrir = () =>
      this.prisma.$transaction(async (tx) => {
        const usado = await tx.supportBotCode.updateMany({
          where: { id: fila.id, usedAt: null },
          data: { usedAt: ahora },
        });
        if (usado.count === 0) return null;

        const abiertas = await tx.supportBotConversation.findMany({
          where: {
            closedAt: null,
            OR: [{ userId: fila.userId }, { telegramUserId: p.telegramUserId }],
          },
          select: { id: true, chatId: true, lastMessageAt: true },
        });
        const vigentes = abiertas.filter((c) =>
          conversacionVigente(
            { closedAt: null, lastMessageAt: c.lastMessageAt },
            ahora,
            minutos,
          ),
        );
        const vencidas = abiertas.filter((c) => !vigentes.includes(c));
        if (vigentes.length > 0) {
          await tx.supportBotConversation.updateMany({
            where: { id: { in: vigentes.map((c) => c.id) } },
            data: {
              closedAt: ahora,
              closeReason: 'OTRA_CONVERSACION' satisfies MotivoCierre,
            },
          });
        }
        if (vencidas.length > 0) {
          await tx.supportBotConversation.updateMany({
            where: { id: { in: vencidas.map((c) => c.id) } },
            data: {
              closedAt: ahora,
              closeReason: 'INACTIVIDAD' satisfies MotivoCierre,
            },
          });
        }

        const conversacion = await tx.supportBotConversation.create({
          data: {
            userId: fila.userId,
            organizationId: orgId,
            telegramUserId: p.telegramUserId,
            chatId: p.chatId,
            telegramName: p.telegramName,
            verifiedBy: p.tipo === 'CORTO' ? 'CODIGO' : 'ENLACE',
            isTest: acceso === 'PRUEBA',
            startedAt: ahora,
            lastMessageAt: ahora,
          },
          select: { id: true },
        });
        return {
          conversationId: conversacion.id,
          chatsCerrados: [
            ...new Set(
              vigentes.map((c) => c.chatId).filter((c) => c !== p.chatId),
            ),
          ],
        };
      });
    // Dos códigos válidos del mismo usuario (el corto y el del QR) a la vez: el
    // índice parcial deja abrir solo una conversación y la otra transacción choca.
    // Se reintenta una vez: ya ve la abierta, la cierra y abre la suya (gana la última).
    let resultado: Awaited<ReturnType<typeof abrir>>;
    try {
      resultado = await abrir();
    } catch (e: unknown) {
      if (!esUnicoRepetido(e)) throw e;
      resultado = await abrir();
    }
    if (!resultado) return this.fallo(p.telegramUserId);

    await this.olvidarFallos(p.telegramUserId);
    return {
      tipo: 'ABIERTA',
      chatsCerrados: resultado.chatsCerrados,
      interlocutor: {
        conversationId: resultado.conversationId,
        userId: fila.user.id,
        email: fila.user.email,
        role: fila.user.role as UserRole,
        organizationId: org.id,
        organizationName: org.name,
        isTest: acceso === 'PRUEBA',
        chatId: p.chatId,
        telegramName: p.telegramName,
      },
    };
  }

  // ── La conversación ────────────────────────────────────────────────────

  /**
   * La conversación abierta de una cuenta de Telegram, revalidada. Una que pasó
   * los minutos sin mensajes se cierra aquí (INACTIVIDAD); una cuyo usuario perdió
   * el acceso, también (ACCESO_REVOCADO).
   */
  async conversacionDe(
    telegramUserId: string,
    ahora: Date = new Date(),
  ): Promise<EstadoConversacion> {
    const c = await this.prisma.supportBotConversation.findFirst({
      where: { telegramUserId, closedAt: null },
      include: {
        user: {
          select: { id: true, email: true, role: true, organizationId: true },
        },
        organization: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!c) return { tipo: 'NINGUNA' };

    const minutos = (await this.config.runtime())?.conversationIdleMinutes;
    if (!conversacionVigente(c, ahora, minutos)) {
      await this.cerrar(c.id, 'INACTIVIDAD', ahora);
      return { tipo: 'NINGUNA' };
    }

    const acceso = accesoAlAsistente(c.user.role as UserRole);
    const vale =
      c.organization.isActive &&
      ((acceso === 'PERSONAL' &&
        !c.isTest &&
        c.user.organizationId === c.organizationId) ||
        (acceso === 'PRUEBA' && c.isTest));
    if (!vale) {
      await this.cerrar(c.id, 'ACCESO_REVOCADO', ahora);
      return { tipo: 'REVOCADA', chatId: c.chatId };
    }

    return {
      tipo: 'VIGENTE',
      interlocutor: {
        conversationId: c.id,
        userId: c.user.id,
        email: c.user.email,
        role: c.user.role as UserRole,
        organizationId: c.organization.id,
        organizationName: c.organization.name,
        isTest: c.isTest,
        chatId: c.chatId,
        telegramName: c.telegramName,
      },
    };
  }

  /** Cierra una conversación si sigue abierta. Devuelve si la cerró. */
  async cerrar(
    conversationId: string,
    motivo: MotivoCierre,
    ahora: Date = new Date(),
  ): Promise<boolean> {
    const r = await this.prisma.supportBotConversation.updateMany({
      where: { id: conversationId, closedAt: null },
      data: { closedAt: ahora, closeReason: motivo },
    });
    return r.count > 0;
  }

  /** Marca un mensaje nuevo en la conversación (la mantiene viva). */
  async tocar(conversationId: string, ahora: Date = new Date()): Promise<void> {
    await this.prisma.supportBotConversation.updateMany({
      where: { id: conversationId, closedAt: null },
      data: { lastMessageAt: ahora },
    });
  }

  // ── La tarjeta de Soporte ──────────────────────────────────────────────

  async estadoPara(
    userId: string,
    ahora: Date = new Date(),
  ): Promise<EstadoAsistenteParaUsuario> {
    const rt = await this.config.runtime();
    const disponible = !!rt?.enabled && !!rt.botUsername;
    const [abierta, ultima, pref] = await Promise.all([
      this.prisma.supportBotConversation.findFirst({
        where: { userId, closedAt: null },
        select: {
          telegramName: true,
          startedAt: true,
          lastMessageAt: true,
          closedAt: true,
        },
      }),
      this.prisma.supportBotConversation.findFirst({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        select: { telegramName: true },
      }),
      this.prisma.supportBotPreference.findUnique({
        where: { userId },
        select: { ticketNotices: true },
      }),
    ]);
    const vigente =
      abierta &&
      conversacionVigente(abierta, ahora, rt?.conversationIdleMinutes)
        ? abierta
        : null;
    return {
      disponible,
      botUsername: disponible ? (rt?.botUsername ?? null) : null,
      conversacionMinutos:
        rt?.conversationIdleMinutes ??
        AJUSTES_SOPORTE_POR_DEFECTO.conversationIdleMinutes,
      conversacion: vigente
        ? {
            telegramName: vigente.telegramName,
            desde: vigente.startedAt.toISOString(),
            ultimoMensaje: vigente.lastMessageAt.toISOString(),
          }
        : null,
      avisos: {
        activos: pref?.ticketNotices ?? true,
        destino: ultima
          ? (ultima.telegramName ?? 'tu cuenta de Telegram')
          : null,
      },
    };
  }

  /** «Cerrar» desde el panel. Devuelve el chat al que hay que avisarle, si había conversación. */
  async cerrarDesdePanel(
    userId: string,
    ahora: Date = new Date(),
  ): Promise<string | null> {
    const abierta = await this.prisma.supportBotConversation.findFirst({
      where: { userId, closedAt: null },
      select: { id: true, chatId: true, lastMessageAt: true },
    });
    if (!abierta) return null;
    const minutos = (await this.config.runtime())?.conversationIdleMinutes;
    const vigente = conversacionVigente(
      { closedAt: null, lastMessageAt: abierta.lastMessageAt },
      ahora,
      minutos,
    );
    const cerrada = await this.cerrar(
      abierta.id,
      vigente ? 'PANEL' : 'INACTIVIDAD',
      ahora,
    );
    return cerrada && vigente ? abierta.chatId : null;
  }

  async cambiarAvisos(userId: string, activos: boolean): Promise<void> {
    await this.prisma.supportBotPreference.upsert({
      where: { userId },
      create: { userId, ticketNotices: activos },
      update: { ticketNotices: activos },
    });
  }

  // ── La pregunta en espera (Redis, 10 min) ──────────────────────────────

  async guardarPreguntaEnEspera(
    telegramUserId: string,
    texto: string,
  ): Promise<boolean> {
    try {
      await this.redis.set(
        claveEspera(telegramUserId),
        texto,
        'EX',
        LIMITES_SOPORTE.preguntaEnEsperaMinutos * 60,
      );
      return true;
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo guardar la pregunta en espera: ${getErrorMessage(e)}`,
      );
      return false;
    }
  }

  async tomarPreguntaEnEspera(telegramUserId: string): Promise<string | null> {
    try {
      const clave = claveEspera(telegramUserId);
      const texto = await this.redis.get(clave);
      if (texto !== null) await this.redis.del(clave);
      return texto;
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo leer la pregunta en espera: ${getErrorMessage(e)}`,
      );
      return null;
    }
  }

  // ── Intentos (Redis) ───────────────────────────────────────────────────

  /** Minutos de bloqueo que le quedan a la cuenta, o 0 si puede intentar. */
  private async bloqueo(telegramUserId: string): Promise<number> {
    try {
      const clave = claveFallos(telegramUserId);
      const fallos = Number((await this.redis.get(clave)) ?? 0);
      if (intentosRestantes(fallos) > 0) return 0;
      const ttl = await this.redis.ttl(clave);
      return Math.max(
        1,
        Math.ceil((ttl > 0 ? ttl : LIMITES_SOPORTE.bloqueoMinutos * 60) / 60),
      );
    } catch (e: unknown) {
      // Sin Redis no se cuentan intentos: los códigos siguen siendo de un uso y de 10 min.
      this.logger.warn(`Sin conteo de intentos (Redis): ${getErrorMessage(e)}`);
      return 0;
    }
  }

  private async fallo(telegramUserId: string): Promise<ResultadoCodigo> {
    let fallos = 1;
    try {
      const clave = claveFallos(telegramUserId);
      fallos = await this.redis.incr(clave);
      if (fallos === 1)
        await this.redis.expire(clave, LIMITES_SOPORTE.bloqueoMinutos * 60);
    } catch (e: unknown) {
      this.logger.warn(`Sin conteo de intentos (Redis): ${getErrorMessage(e)}`);
    }
    const restantes = intentosRestantes(fallos);
    return restantes === 0
      ? { tipo: 'BLOQUEADO', minutos: LIMITES_SOPORTE.bloqueoMinutos }
      : { tipo: 'INVALIDO', restantes };
  }

  private async olvidarFallos(telegramUserId: string): Promise<void> {
    try {
      await this.redis.del(claveFallos(telegramUserId));
    } catch {
      // Vence solo en una hora.
    }
  }

  private hmac(tipo: TipoCodigo, codigo: string): string {
    return createHmac('sha256', this.clave ?? '')
      .update(`support-bot-code:${tipo}:${codigo}`)
      .digest('hex');
  }
}

const claveFallos = (telegramUserId: string) =>
  `soporte:fallos:${telegramUserId}`;
const claveEspera = (telegramUserId: string) =>
  `soporte:espera:${telegramUserId}`;

function esUnicoRepetido(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}
