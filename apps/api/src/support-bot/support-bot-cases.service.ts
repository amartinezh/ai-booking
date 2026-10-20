import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  FLUJO_VACIO,
  LIMITES_SOPORTE,
  descripcionDelCaso,
  guardarFlujo,
  incidentesParaElPersonal,
  leerFlujo,
  type BorradorCaso,
  type CasoDeLaPersona,
  type FlujoConversacion,
  type IncidenteParaElPersonal,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SupportTicketGroupNotifier } from '../tech-alerts/support-ticket-group.notifier';
import type { Interlocutor } from './support-bot-session.service';

/** Los casos que se le muestran: abiertos y los solucionados del último mes. */
const MAX_CASOS = 5;
const DIAS_SOLUCIONADOS = 30;
/** Lo que la persona escribió que queda en el caso (los últimos mensajes). */
const MAX_TEXTOS_EN_EL_CASO = 20;
/** Las alertas técnicas que le pueden importar al personal (§3.2 punto 3). */
const ALERTAS_DEL_PERSONAL = [
  'SERVICIO_CAIDO',
  'SERVICIO_DEGRADADO',
  'REDIS_ERROR',
  'RECORDATORIOS_FALLIDOS',
  'AVISO_AGENDADOR_NO_SALE',
];

/** Lo que hace falta de un caso para responder un botón de su aviso. */
export interface CasoDelAviso {
  numero: number;
  titulo: string;
  estado: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  respuesta: string | null;
}

/**
 * Los casos de Soporte desde el asistente (docs/PLAN_BOT_SOPORTE.md §3.4 y §3.6):
 * los de la persona, lo que el equipo técnico ya sabe que falla, abrir el caso,
 * agregarle una nota, reabrirlo («No, sigue pasando») y el flujo de la conversación.
 *
 * La clínica y el autor del caso salen SIEMPRE de la conversación verificada
 * (`Interlocutor`), nunca de la IA. Una nota y una reapertura solo van a un caso de
 * la misma persona. Al abrir o reabrir un caso se le pide al despachador del grupo
 * que no espere al minuto (`SupportTicketGroupNotifier`, módulo de alertas técnicas).
 */
