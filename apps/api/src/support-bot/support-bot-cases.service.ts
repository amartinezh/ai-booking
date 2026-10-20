import { Injectable } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  FLUJO_VACIO,
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

/**
 * Los casos de Soporte desde el asistente (docs/PLAN_BOT_SOPORTE.md §3.4, Fase 3):
 * los de la persona, lo que el equipo técnico ya sabe que falla, abrir el caso,
 * agregarle una nota y el flujo de la conversación (el borrador).
 *
 * La clínica y el autor del caso salen SIEMPRE de la conversación verificada
 * (`Interlocutor`), nunca de la IA. Una nota solo va a un caso de la misma persona.
 */
@Injectable()
export class SupportBotCasesService {
  constructor(private readonly prisma: PrismaService) {}

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
    return caso.number;
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
