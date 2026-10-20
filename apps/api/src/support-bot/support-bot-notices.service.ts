import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LIMITES_SOPORTE,
  ROLES_DEL_ASISTENTE,
  TEXTOS_SOPORTE,
  type UserRole,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';
import { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotSessionService } from './support-bot-session.service';
import { SupportBotService } from './support-bot.service';
import type { SupportBotRuntime } from './support-bot.types';

const MS_HORA = 3_600_000;
/** Casos que se miran por vuelta (tope de seguridad). */
const MAX_FILAS = 50;

type Estado = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

interface CasoPorAvisar {
  id: string;
  number: number;
  title: string;
  status: Estado;
  startedAt: Date | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  reporterId: string;
  reporterNotifiedStatus: Estado | null;
}

export interface ResumenSeguimiento {
  avisados: number;
  /** Cambios que no se avisan: viejos, sin destino o con los avisos apagados. */
  sinAviso: number;
  fallidos: number;
}

const VACIO: ResumenSeguimiento = { avisados: 0, sinAviso: 0, fallidos: 0 };

/**
 * «Se apersona» (docs/PLAN_BOT_SOPORTE.md §3.6, S12): cada minuto compara el estado
 * de cada caso con el último que se le avisó a quien lo reportó y le escribe por
 * Telegram: «👀 lo tomaron» y «✅ quedó resuelto, ¿quedó bien?». También los casos
 * del panel. La web no se toca: «Iniciar atención» y «Marcar solucionado» siguen
 * siendo las mismas acciones.
 *
 *  · Va a la cuenta de Telegram de su última conversación con el asistente. Sin
 *    conversaciones, con los avisos apagados (tarjeta de Soporte) o sin acceso al
 *    asistente, el cambio se da por avisado sin enviar nada.
 *  · 🔒 Sin conversación abierta, el «resuelto» no lleva la respuesta del equipo
 *    (puede nombrar datos): «Ver la respuesta» pide el código.
 *  · Un cambio de más de 24 h no se avisa (el asistente estuvo apagado, por ejemplo).
 *  · Dos réplicas: el aviso se RECLAMA con un compare-and-set del último estado
 *    avisado; si Telegram falla por algo pasajero, se devuelve y se reintenta.
 */
@Injectable()
export class SupportBotNoticesService {
  private readonly logger = new Logger(SupportBotNoticesService.name);
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SupportBotConfigService,
    private readonly sesiones: SupportBotSessionService,
    private readonly bot: SupportBotService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cadaMinuto(): Promise<void> {
    await this.vuelta();
  }

  /** Nunca lanza. */
  async vuelta(ahora: Date = new Date()): Promise<ResumenSeguimiento> {
    if (this.enCurso) return { ...VACIO };
    this.enCurso = true;
    try {
      const rt = await this.config.runtime();
      if (!rt?.enabled) return { ...VACIO };
      return await this.unaVuelta(rt, ahora);
    } catch (error: unknown) {
      this.logger.error(
        `La vuelta de los avisos a quien reportó falló: ${getErrorMessage(error)}`,
      );
      return { ...VACIO };
    } finally {
      this.enCurso = false;
    }
  }

  private async unaVuelta(
    rt: SupportBotRuntime,
    ahora: Date,
  ): Promise<ResumenSeguimiento> {
    const resumen: ResumenSeguimiento = { ...VACIO };
    const pendiente = (estado: Estado) => ({
      status: estado,
      OR: [
        { reporterNotifiedStatus: null },
        { reporterNotifiedStatus: { not: estado } },
      ],
    });
    const casos = (await this.prisma.supportTicket.findMany({
      where: { OR: [pendiente('IN_PROGRESS'), pendiente('RESOLVED')] },
      orderBy: { updatedAt: 'asc' },
      take: MAX_FILAS,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        startedAt: true,
        resolvedAt: true,
        resolutionNote: true,
        reporterId: true,
        reporterNotifiedStatus: true,
      },
    })) as CasoPorAvisar[];

    for (const caso of casos) {
      // Primero se reclama: una sola réplica avisa.
      const reclamo = await this.prisma.supportTicket.updateMany({
        where: {
          id: caso.id,
          status: caso.status,
          reporterNotifiedStatus: caso.reporterNotifiedStatus,
        },
        data: {
          reporterNotifiedStatus: caso.status,
          reporterNotifiedAt: ahora,
        },
      });
      if (reclamo.count !== 1) continue;

      const cambio =
        caso.status === 'IN_PROGRESS' ? caso.startedAt : caso.resolvedAt;
      const reciente =
        !!cambio &&
        ahora.getTime() - cambio.getTime() <=
          LIMITES_SOPORTE.avisoRecienteHoras * MS_HORA;
      const destino = reciente ? await this.destino(caso.reporterId) : null;
      if (!destino) {
        resumen.sinAviso++;
        continue;
      }

      const r = await this.avisar(rt, caso, destino, ahora);
      if (r.ok) {
        resumen.avisados++;
        continue;
      }
      resumen.fallidos++;
      if (r.reintentar) {
        await this.prisma.supportTicket.updateMany({
          where: {
            id: caso.id,
            reporterNotifiedStatus: caso.status,
            reporterNotifiedAt: ahora,
          },
          data: { reporterNotifiedStatus: caso.reporterNotifiedStatus },
        });
      }
    }
    return resumen;
  }

  /**
   * A dónde va el aviso: la cuenta de su última conversación (no las de prueba).
   * `null` si apagó los avisos, nunca conversó o ya no tiene acceso al asistente.
   */
  private async destino(
    userId: string,
  ): Promise<{ chatId: string; telegramUserId: string } | null> {
    const [pref, ultima, usuario] = await Promise.all([
      this.prisma.supportBotPreference.findUnique({
        where: { userId },
        select: { ticketNotices: true },
      }),
      this.prisma.supportBotConversation.findFirst({
        where: { userId, isTest: false },
        orderBy: { startedAt: 'desc' },
        select: { chatId: true, telegramUserId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, organization: { select: { isActive: true } } },
      }),
    ]);
    if (pref?.ticketNotices === false || !ultima || !usuario) return null;
    if (!ROLES_DEL_ASISTENTE.includes(usuario.role as UserRole)) return null;
    if (usuario.organization?.isActive === false) return null;
    return ultima;
  }

  private async avisar(
    rt: SupportBotRuntime,
    caso: CasoPorAvisar,
    destino: { chatId: string; telegramUserId: string },
    ahora: Date,
  ) {
    // Con su conversación abierta en esa cuenta, el aviso va completo y queda en ella.
    const estado = await this.sesiones.conversacionDe(
      destino.telegramUserId,
      ahora,
    );
    const yo =
      estado.tipo === 'VIGENTE' &&
      estado.interlocutor.userId === caso.reporterId
        ? estado.interlocutor
        : null;
    const datos = { numero: caso.number, titulo: caso.title };
    if (caso.status === 'IN_PROGRESS') {
      return this.bot.enviarAviso(
        rt,
        { chatId: destino.chatId, yo },
        TEXTOS_SOPORTE.avisoTomado(datos),
        null,
      );
    }
    return this.bot.enviarAviso(
      rt,
      { chatId: destino.chatId, yo },
      TEXTOS_SOPORTE.avisoResuelto({
        ...datos,
        respuesta: yo ? (caso.resolutionNote ?? '') : null,
      }),
      { caso: caso.number, conVer: !yo },
    );
  }
}
