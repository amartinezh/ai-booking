import { Prisma } from '@agenia/database';
import { FLUJO_VACIO, type BorradorCaso } from '@agenia/shared';
import { SupportBotCasesService } from './support-bot-cases.service';
import type { Interlocutor } from './support-bot-session.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupportTicketGroupNotifier } from '../tech-alerts/support-ticket-group.notifier';

/**
 * Los casos desde el asistente. Lo que no puede fallar:
 *  🔒 la clínica y el autor salen de la conversación verificada, nunca de la IA;
 *  🔒 una nota solo va a un caso de la misma persona y que no esté solucionado.
 * (Contra Postgres real: support-bot-session.integration.spec.ts.)
 */
describe('SupportBotCasesService', () => {
  const ANA: Interlocutor = {
    conversationId: 'conv-1',
    userId: 'u-1',
    email: 'ana.perez@clinica.co',
    role: 'BOOKING_AGENT',
    organizationId: 'org-1',
    organizationName: 'Hospital de Prueba',
    isTest: false,
    chatId: '777',
    telegramName: 'Ana',
  };
  const AHORA = new Date('2026-10-19T15:00:00Z');
  const BORRADOR: BorradorCaso = {
    fase: 'CONFIRMANDO',
    titulo: 'No salen los recordatorios',
    descripcion: 'Desde las 7 no sale ningún recordatorio.',
    pantalla: '/dashboard/configuracion',
    falta: [],
    prioridad: 'HIGH',
    creadoEn: AHORA.toISOString(),
    venceEn: null,
  };

  let prisma: {
    supportTicket: Record<string, jest.Mock>;
    supportTicketNote: { create: jest.Mock };
    supportBotMessage: { findMany: jest.Mock };
    supportBotConversation: { findUnique: jest.Mock; updateMany: jest.Mock };
    supportBotPreference: { findUnique: jest.Mock };
    techAlert: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let pronto: jest.Mock;
  let svc: SupportBotCasesService;

  beforeEach(() => {
    prisma = {
      supportTicket: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id: 't-58' })),
        create: jest.fn(async () => ({ number: 59 })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      supportTicketNote: { create: jest.fn(async () => ({})) },
      supportBotMessage: { findMany: jest.fn(async () => []) },
      supportBotConversation: {
        findUnique: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      supportBotPreference: { findUnique: jest.fn(async () => null) },
      techAlert: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    pronto = jest.fn();
    svc = new SupportBotCasesService(
      prisma as unknown as PrismaService,
      {
        pronto,
      } as unknown as SupportTicketGroupNotifier,
    );
  });

  it('sus casos: de ella y de su clínica, abiertos o solucionados en el último mes', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([
      {
        number: 58,
        title: 'No salen',
        status: 'IN_PROGRESS',
        createdAt: AHORA,
        startedAt: AHORA,
        resolvedAt: null,
        resolutionNote: 'nota interna a medias',
      },
      {
        number: 51,
        title: 'Contraseña',
        status: 'RESOLVED',
        createdAt: AHORA,
        startedAt: AHORA,
        resolvedAt: AHORA,
        resolutionNote: 'Se restableció.',
      },
    ]);
    const casos = await svc.casosDe(ANA, AHORA);
    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reporterId: 'u-1',
          organizationId: 'org-1',
          OR: [
            { status: { in: ['OPEN', 'IN_PROGRESS'] } },
            { resolvedAt: { gte: new Date('2026-09-19T15:00:00Z') } },
          ],
        },
        take: 5,
      }),
    );
    // La respuesta del equipo solo se muestra cuando ya está solucionado.
    expect(casos.map((c) => [c.numero, c.estado, c.respuesta])).toEqual([
      [58, 'IN_PROGRESS', null],
      [51, 'RESOLVED', 'Se restableció.'],
    ]);
  });

  it('lo que el equipo ya sabe que falla: solo lo de su clínica o global, en frases fijas', async () => {
    prisma.techAlert.findMany.mockResolvedValue([
      {
        kind: 'SERVICIO_CAIDO',
        dedupeKey: 'servicio:meta',
        organizationId: null,
        firstSeenAt: AHORA,
      },
    ]);
    const r = await svc.incidentesPara('org-1', 'Gemini');
    expect(prisma.techAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ABIERTA',
          OR: [{ organizationId: 'org-1' }, { organizationId: null }],
        }),
      }),
    );
    expect(r).toEqual([
      { frase: expect.stringMatching(/^WhatsApp \(Meta\)/), desde: AHORA },
    ]);
  });

  it('🔒 abrir el caso: autor, clínica y conversación de la sesión; canal Telegram; lo que escribió tal cual', async () => {
    prisma.supportBotMessage.findMany.mockResolvedValue([
      { text: 'la de la cédula 1053789456 llamó' },
      { text: '/nuevo' },
    ]);
    await expect(svc.abrirCaso(ANA, BORRADOR)).resolves.toBe(59);
    expect(prisma.supportBotMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conv-1', direction: 'ENTRADA' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    expect(prisma.supportTicket.create).toHaveBeenCalledWith({
      data: {
        title: 'No salen los recordatorios',
        description: [
          'Desde las 7 no sale ningún recordatorio.',
          'Pantalla: /dashboard/configuracion',
          'Lo que escribió por Telegram:\n«la de la cédula 1053789456 llamó»',
        ].join('\n\n'),
        reporterId: 'u-1',
        organizationId: 'org-1',
        channel: 'TELEGRAM',
        priority: 'HIGH',
        conversationId: 'conv-1',
      },
      select: { number: true },
    });
  });

  it('al abrirlo, el aviso al grupo no espera al minuto', async () => {
    await svc.abrirCaso(ANA, BORRADOR);
    expect(pronto).toHaveBeenCalledTimes(1);
    // Sin el despachador (pruebas, o la API sin alertas), abre igual.
    await new SupportBotCasesService(
      prisma as unknown as PrismaService,
    ).abrirCaso(ANA, BORRADOR);
  });

  it('abrir sin título (no debería pasar) no lanza', async () => {
    await svc.abrirCaso(ANA, { ...BORRADOR, titulo: null });
    expect(prisma.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: '' }),
      }),
    );
  });

  it('🔒 la nota: solo a un caso suyo, de su clínica y sin solucionar', async () => {
    await expect(svc.agregarNota(ANA, 58, 'también el Dr. Ruiz')).resolves.toBe(
      true,
    );
    expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith({
      where: {
        number: 58,
        reporterId: 'u-1',
        organizationId: 'org-1',
        status: { not: 'RESOLVED' },
      },
      select: { id: true },
    });
    expect(prisma.supportTicketNote.create).toHaveBeenCalledWith({
      data: {
        ticketId: 't-58',
        authorId: 'u-1',
        channel: 'TELEGRAM',
        kind: 'AMPLIACION',
        text: 'también el Dr. Ruiz',
      },
    });
    prisma.supportTicket.findFirst.mockResolvedValue(null);
    await expect(svc.agregarNota(ANA, 99, 'x')).resolves.toBe(false);
    expect(prisma.supportTicketNote.create).toHaveBeenCalledTimes(1);
  });

  it('el flujo: sin conversación o sin nada guardado es el vacío', async () => {
    await expect(svc.leerFlujo('conv-1')).resolves.toEqual(FLUJO_VACIO);
    prisma.supportBotConversation.findUnique.mockResolvedValue({
      flowState: null,
    });
    await expect(svc.leerFlujo('conv-1')).resolves.toEqual(FLUJO_VACIO);
    prisma.supportBotConversation.findUnique.mockResolvedValue({
      flowState: { borrador: BORRADOR, notaPendiente: null, modoCaso: false },
    });
    await expect(svc.leerFlujo('conv-1')).resolves.toMatchObject({
      borrador: { titulo: 'No salen los recordatorios' },
    });
  });

  it('el flujo vacío se guarda como NULL; con algo, como JSON', async () => {
    await svc.guardarFlujo('conv-1', { ...FLUJO_VACIO });
    expect(prisma.supportBotConversation.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'conv-1' },
      data: { flowState: Prisma.DbNull },
    });
    await svc.guardarFlujo('conv-1', { ...FLUJO_VACIO, modoCaso: true });
    expect(prisma.supportBotConversation.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'conv-1' },
      data: { flowState: expect.objectContaining({ modoCaso: true }) },
    });
  });

  // ── Fase 4: el aviso de sus casos ─────────────────────────────────────────

  it('🔒 el caso de un aviso: solo si es suyo y de su clínica', async () => {
    prisma.supportTicket.findFirst.mockResolvedValue({
      number: 58,
      title: 'No salen',
      status: 'RESOLVED',
      resolutionNote: 'Se reinició.',
    });
    await expect(svc.casoDelAviso(ANA, 58)).resolves.toEqual({
      numero: 58,
      titulo: 'No salen',
      estado: 'RESOLVED',
      respuesta: 'Se reinició.',
    });
    expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { number: 58, reporterId: 'u-1', organizationId: 'org-1' },
      }),
    );
    prisma.supportTicket.findFirst.mockResolvedValue(null);
    await expect(svc.casoDelAviso(ANA, 99)).resolves.toBeNull();
  });

  describe('🔒 reabrir («No, sigue pasando»)', () => {
    it('solo un caso suyo, solucionado hace menos de 7 días: vuelve a abierto, con su nota, y el grupo se entera', async () => {
      await expect(svc.reabrir(ANA, 58, AHORA)).resolves.toBe(true);
      expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith({
        where: {
          number: 58,
          reporterId: 'u-1',
          organizationId: 'org-1',
          status: 'RESOLVED',
          resolvedAt: { gte: new Date('2026-10-12T15:00:00Z') },
        },
        select: { id: true },
      });
      expect(prisma.supportTicket.updateMany).toHaveBeenCalledWith({
        where: { id: 't-58', status: 'RESOLVED' },
        data: {
          status: 'OPEN',
          startedAt: null,
          resolvedAt: null,
          reopenedCount: { increment: 1 },
          groupNotice: 'PENDING',
          groupNoticeAttempts: 0,
          groupNoticeError: null,
          groupNotifiedAt: null,
          unattendedRemindedAt: null,
          reporterNotifiedStatus: 'OPEN',
          reporterNotifiedAt: AHORA,
        },
      });
      expect(prisma.supportTicketNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ticketId: 't-58',
          authorId: 'u-1',
          channel: 'TELEGRAM',
          kind: 'REAPERTURA',
        }),
      });
      expect(pronto).toHaveBeenCalledTimes(1);
    });

    it('si no es suyo, ya no está solucionado o pasaron 7 días: no hace nada', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      await expect(svc.reabrir(ANA, 58, AHORA)).resolves.toBe(false);
      expect(prisma.supportTicket.updateMany).not.toHaveBeenCalled();
      expect(pronto).not.toHaveBeenCalled();
    });

    it('🏁 si otro lo reabrió en el mismo instante, no deja una segunda nota', async () => {
      prisma.supportTicket.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.reabrir(ANA, 58)).resolves.toBe(false);
      expect(prisma.supportTicketNote.create).not.toHaveBeenCalled();
    });
  });

  it('lo que escribió sin respuesta todavía (sin comandos)', async () => {
    prisma.supportBotMessage.findMany.mockResolvedValue([
      { direction: 'ENTRADA', text: 'sigue igual' },
      { direction: 'ENTRADA', text: '/nuevo' },
      { direction: 'SALIDA', text: 'Listo, reabrí el caso #58.' },
      { direction: 'ENTRADA', text: 'hola' },
    ]);
    await expect(svc.textosSinResponder('conv-1')).resolves.toEqual([
      'sigue igual',
    ]);
    prisma.supportBotMessage.findMany.mockResolvedValue([]);
    await expect(svc.textosSinResponder('conv-1')).resolves.toEqual([]);
  });

  it('los avisos de sus casos: encendidos salvo que los apague', async () => {
    await expect(svc.recibeAvisos('u-1')).resolves.toBe(true);
    prisma.supportBotPreference.findUnique.mockResolvedValue({
      ticketNotices: false,
    });
    await expect(svc.recibeAvisos('u-1')).resolves.toBe(false);
  });
});
