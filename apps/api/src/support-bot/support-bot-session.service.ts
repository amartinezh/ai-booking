import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomInt } from 'crypto';
import { Prisma } from '@agenia/database';
import {
  AJUSTES_SOPORTE_POR_DEFECTO,
  LIMITES_SOPORTE,
  flujoAlCerrar,
  flujoAlRetomar,
  guardarFlujo,
  type BorradorCaso,
  accesoAlAsistente,
  conversacionVigente,
  enElPiloto,
  intentosRestantes,
  type MotivoCierre,
  type UserRole,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage } from '../common/error-message.util';
import { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotWatchService } from './support-bot-watch.service';
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
      /** Un caso que quedó a medio abrir en su conversación anterior (< 24 h). */
      borradorRetomado: BorradorCaso | null;
    };

export type EstadoConversacion =
  | { tipo: 'NINGUNA' }
  | { tipo: 'REVOCADA'; chatId: string }
  | { tipo: 'VIGENTE'; interlocutor: Interlocutor };

/** Un botón de un aviso que espera el código: sus datos y el mensaje donde estaba. */
export interface AccionEnEspera {
  datos: string;
  messageId: number | null;
}

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
    @Optional() private readonly vigilancia?: SupportBotWatchService,
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
    } else if (!enElPiloto(rt.piloto, userId, user.role as UserRole)) {
      throw new ForbiddenException(
        'El asistente de soporte está en piloto con algunas personas. Pronto estará para todo el personal.',
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
        void this.vigilancia?.contar('codigos');
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
    const rt = await this.config.runtime();
    // Fuera del piloto (la lista cambió después de pedir el código) no se abre.
    const fueraDelPiloto =
      !!rt && !enElPiloto(rt.piloto, fila.user.id, fila.user.role as UserRole);
    if (acceso === 'NINGUNO' || !orgId || !org?.isActive || fueraDelPiloto) {
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
          select: {
            id: true,
            chatId: true,
            lastMessageAt: true,
            flowState: true,
          },
        });
        const vigentes = abiertas.filter((c) =>
          conversacionVigente(
            { closedAt: null, lastMessageAt: c.lastMessageAt },
            ahora,
            minutos,
          ),
        );
        // Cada una se cierra con su motivo, y su borrador queda 24 h para retomarlo.
        for (const c of abiertas) {
          await tx.supportBotConversation.update({
            where: { id: c.id },
            data: {
              closedAt: ahora,
              closeReason: (vigentes.includes(c)
                ? 'OTRA_CONVERSACION'
                : 'INACTIVIDAD') satisfies MotivoCierre,
              flowState: jsonOVacio(flujoAlCerrar(c.flowState, ahora)),
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

        // Un caso que quedó a medio abrir en su última conversación se retoma aquí.
        const anterior = await tx.supportBotConversation.findFirst({
          where: {
            userId: fila.userId,
            closedAt: { not: null },
            NOT: { flowState: { equals: Prisma.DbNull } },
          },
          orderBy: { closedAt: 'desc' },
          select: { id: true, flowState: true },
        });
        const retomado = anterior
          ? flujoAlRetomar(anterior.flowState, ahora)
          : null;
        if (anterior && retomado) {
          await tx.supportBotConversation.update({
            where: { id: conversacion.id },
            data: { flowState: jsonOVacio(guardarFlujo(retomado.flujo)) },
          });
          await tx.supportBotConversation.update({
            where: { id: anterior.id },
            data: { flowState: Prisma.DbNull },
          });
        }
        return {
          conversationId: conversacion.id,
          borradorRetomado: retomado?.borrador ?? null,
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
      borradorRetomado: resultado.borradorRetomado,
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

    const rt = await this.config.runtime();
    if (!conversacionVigente(c, ahora, rt?.conversationIdleMinutes)) {
      await this.cerrar(c.id, 'INACTIVIDAD', ahora);
      return { tipo: 'NINGUNA' };
    }

    const acceso = accesoAlAsistente(c.user.role as UserRole);
    const vale =
      c.organization.isActive &&
      ((acceso === 'PERSONAL' &&
        !c.isTest &&
        c.user.organizationId === c.organizationId &&
        (!rt || enElPiloto(rt.piloto, c.user.id, c.user.role as UserRole))) ||
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
    const c = await this.prisma.supportBotConversation.findUnique({
      where: { id: conversationId },
      select: { flowState: true },
    });
    // El borrador de un caso a medio abrir queda 24 h para retomarlo.
    const r = await this.prisma.supportBotConversation.updateMany({
      where: { id: conversationId, closedAt: null },
      data: {
        closedAt: ahora,
        closeReason: motivo,
        flowState: jsonOVacio(flujoAlCerrar(c?.flowState ?? null, ahora)),
      },
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
    // Durante el piloto, la tarjeta solo aparece a quienes están en él.
    const disponible =
      !!rt?.enabled &&
      !!rt.botUsername &&
      (!rt.piloto.activo || rt.piloto.usuarios.includes(userId));
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

  // ── Lo que tocó en un aviso sin conversación (Redis, 10 min) ──────────

  /**
   * «No, sigue pasando» o «Ver la respuesta» en un aviso, sin conversación abierta:
   * se guarda y se hace apenas valide el código (§3.6). Una sola por cuenta: la
   * última gana.
   */
  async guardarAccionEnEspera(
    telegramUserId: string,
    accion: AccionEnEspera,
  ): Promise<boolean> {
    try {
      await this.redis.set(
        claveAccion(telegramUserId),
        JSON.stringify(accion),
        'EX',
        LIMITES_SOPORTE.accionEnEsperaMinutos * 60,
      );
      return true;
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo guardar la acción en espera: ${getErrorMessage(e)}`,
      );
      return false;
    }
  }

  async tomarAccionEnEspera(
    telegramUserId: string,
  ): Promise<AccionEnEspera | null> {
    try {
      const clave = claveAccion(telegramUserId);
      const json = await this.redis.get(clave);
      if (json === null) return null;
      await this.redis.del(clave);
      const a = JSON.parse(json) as Partial<AccionEnEspera>;
      return typeof a.datos === 'string'
        ? {
            datos: a.datos,
            messageId: typeof a.messageId === 'number' ? a.messageId : null,
          }
        : null;
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo leer la acción en espera: ${getErrorMessage(e)}`,
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
    // Para las cifras del panel y la alerta de muchos códigos equivocados.
    void this.vigilancia?.codigoFallido();
    if (restantes === 0) void this.vigilancia?.contar('bloqueos');
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
const claveAccion = (telegramUserId: string) =>
  `soporte:accion:${telegramUserId}`;
const claveEspera = (telegramUserId: string) =>
  `soporte:espera:${telegramUserId}`;

/** Un flujo para la columna JSON: el objeto, o NULL de la base si no hay nada. */
function jsonOVacio(
  v: object | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v ? (v as Prisma.InputJsonValue) : Prisma.DbNull;
}

function esUnicoRepetido(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}
