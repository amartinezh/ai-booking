import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@agenia/database';
import {
  VIGILANCIA_SOPORTE,
  claveCifrasDelDia,
  diasDelPeriodo,
  inicioDelPeriodo,
  percentil,
  porcentaje,
  preguntasSinCubrir,
  promedio,
  sumarContadores,
  type CifrasAsistente,
  type DetalleConversacion,
  type FilaConversacion,
  type FiltroConversaciones,
  type PeriodoCifras,
  type PreguntaSinCubrir,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SystemLogService } from '../system-log/system-log.service';

/** Lo que basta de una conversación para su fila en la lista. */
const FILA = {
  id: true,
  startedAt: true,
  lastMessageAt: true,
  closedAt: true,
  closeReason: true,
  isTest: true,
  feedback: true,
  hadUncoveredQuestion: true,
  organization: { select: { name: true } },
  user: { select: { email: true, role: true } },
  tickets: { select: { number: true }, orderBy: { number: 'asc' } },
  _count: { select: { messages: true } },
} as const;

type FilaDeLaBase = {
  id: string;
  startedAt: Date;
  lastMessageAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  isTest: boolean;
  feedback: string | null;
  hadUncoveredQuestion: boolean;
  organization: { name: string };
  user: { email: string; role: string };
  tickets: Array<{ number: number }>;
  _count: { messages: number };
};

/**
 * Lo que el super admin ve del asistente de soporte en `/super-admin/soporte-bot`
 * (docs/PLAN_BOT_SOPORTE.md §3.7, Fase 5): las cifras, lo que el manual no
 * cubrió y las conversaciones. Todo con datos de la base y de Redis, sin IA.
 *
 *  · Las cifras no cuentan las conversaciones de prueba del super admin.
 *  · La lista de preguntas sin cubrir va con los datos ocultos (sirve para mejorar
 *    el manual). La conversación completa sí trae lo que escribió la persona tal
 *    cual, y abrirla queda en la bitácora del sistema.
 */
