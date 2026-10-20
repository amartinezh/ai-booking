import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AVISO_CASO_AL_GRUPO,
  TEXTO_SIN_AVISO_CASO,
  enlacePanel,
  gravedadDelAvisoDeCaso,
  horarioEquipoDe,
  motivoEsperaAvisoCaso,
  pasoDelAvisoAlGrupo,
  sinSonido,
  textoAvisoCasoNuevo,
  textoCasoReabierto,
  textoCasoSinTomar,
  tocaRecordarSinTomar,
  type DatosAvisoCaso,
  type HorarioEquipo,
  type UserRole,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';
import { TechAlertConfigService } from './tech-alert-config.service';
import type { TechAlertChannel } from './tech-alerts.types';

const MS_MIN = 60_000;
/** Casos que se miran por vuelta (los pendientes son pocos: esto es un tope de seguridad). */
const MAX_FILAS = 50;

const CASO = {
  id: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  channel: true,
  reopenedCount: true,
  groupNotice: true,
  groupNoticeAttempts: true,
  groupNoticeError: true,
  groupNotifiedAt: true,
  unattendedRemindedAt: true,
  updatedAt: true,
  reporter: { select: { email: true, role: true } },
  organization: { select: { name: true } },
} as const;

interface Caso {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: 'NORMAL' | 'HIGH';
  channel: 'PANEL' | 'TELEGRAM';
  reopenedCount: number;
  groupNotice: string;
  groupNoticeAttempts: number;
  groupNoticeError: string | null;
  groupNotifiedAt: Date | null;
  unattendedRemindedAt: Date | null;
  updatedAt: Date;
  reporter: { email: string; role: string };
  organization: { name: string };
}

export interface ResumenAvisosCasos {
  enviados: number;
  fallidos: number;
  omitidos: number;
  recordados: number;
}

const VACIO: ResumenAvisosCasos = {
  enviados: 0,
  fallidos: 0,
  omitidos: 0,
  recordados: 0,
};

/**
 * El aviso al grupo del equipo técnico de cada caso de Soporte (docs/PLAN_BOT_SOPORTE.md
 * §3.5, S10 a S12): los del panel y los del asistente de Telegram, el reabierto y el
 * que lleva 2 h del horario del equipo sin que nadie lo tome.
 *
 * Sale por el canal de las alertas técnicas (su bot, su grupo, su silencio nocturno y
 * la categoría «Casos de soporte», que se puede apagar), pero no es una alerta: vive
 * en `SupportTicket.groupNotice*`. Por eso está aquí y no en el módulo del asistente:
 * los casos del panel se avisan aunque el asistente esté apagado.
 *
 * ═══ Lo que no se negocia ═══
 *  · 🔒 Nunca la descripción ni la conversación: solo número, prioridad, clínica, rol,
 *    correo, canal, el título saneado y el enlace (soporte-caso.ts).
 *  · El caso se abre igual si el aviso no sale: la Mesa de Ayuda dice por qué y aquí
 *    se reintenta (1 min, 2 min… hasta 15), hasta 24 h quieto o 20 intentos.
 *  · Dos réplicas: cada aviso se RECLAMA con un compare-and-set del contador de
 *    intentos antes de enviarlo; el recordatorio, con su fecha.
 */
@Injectable()
export class SupportTicketGroupNotifier {
  private readonly logger = new Logger(SupportTicketGroupNotifier.name);
  private enCurso = false;
  private otraVuelta = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TechAlertConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cadaMinuto(): Promise<void> {
    await this.vuelta();
  }

  /** Sin esperar al minuto: el asistente lo pide al abrir o reabrir un caso. */
  pronto(): void {
    setImmediate(() => void this.vuelta());
  }

  /** Nunca lanza. */
  async vuelta(ahora: Date = new Date()): Promise<ResumenAvisosCasos> {
    if (this.enCurso) {
      this.otraVuelta = true;
      return { ...VACIO };
    }
    this.enCurso = true;
    try {
      return await this.unaVuelta(ahora);
    } catch (error: unknown) {
      this.logger.error(
        `La vuelta de los avisos de casos falló: ${getErrorMessage(error)}`,
      );
      return { ...VACIO };
    } finally {
      this.enCurso = false;
      if (this.otraVuelta) {
        this.otraVuelta = false;
        setImmediate(() => void this.vuelta());
      }
    }
  }

