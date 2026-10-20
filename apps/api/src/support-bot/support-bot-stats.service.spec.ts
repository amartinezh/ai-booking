import { NotFoundException } from '@nestjs/common';
import { DATO_OCULTO } from '@agenia/shared';
import { SupportBotStatsService } from './support-bot-stats.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { SystemLogService } from '../system-log/system-log.service';

/**
 * Lo que el super admin ve del asistente (docs/PLAN_BOT_SOPORTE.md §3.7, Fase 5):
 * cifras sin IA, lo que el manual no cubrió (con los datos ocultos) y las
 * conversaciones (abrir una queda en la bitácora). Las consultas contra Postgres
 * real están en support-bot-session.integration.spec.ts.
 */
describe('SupportBotStatsService', () => {
  // Martes 20 de octubre de 2026, 10:00 en Colombia.
  const AHORA = new Date('2026-10-20T15:00:00Z');
  let prisma: {
    supportBotConversation: { findMany: jest.Mock; findUnique: jest.Mock };
    supportBotMessage: {
      groupBy: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    supportTicket: { groupBy: jest.Mock };
  };
  let redis: { hgetall: jest.Mock };
  let bitacora: { event: jest.Mock };
  let svc: SupportBotStatsService;

  const conv = (id: string, cambios: Record<string, unknown> = {}) => ({
    id,
    userId: 'u-ana',
    organizationId: 'org-1',
    feedback: null,
    organization: { name: 'Hospital Uno' },
    _count: { tickets: 0 },
    ...cambios,
  });

  beforeEach(() => {
    prisma = {
      supportBotConversation: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
      },
      supportBotMessage: {
        groupBy: jest.fn(async () => []),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
      supportTicket: { groupBy: jest.fn(async () => []) },
    };
    redis = { hgetall: jest.fn(async () => ({})) };
    bitacora = { event: jest.fn(async () => undefined) };
    svc = new SupportBotStatsService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      bitacora as unknown as SystemLogService,
    );
  });

  describe('las cifras', () => {
    beforeEach(() => {
      prisma.supportBotConversation.findMany.mockResolvedValue([
        conv('c1', { feedback: 'UTIL' }),
        conv('c2', { userId: 'u-beto', _count: { tickets: 1 } }),
        conv('c3', { feedback: 'NO_UTIL' }),
        conv('c4', {
          userId: 'u-dora',
          organizationId: 'org-2',
          organization: { name: 'Clínica Dos' },
        }),
      ]);
      prisma.supportBotMessage.groupBy.mockResolvedValue([
        {
          conversationId: 'c1',
          source: 'IA',
          _count: { _all: 2 },
          _sum: { inputTokens: 60_000, outputTokens: 300 },
        },
        {
          conversationId: 'c2',
          source: 'IA',
          _count: { _all: 1 },
          _sum: { inputTokens: 30_000, outputTokens: 100 },
        },
        {
          conversationId: 'c2',
          source: 'SIN_IA',
          _count: { _all: 1 },
          _sum: { inputTokens: null, outputTokens: null },
        },
        {
          conversationId: 'c4',
          source: 'SIN_IA',
          _count: { _all: 3 },
          _sum: { inputTokens: null, outputTokens: null },
        },
        // Una conversación que empezó antes del periodo: cuenta en el total, no por clínica.
        {
          conversationId: 'vieja',
          source: 'IA',
          _count: { _all: 1 },
          _sum: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      prisma.supportBotMessage.findMany.mockResolvedValue(
        [1000, 2000, 3000, 9000].map((latencyMs) => ({ latencyMs })),
      );
      prisma.supportBotMessage.count.mockResolvedValue(2);
      prisma.supportTicket.groupBy.mockResolvedValue([
        { organizationId: 'org-1', _count: { _all: 1 } },
        { organizationId: 'org-9', _count: { _all: 4 } },
      ]);
      redis.hgetall
        .mockResolvedValueOnce({ codigos: '5', fallidos: '2' })
        .mockResolvedValueOnce({ codigos: '2', bloqueos: '1', sinCodigo: '7' });
    });

    it('el periodo y las consultas: desde la medianoche de Colombia, sin las de prueba', async () => {
      const r = await svc.cifras(7, AHORA);
      expect(r.periodo).toEqual({
        dias: 7,
        desde: '2026-10-14',
        hasta: AHORA.toISOString(),
      });
      const desde = new Date('2026-10-14T05:00:00Z');
      expect(prisma.supportBotConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isTest: false, startedAt: { gte: desde } },
        }),
      );
      expect(prisma.supportBotMessage.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            direction: 'SALIDA',
            createdAt: { gte: desde },
            conversation: { isTest: false },
          }),
        }),
      );
      expect(redis.hgetall).toHaveBeenCalledTimes(7);
      expect(redis.hgetall).toHaveBeenLastCalledWith(
        'soporte:cifras:2026-10-20',
      );
    });

    it('conversaciones, respuestas, resultado y códigos', async () => {
      const r = await svc.cifras(7, AHORA);
      expect(r.conversaciones).toEqual({ total: 4, personas: 3, clinicas: 2 });
      expect(r.respuestas).toEqual({
        total: 8,
        conIA: 4,
        sinIA: 4,
        sinCubrir: 2,
        tiempoMedioMs: 3750,
        tiempoP90Ms: 9000,
      });
      // c1, c2 y c4 tuvieron respuesta; c2 terminó en caso.
      expect(r.resultado).toEqual({
        conRespuesta: 3,
        sinCaso: 2,
        porcentajeSinCaso: 67,
        casosAbiertos: 5,
        utiles: 1,
        noUtiles: 1,
      });
      expect(r.codigo).toEqual({
        pedidos: 7,
        usados: 4,
        sinUsar: 3,
        fallidos: 2,
        bloqueos: 1,
        mensajesSinCodigo: 7,
      });
    });

    it('por clínica, la que más conversa primero, con sus tokens y casos', async () => {
      const r = await svc.cifras(7, AHORA);
      expect(r.porClinica).toEqual([
        {
          organizationId: 'org-1',
          nombre: 'Hospital Uno',
          conversaciones: 3,
          personas: 2,
          respuestasIA: 3,
          respuestasSinIA: 1,
          tokensEntrada: 90_000,
          tokensSalida: 400,
          casos: 1,
        },
        {
          organizationId: 'org-2',
          nombre: 'Clínica Dos',
          conversaciones: 1,
          personas: 1,
          respuestasIA: 0,
          respuestasSinIA: 3,
          tokensEntrada: 0,
          tokensSalida: 0,
          casos: 0,
        },
      ]);
    });

    it('sin Redis, los códigos van en cero (lo demás sale igual)', async () => {
      redis.hgetall.mockReset().mockRejectedValue(new Error('caído'));
      const r = await svc.cifras(30, AHORA);
      expect(r.codigo).toMatchObject({ pedidos: 0, sinUsar: 0, fallidos: 0 });
      expect(r.conversaciones.total).toBe(4);
    });

    it('sin nada en el periodo, todo en cero y sin porcentajes', async () => {
      prisma.supportBotConversation.findMany.mockResolvedValue([]);
      prisma.supportBotMessage.groupBy.mockResolvedValue([]);
      prisma.supportBotMessage.findMany.mockResolvedValue([]);
      prisma.supportTicket.groupBy.mockResolvedValue([]);
      const r = await svc.cifras(7, AHORA);
      expect(r.resultado.porcentajeSinCaso).toBeNull();
      expect(r.respuestas.tiempoMedioMs).toBeNull();
      expect(r.porClinica).toEqual([]);
    });
  });

  describe('lo que el manual no cubrió', () => {
    it('la pregunta de cada respuesta sin cubrir, con los datos ocultos', async () => {
      prisma.supportBotMessage.findMany
        .mockResolvedValueOnce([
          {
            id: 's1',
            createdAt: new Date('2026-10-20T14:00:00Z'),
            conversationId: 'c1',
            conversation: {
              organization: { name: 'Hospital Uno' },
              user: { role: 'BOOKING_AGENT' },
            },
          },
          // Sin pregunta antes (solo un comando): no se lista.
          {
            id: 's9',
            createdAt: new Date('2026-10-20T13:00:00Z'),
            conversationId: 'c1',
            conversation: {
              organization: { name: 'Hospital Uno' },
              user: { role: 'BOOKING_AGENT' },
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'e0',
            conversationId: 'c1',
            direction: 'ENTRADA',
            text: '/nuevo',
            uncovered: false,
          },
          {
            id: 's9',
            conversationId: 'c1',
            direction: 'SALIDA',
            text: 'Cuéntame',
            uncovered: true,
          },
          {
            id: 'e1',
            conversationId: 'c1',
            direction: 'ENTRADA',
            text: '¿exporto a Excel lo de la paciente 1053789456?',
            uncovered: false,
          },
          {
            id: 's1',
            conversationId: 'c1',
            direction: 'SALIDA',
            text: 'No lo tengo',
            uncovered: true,
          },
        ]);
      const r = await svc.preguntasSinCubrir(30, AHORA);
      expect(r).toEqual([
        {
          fecha: '2026-10-20T14:00:00.000Z',
          conversationId: 'c1',
          clinica: 'Hospital Uno',
          rol: 'BOOKING_AGENT',
          pregunta: `¿exporto a Excel lo de la paciente ${DATO_OCULTO}?`,
        },
      ]);
      expect(prisma.supportBotMessage.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' } }),
      );
    });

    it('sin respuestas sin cubrir, ni siquiera busca los mensajes', async () => {
      await expect(svc.preguntasSinCubrir(7, AHORA)).resolves.toEqual([]);
      expect(prisma.supportBotMessage.findMany).toHaveBeenCalledTimes(1);
    });
  });

  const filaDeLaBase = (id: string, cambios: Record<string, unknown> = {}) => ({
    id,
    startedAt: new Date('2026-10-20T14:00:00Z'),
    lastMessageAt: new Date('2026-10-20T14:10:00Z'),
    closedAt: null,
    closeReason: null,
    isTest: false,
    feedback: 'UTIL',
    hadUncoveredQuestion: false,
    organization: { name: 'Hospital Uno' },
    user: { email: 'ana@clinica.co', role: 'BOOKING_AGENT' },
    tickets: [{ number: 58 }],
    _count: { messages: 6 },
    ...cambios,
  });

  describe('las conversaciones', () => {
    it('de a 50, con el cursor para la siguiente página', async () => {
      prisma.supportBotConversation.findMany.mockResolvedValue(
        Array.from({ length: 51 }, (_, i) => filaDeLaBase(`c${i}`)),
      );
      const r = await svc.conversaciones(
        { dias: 7, tipo: 'TODAS', organizationId: null, cursor: null },
        AHORA,
      );
      expect(r.filas).toHaveLength(50);
      expect(r.siguiente).toBe('c49');
      expect(r.filas[0]).toEqual({
        id: 'c0',
        inicio: '2026-10-20T14:00:00.000Z',
        ultimoMensaje: '2026-10-20T14:10:00.000Z',
        cierre: null,
        motivoCierre: null,
        clinica: 'Hospital Uno',
        correo: 'ana@clinica.co',
        rol: 'BOOKING_AGENT',
        prueba: false,
        mensajes: 6,
        feedback: 'UTIL',
        sinCubrir: false,
        casos: [58],
      });
    });

    it.each([
      ['CON_CASO', { tickets: { some: {} } }],
      ['SIN_CUBRIR', { hadUncoveredQuestion: true }],
      ['NO_UTIL', { feedback: 'NO_UTIL' }],
    ] as const)('el filtro %s, la clínica y el cursor', async (tipo, where) => {
      await svc.conversaciones(
        { dias: 30, tipo, organizationId: 'org-1', cursor: 'c49' },
        AHORA,
      );
      expect(prisma.supportBotConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            startedAt: { gte: new Date('2026-09-21T05:00:00Z') },
            organizationId: 'org-1',
            ...where,
          },
          cursor: { id: 'c49' },
          skip: 1,
          take: 51,
        }),
      );
    });

    it('la última página no tiene siguiente', async () => {
      prisma.supportBotConversation.findMany.mockResolvedValue([
        filaDeLaBase('c1'),
      ]);
      const r = await svc.conversaciones({ dias: 7, tipo: 'TODAS' }, AHORA);
      expect(r.siguiente).toBeNull();
    });
  });

  describe('una conversación', () => {
    it('completa, tal cual, y abrirla queda en la bitácora', async () => {
      prisma.supportBotConversation.findUnique.mockResolvedValue({
        ...filaDeLaBase('c1', {
          closedAt: new Date('2026-10-20T14:40:00Z'),
          closeReason: 'INACTIVIDAD',
        }),
        organizationId: 'org-1',
        telegramName: 'Ana',
        tickets: [{ number: 58, title: 'No salen', status: 'OPEN' }],
        messages: [
          {
            id: 'm1',
            createdAt: new Date('2026-10-20T14:00:00Z'),
            direction: 'ENTRADA',
            text: 'la paciente 1053789456 no recibe',
            source: null,
            aiKind: null,
            topics: [],
            uncovered: false,
            aiProvider: null,
            inputTokens: null,
            outputTokens: null,
            latencyMs: null,
          },
          {
            id: 'm2',
            createdAt: new Date('2026-10-20T14:00:05Z'),
            direction: 'SALIDA',
            text: 'Revisa…',
            source: 'IA',
            aiKind: 'respuesta',
            topics: ['recordatorios'],
            uncovered: false,
            aiProvider: 'GEMINI',
            inputTokens: 30_000,
            outputTokens: 90,
            latencyMs: 2100,
          },
        ],
      });
      const r = await svc.conversacion('c1', {
        userId: 'sa-1',
        email: 'sa@agenia.co',
      });
      expect(r).toMatchObject({
        id: 'c1',
        cierre: '2026-10-20T14:40:00.000Z',
        motivoCierre: 'INACTIVIDAD',
        telegramName: 'Ana',
        casos: [58],
        casosDetalle: [{ numero: 58, titulo: 'No salen', estado: 'OPEN' }],
      });
      // Para el equipo: lo que escribió tal cual.
      expect(r.mensajesDetalle[0].texto).toContain('1053789456');
      expect(r.mensajesDetalle[1]).toEqual({
        id: 'm2',
        fecha: '2026-10-20T14:00:05.000Z',
        direccion: 'SALIDA',
        texto: 'Revisa…',
        fuente: 'IA',
        tipo: 'respuesta',
        temas: ['recordatorios'],
        sinCubrir: false,
        proveedor: 'GEMINI',
        tokensEntrada: 30_000,
        tokensSalida: 90,
        latenciaMs: 2100,
      });
      expect(bitacora.event).toHaveBeenCalledWith({
        action: 'SUPPORT_BOT_CONVERSATION_VIEWED',
        message:
          'sa@agenia.co abrió una conversación del asistente de soporte (Hospital Uno).',
        userId: 'sa-1',
        organizationId: 'org-1',
        metadata: { conversationId: 'c1' },
      });
    });

    it('si no existe (o la borró la retención), 404', async () => {
      await expect(
        svc.conversacion('x', { userId: 'sa-1', email: 'sa@agenia.co' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(bitacora.event).not.toHaveBeenCalled();
    });
  });
});