@Injectable()
export class SupportBotCasesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly avisosAlGrupo?: SupportTicketGroupNotifier,
  ) {}

  /** Sus casos: abiertos y los solucionados del último mes, los más recientes primero. */
  async casosDe(
    yo: Interlocutor,
    ahora: Date = new Date(),
  ): Promise<CasoDeLaPersona[]> {
    const filas = await this.prisma.supportTicket.findMany({
      where: {
        reporterId: yo.userId,
        organizationId: yo.organizationId,
        OR: [
          { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          {
            resolvedAt: {
              gte: new Date(ahora.getTime() - DIAS_SOLUCIONADOS * 86_400_000),
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_CASOS,
      select: {
        number: true,
        title: true,
        status: true,
        createdAt: true,
        startedAt: true,
        resolvedAt: true,
        resolutionNote: true,
      },
    });
    return filas.map((f) => ({
      numero: f.number,
      titulo: f.title,
      estado: f.status,
      creadoEn: f.createdAt,
      tomadoEn: f.startedAt,
      resueltoEn: f.resolvedAt,
      respuesta: f.status === 'RESOLVED' ? f.resolutionNote : null,
    }));
  }

  /** Lo que el equipo técnico ya sabe que falla y le importa a esta clínica. */
  async incidentesPara(
    organizationId: string,
    ia: string | null,
  ): Promise<IncidenteParaElPersonal[]> {
    const alertas = await this.prisma.techAlert.findMany({
      where: {
        status: 'ABIERTA',
        kind: { in: ALERTAS_DEL_PERSONAL },
        OR: [{ organizationId }, { organizationId: null }],
      },
      orderBy: { firstSeenAt: 'asc' },
      select: {
        kind: true,
        dedupeKey: true,
        organizationId: true,
        firstSeenAt: true,
      },
    });
    return incidentesParaElPersonal(alertas, { organizationId, ia });
  }

  /**
   * Abre el caso con el borrador confirmado. La descripción lleva el resumen y lo
   * que la persona escribió tal cual (la IA lo vio enmascarado; el equipo lo
   * necesita completo). Devuelve el número del caso.
   */
  async abrirCaso(yo: Interlocutor, borrador: BorradorCaso): Promise<number> {
    const textos = (
      await this.prisma.supportBotMessage.findMany({
        where: { conversationId: yo.conversationId, direction: 'ENTRADA' },
        orderBy: { createdAt: 'desc' },
        take: MAX_TEXTOS_EN_EL_CASO,
        select: { text: true },
      })
    )
      .reverse()
      .map((m) => m.text);
    const caso = await this.prisma.supportTicket.create({
      data: {
        title: borrador.titulo ?? '',
        description: descripcionDelCaso({ borrador, textos }),
        reporterId: yo.userId,
        organizationId: yo.organizationId,
        channel: 'TELEGRAM',
        priority: borrador.prioridad,
        conversationId: yo.conversationId,
      },
      select: { number: true },
    });
    this.avisosAlGrupo?.pronto();
    return caso.number;
  }

  /** El caso de un aviso, si es de esta persona y de su clínica. */
  async casoDelAviso(
    yo: Interlocutor,
    numero: number,
  ): Promise<CasoDelAviso | null> {
    const c = await this.prisma.supportTicket.findFirst({
      where: {
        number: numero,
        reporterId: yo.userId,
        organizationId: yo.organizationId,
      },
      select: { number: true, title: true, status: true, resolutionNote: true },
    });
    return c
      ? {
          numero: c.number,
          titulo: c.title,
          estado: c.status,
          respuesta: c.resolutionNote,
        }
      : null;
  }

  /**
   * «No, sigue pasando» (§3.6, S12): un caso suyo, solucionado hace menos de 7
   * días, vuelve a «Abierto» con una nota de quien lo reportó y el grupo recibe
   * «Caso reabierto». Devuelve si lo reabrió.
   */
  async reabrir(
    yo: Interlocutor,
    numero: number,
    ahora: Date = new Date(),
  ): Promise<boolean> {
    const reabierto = await this.prisma.$transaction(async (tx) => {
      const caso = await tx.supportTicket.findFirst({
        where: {
          number: numero,
          reporterId: yo.userId,
          organizationId: yo.organizationId,
          status: 'RESOLVED',
          resolvedAt: {
            gte: new Date(
              ahora.getTime() - LIMITES_SOPORTE.reabrirDias * 86_400_000,
            ),
          },
        },
        select: { id: true },
      });
      if (!caso) return false;
      const r = await tx.supportTicket.updateMany({
        where: { id: caso.id, status: 'RESOLVED' },
        data: {
          status: 'OPEN',
          startedAt: null,
          resolvedAt: null,
          reopenedCount: { increment: 1 },
          // El grupo se entera como de un caso nuevo («🔁 Caso reabierto»).
          groupNotice: 'PENDING',
          groupNoticeAttempts: 0,
          groupNoticeError: null,
          groupNotifiedAt: null,
          unattendedRemindedAt: null,
          // Lo reabrió ella: no hay nada que avisarle.
          reporterNotifiedStatus: 'OPEN',
          reporterNotifiedAt: ahora,
        },
      });
      if (r.count !== 1) return false;
      await tx.supportTicketNote.create({
        data: {
          ticketId: caso.id,
          authorId: yo.userId,
          channel: 'TELEGRAM',
          kind: 'REAPERTURA',
          text: 'Respondió al aviso de resuelto que sigue pasando.',
        },
      });
      return true;
    });
    if (reabierto) this.avisosAlGrupo?.pronto();
    return reabierto;
  }

  /** Lo que escribió y todavía no tiene respuesta (sin los comandos). */
  async textosSinResponder(conversationId: string): Promise<string[]> {
    const mensajes = (
      await this.prisma.supportBotMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: LIMITES_SOPORTE.maxTurnosContexto,
        select: { direction: true, text: true },
      })
    ).reverse();
    const ultimaSalida = mensajes.map((m) => m.direction).lastIndexOf('SALIDA');
    return mensajes
      .slice(ultimaSalida + 1)
      .filter((m) => m.direction === 'ENTRADA' && !m.text.startsWith('/'))
      .map((m) => m.text);
  }

  /** ¿Le llegan por Telegram los avisos de sus casos? (Se apagan en Soporte.) */
  async recibeAvisos(userId: string): Promise<boolean> {
    const pref = await this.prisma.supportBotPreference.findUnique({
      where: { userId },
      select: { ticketNotices: true },
    });
    return pref?.ticketNotices ?? true;
  }

  /**
   * Agrega una nota a uno de SUS casos, si no está solucionado. Devuelve si la
   * agregó (el caso pudo haberse solucionado mientras tanto).
   */
  async agregarNota(
    yo: Interlocutor,
    numero: number,
    texto: string,
  ): Promise<boolean> {
    const caso = await this.prisma.supportTicket.findFirst({
      where: {
        number: numero,
        reporterId: yo.userId,
        organizationId: yo.organizationId,
        status: { not: 'RESOLVED' },
      },
      select: { id: true },
    });
    if (!caso) return false;
    await this.prisma.supportTicketNote.create({
      data: {
        ticketId: caso.id,
        authorId: yo.userId,
        channel: 'TELEGRAM',
        kind: 'AMPLIACION',
        text: texto,
      },
    });
    return true;
  }

  async leerFlujo(conversationId: string): Promise<FlujoConversacion> {
    const c = await this.prisma.supportBotConversation.findUnique({
      where: { id: conversationId },
      select: { flowState: true },
    });
    return c ? leerFlujo(c.flowState) : { ...FLUJO_VACIO };
  }

  async guardarFlujo(
    conversationId: string,
    flujo: FlujoConversacion,
  ): Promise<void> {
    const datos = guardarFlujo(flujo);
    await this.prisma.supportBotConversation.updateMany({
      where: { id: conversationId },
      data: {
        flowState: datos
          ? (datos as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
  }
}