@Injectable()
export class SupportBotStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly bitacora?: SystemLogService,
  ) {}

  async cifras(
    dias: PeriodoCifras,
    ahora: Date = new Date(),
  ): Promise<CifrasAsistente> {
    const desde = inicioDelPeriodo(ahora, dias);
    const deVerdad = { isTest: false };

    const [
      conversaciones,
      respuestas,
      latencias,
      sinCubrir,
      casos,
      contadores,
    ] = await Promise.all([
      this.prisma.supportBotConversation.findMany({
        where: { ...deVerdad, startedAt: { gte: desde } },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          feedback: true,
          organization: { select: { name: true } },
          _count: { select: { tickets: true } },
        },
      }),
      this.prisma.supportBotMessage.groupBy({
        by: ['conversationId', 'source'],
        where: {
          direction: 'SALIDA',
          source: { in: ['IA', 'SIN_IA'] },
          createdAt: { gte: desde },
          conversation: deVerdad,
        },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.supportBotMessage.findMany({
        where: {
          direction: 'SALIDA',
          source: 'IA',
          latencyMs: { not: null },
          createdAt: { gte: desde },
          conversation: deVerdad,
        },
        select: { latencyMs: true },
      }),
      this.prisma.supportBotMessage.count({
        where: {
          direction: 'SALIDA',
          uncovered: true,
          createdAt: { gte: desde },
          conversation: deVerdad,
        },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['organizationId'],
        where: { channel: 'TELEGRAM', createdAt: { gte: desde } },
        _count: { _all: true },
      }),
      this.contadores(ahora, dias),
    ]);

    // Las respuestas, por conversación y por clínica.
    const clinicaDe = new Map(
      conversaciones.map((c) => [c.id, c.organizationId]),
    );
    const conRespuesta = new Set<string>();
    const porClinica = new Map<string, CifrasAsistente['porClinica'][number]>();
    const fila = (id: string, nombre: string) => {
      let f = porClinica.get(id);
      if (!f) {
        f = {
          organizationId: id,
          nombre,
          conversaciones: 0,
          personas: 0,
          respuestasIA: 0,
          respuestasSinIA: 0,
          tokensEntrada: 0,
          tokensSalida: 0,
          casos: 0,
        };
        porClinica.set(id, f);
      }
      return f;
    };
    const personasPorClinica = new Map<string, Set<string>>();
    for (const c of conversaciones) {
      const f = fila(c.organizationId, c.organization.name);
      f.conversaciones++;
      const p = personasPorClinica.get(c.organizationId) ?? new Set<string>();
      p.add(c.userId);
      personasPorClinica.set(c.organizationId, p);
    }
    for (const [id, p] of personasPorClinica) fila(id, '').personas = p.size;

    let conIA = 0;
    let sinIA = 0;
    for (const r of respuestas) {
      const n = r._count._all;
      if (r.source === 'IA') conIA += n;
      else sinIA += n;
      conRespuesta.add(r.conversationId);
      const org = clinicaDe.get(r.conversationId);
      if (!org) continue; // una conversación que empezó antes del periodo
      const f = fila(org, '');
      if (r.source === 'IA') f.respuestasIA += n;
      else f.respuestasSinIA += n;
      f.tokensEntrada += r._sum.inputTokens ?? 0;
      f.tokensSalida += r._sum.outputTokens ?? 0;
    }
    let casosAbiertos = 0;
    for (const c of casos) {
      casosAbiertos += c._count._all;
      const f = porClinica.get(c.organizationId);
      if (f) f.casos += c._count._all;
    }

    const respondidas = conversaciones.filter((c) => conRespuesta.has(c.id));
    const sinCaso = respondidas.filter((c) => c._count.tickets === 0).length;
    const tiempos = latencias.map((l) => l.latencyMs as number);
    const usados = conversaciones.length;

    const [primerDia] = diasDelPeriodo(ahora, dias);
    return {
      periodo: { dias, desde: primerDia, hasta: ahora.toISOString() },
      conversaciones: {
        total: conversaciones.length,
        personas: new Set(conversaciones.map((c) => c.userId)).size,
        clinicas: personasPorClinica.size,
      },
      respuestas: {
        total: conIA + sinIA,
        conIA,
        sinIA,
        sinCubrir,
        tiempoMedioMs: promedio(tiempos),
        tiempoP90Ms: percentil(tiempos, 90),
      },
      resultado: {
        conRespuesta: respondidas.length,
        sinCaso,
        porcentajeSinCaso: porcentaje(sinCaso, respondidas.length),
        casosAbiertos,
        utiles: conversaciones.filter((c) => c.feedback === 'UTIL').length,
        noUtiles: conversaciones.filter((c) => c.feedback === 'NO_UTIL').length,
      },
      codigo: {
        pedidos: contadores.codigos,
        usados,
        sinUsar: Math.max(0, contadores.codigos - usados),
        fallidos: contadores.fallidos,
        bloqueos: contadores.bloqueos,
        mensajesSinCodigo: contadores.sinCodigo,
      },
      porClinica: [...porClinica.values()]
        .filter((f) => f.nombre)
        .sort((a, b) => b.conversaciones - a.conversaciones),
    };
  }

  /** Lo que el manual no cubrió, lo más reciente primero, con los datos ocultos. */
  async preguntasSinCubrir(
    dias: PeriodoCifras,
    ahora: Date = new Date(),
  ): Promise<PreguntaSinCubrir[]> {
    const respuestas = await this.prisma.supportBotMessage.findMany({
      where: {
        direction: 'SALIDA',
        uncovered: true,
        createdAt: { gte: inicioDelPeriodo(ahora, dias) },
        conversation: { isTest: false },
      },
      orderBy: { createdAt: 'desc' },
      take: VIGILANCIA_SOPORTE.maxPreguntasSinCubrir,
      select: {
        id: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: {
            organization: { select: { name: true } },
            user: { select: { role: true } },
          },
        },
      },
    });
    if (respuestas.length === 0) return [];

    const mensajes = await this.prisma.supportBotMessage.findMany({
      where: {
        conversationId: {
          in: [...new Set(respuestas.map((r) => r.conversationId))],
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        conversationId: true,
        direction: true,
        text: true,
        uncovered: true,
      },
    });
    const porConversacion = new Map<string, typeof mensajes>();
    for (const m of mensajes) {
      const lista = porConversacion.get(m.conversationId) ?? [];
      lista.push(m);
      porConversacion.set(m.conversationId, lista);
    }
    const pregunta = new Map<string, string>();
    for (const lista of porConversacion.values()) {
      for (const p of preguntasSinCubrir(lista)) {
        pregunta.set(p.respuestaId, p.pregunta);
      }
    }
    return respuestas
      .filter((r) => pregunta.has(r.id))
      .map((r) => ({
        fecha: r.createdAt.toISOString(),
        conversationId: r.conversationId,
        clinica: r.conversation.organization.name,
        rol: r.conversation.user.role,
        pregunta: pregunta.get(r.id) as string,
      }));
  }

  /** Las conversaciones del periodo, las más recientes primero, de a 50. */
  async conversaciones(
    filtro: {
      dias: PeriodoCifras;
      organizationId?: string | null;
      tipo: FiltroConversaciones;
      cursor?: string | null;
    },
    ahora: Date = new Date(),
  ): Promise<{ filas: FilaConversacion[]; siguiente: string | null }> {
    const where: Prisma.SupportBotConversationWhereInput = {
      startedAt: { gte: inicioDelPeriodo(ahora, filtro.dias) },
      ...(filtro.organizationId
        ? { organizationId: filtro.organizationId }
        : {}),
      ...(filtro.tipo === 'CON_CASO' ? { tickets: { some: {} } } : {}),
      ...(filtro.tipo === 'SIN_CUBRIR' ? { hadUncoveredQuestion: true } : {}),
      ...(filtro.tipo === 'NO_UTIL' ? { feedback: 'NO_UTIL' } : {}),
    };
    const porPagina = VIGILANCIA_SOPORTE.conversacionesPorPagina;
    const filas = (await this.prisma.supportBotConversation.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: porPagina + 1,
      ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
      select: FILA,
    })) as FilaDeLaBase[];
    const hayMas = filas.length > porPagina;
    const pagina = hayMas ? filas.slice(0, porPagina) : filas;
    return {
      filas: pagina.map(aFila),
      siguiente: hayMas ? pagina[pagina.length - 1].id : null,
    };
  }

  /**
   * Una conversación completa, con lo que escribió la persona tal cual (puede
   * nombrar datos de pacientes). Abrirla queda en la bitácora del sistema.
   */
  async conversacion(
    id: string,
    quien: { userId: string; email: string },
  ): Promise<DetalleConversacion> {
    const c = await this.prisma.supportBotConversation.findUnique({
      where: { id },
      select: {
        ...FILA,
        organizationId: true,
        telegramName: true,
        tickets: {
          select: { number: true, title: true, status: true },
          orderBy: { number: 'asc' },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            direction: true,
            text: true,
            source: true,
            aiKind: true,
            topics: true,
            uncovered: true,
            aiProvider: true,
            inputTokens: true,
            outputTokens: true,
            latencyMs: true,
          },
        },
      },
    });
    if (!c)
      throw new NotFoundException('La conversación no existe o ya se borró.');

    await this.bitacora?.event({
      action: 'SUPPORT_BOT_CONVERSATION_VIEWED',
      message: `${quien.email} abrió una conversación del asistente de soporte (${c.organization.name}).`,
      userId: quien.userId,
      organizationId: c.organizationId,
      metadata: { conversationId: c.id },
    });

    return {
      ...aFila(c as unknown as FilaDeLaBase),
      telegramName: c.telegramName,
      casosDetalle: c.tickets.map((t) => ({
        numero: t.number,
        titulo: t.title,
        estado: t.status,
      })),
      mensajesDetalle: c.messages.map((m) => ({
        id: m.id,
        fecha: m.createdAt.toISOString(),
        direccion: m.direction as 'ENTRADA' | 'SALIDA',
        texto: m.text,
        fuente: m.source,
        tipo: m.aiKind,
        temas: m.topics,
        sinCubrir: m.uncovered,
        proveedor: m.aiProvider,
        tokensEntrada: m.inputTokens,
        tokensSalida: m.outputTokens,
        latenciaMs: m.latencyMs,
      })),
    };
  }

  /** Los contadores de Redis del periodo. Sin Redis, en cero. */
  private async contadores(ahora: Date, dias: PeriodoCifras) {
    try {
      const porDia = await Promise.all(
        diasDelPeriodo(ahora, dias).map((d) =>
          this.redis.hgetall(claveCifrasDelDia(d)),
        ),
      );
      return sumarContadores(porDia);
    } catch {
      return sumarContadores([]);
    }
  }
}

function aFila(c: FilaDeLaBase): FilaConversacion {
  return {
    id: c.id,
    inicio: c.startedAt.toISOString(),
    ultimoMensaje: c.lastMessageAt.toISOString(),
    cierre: c.closedAt ? c.closedAt.toISOString() : null,
    motivoCierre: c.closeReason,
    clinica: c.organization.name,
    correo: c.user.email,
    rol: c.user.role,
    prueba: c.isTest,
    mensajes: c._count.messages,
    feedback: c.feedback,
    sinCubrir: c.hadUncoveredQuestion,
    casos: c.tickets.map((t) => t.number),
  };
}