  private async unaVuelta(ahora: Date): Promise<ResumenAvisosCasos> {
    const resumen: ResumenAvisosCasos = { ...VACIO };
    const canal = await this.config.canal({ fresco: true });
    const espera = motivoEsperaAvisoCaso(
      canal
        ? {
            enabled: canal.enabled,
            categories: canal.antirruido.categories,
            mutedUntilIso: canal.mutedUntilIso,
          }
        : null,
      ahora,
    );

    const pendientes = (await this.prisma.supportTicket.findMany({
      where: { groupNotice: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: MAX_FILAS,
      select: CASO,
    })) as Caso[];

    let cupo: number = AVISO_CASO_AL_GRUPO.maxPorVuelta;
    for (const caso of pendientes) {
      const paso = pasoDelAvisoAlGrupo(caso, espera, ahora);
      if (paso.tipo === 'OMITIR') {
        await this.prisma.supportTicket.updateMany({
          where: { id: caso.id, groupNotice: 'PENDING' },
          data: {
            groupNotice: 'SKIPPED',
            groupNoticeError: TEXTO_SIN_AVISO_CASO[paso.motivo],
          },
        });
        resumen.omitidos++;
        continue;
      }
      if (paso.tipo === 'ESPERAR') {
        // Se deja dicho por qué espera (una vez: no se escribe cada minuto).
        const motivo = paso.motivo ? TEXTO_SIN_AVISO_CASO[paso.motivo] : null;
        if (motivo && motivo !== caso.groupNoticeError) {
          await this.prisma.supportTicket.updateMany({
            where: { id: caso.id, groupNotice: 'PENDING' },
            data: { groupNoticeError: motivo },
          });
        }
        continue;
      }
      if (cupo === 0 || !canal) break;
      cupo--;
      await this.avisar(caso, canal, ahora, resumen);
    }

    if (!espera && canal && cupo > 0) {
      await this.sinTomar(canal, ahora, cupo, resumen);
    }
    return resumen;
  }

  private async avisar(
    caso: Caso,
    canal: TechAlertChannel,
    ahora: Date,
    resumen: ResumenAvisosCasos,
  ): Promise<void> {
    const reclamo = await this.prisma.supportTicket.updateMany({
      where: {
        id: caso.id,
        groupNotice: 'PENDING',
        groupNoticeAttempts: caso.groupNoticeAttempts,
      },
      data: { groupNoticeAttempts: { increment: 1 } },
    });
    if (reclamo.count !== 1) return;

    const datos = this.datos(caso, canal);
    const r = await this.config.enviar(
      caso.reopenedCount > 0
        ? textoCasoReabierto(datos)
        : textoAvisoCasoNuevo(datos),
      {
        silent: sinSonido(
          gravedadDelAvisoDeCaso(caso.priority),
          ahora,
          canal.antirruido,
        ),
        canal,
      },
    );
    await this.prisma.supportTicket.updateMany({
      where: { id: caso.id, groupNotice: 'PENDING' },
      data: r.ok
        ? {
            groupNotice: 'SENT',
            groupNotifiedAt: ahora,
            groupNoticeError: null,
          }
        : { groupNoticeError: r.error || 'Telegram no aceptó el aviso.' },
    });
    if (r.ok) resumen.enviados++;
    else resumen.fallidos++;
  }

  /** «⏰ El caso #58 lleva 2 h sin que nadie lo tome», una sola vez por caso. */
  private async sinTomar(
    canal: TechAlertChannel,
    ahora: Date,
    cupo: number,
    resumen: ResumenAvisosCasos,
  ): Promise<void> {
    const candidatos = (await this.prisma.supportTicket.findMany({
      where: {
        status: 'OPEN',
        groupNotice: 'SENT',
        unattendedRemindedAt: null,
        groupNotifiedAt: {
          lte: new Date(
            ahora.getTime() - AVISO_CASO_AL_GRUPO.sinTomarMinutos * MS_MIN,
          ),
        },
      },
      orderBy: { groupNotifiedAt: 'asc' },
      take: MAX_FILAS,
      select: CASO,
    })) as Caso[];
    if (candidatos.length === 0) return;

    const horario = await this.horario();
    for (const caso of candidatos) {
      if (cupo === 0) return;
      if (!tocaRecordarSinTomar(caso, ahora, horario)) continue;
      const reclamo = await this.prisma.supportTicket.updateMany({
        where: { id: caso.id, status: 'OPEN', unattendedRemindedAt: null },
        data: { unattendedRemindedAt: ahora },
      });
      if (reclamo.count !== 1) continue;
      cupo--;
      const r = await this.config.enviar(
        textoCasoSinTomar(
          this.datos(caso, canal),
          AVISO_CASO_AL_GRUPO.sinTomarMinutos / 60,
        ),
        {
          silent: sinSonido(
            gravedadDelAvisoDeCaso(caso.priority),
            ahora,
            canal.antirruido,
          ),
          canal,
        },
      );
      if (r.ok) {
        resumen.recordados++;
        continue;
      }
      // Se devuelve: la vuelta siguiente lo intenta otra vez.
      await this.prisma.supportTicket.updateMany({
        where: { id: caso.id, unattendedRemindedAt: ahora },
        data: { unattendedRemindedAt: null },
      });
      resumen.fallidos++;
    }
  }

  private datos(caso: Caso, canal: TechAlertChannel): DatosAvisoCaso {
    return {
      numero: caso.number,
      prioridad: caso.priority,
      clinica: caso.organization.name,
      rol: caso.reporter.role as UserRole,
      correo: caso.reporter.email,
      canal: caso.channel,
      titulo: caso.title,
      enlace:
        enlacePanel(canal.panelBase, '/super-admin/support') ??
        'panel › Mesa de Ayuda',
    };
  }

  /** El horario del equipo es el del asistente (S14); sin su fila, el de siempre. */
  private async horario(): Promise<HorarioEquipo> {
    try {
      return horarioEquipoDe(
        await this.prisma.supportBotConfig.findUnique({
          where: { id: 'global' },
          select: {
            teamDays: true,
            teamFromHour: true,
            teamToHour: true,
            teamTimeZone: true,
          },
        }),
      );
    } catch {
      return horarioEquipoDe(null);
    }
  }
}
