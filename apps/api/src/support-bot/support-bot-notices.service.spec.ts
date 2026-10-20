import { Logger } from '@nestjs/common';
import { TEXTOS_SOPORTE } from '@agenia/shared';
import { SupportBotNoticesService } from './support-bot-notices.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupportBotConfigService } from './support-bot-config.service';
import type {
  EstadoConversacion,
  Interlocutor,
  SupportBotSessionService,
} from './support-bot-session.service';
import type { SupportBotService } from './support-bot.service';

/**
 * «Se apersona» (docs/PLAN_BOT_SOPORTE.md §3.6): quien reportó un caso se entera por
 * Telegram de que lo tomaron y de que quedó resuelto. Lo que no puede fallar:
 *  🔒 sin su conversación abierta, el «resuelto» va sin la respuesta del equipo;
 *  · un aviso por cambio, aunque corran dos réplicas;
 *  · con los avisos apagados, sin conversaciones o sin acceso, nada sale.
 */
const AHORA = new Date('2026-10-19T15:00:00Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

const ANA: Interlocutor = {
  conversationId: 'conv-1',
  userId: 'u-ana',
  email: 'ana@clinica.co',
  role: 'BOOKING_AGENT',
  organizationId: 'org-1',
  organizationName: 'Hospital de Prueba',
  isTest: false,
  chatId: '777',
  telegramName: 'Ana',
};

type Caso = Record<string, unknown> & { id: string };

describe('SupportBotNoticesService', () => {
  let casos: Caso[];
  let pref: { ticketNotices: boolean } | null;
  let ultima: { chatId: string; telegramUserId: string } | null;
  let usuario: {
    role: string;
    organization: { isActive: boolean } | null;
  } | null;
  let estado: EstadoConversacion;
  let enviarAviso: jest.Mock;
  let runtime: jest.Mock;
  let svc: SupportBotNoticesService;
  let prisma: {
    supportTicket: { findMany: jest.Mock; updateMany: jest.Mock };
    supportBotPreference: { findUnique: jest.Mock };
    supportBotConversation: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock };
  };

  const caso = (cambios: Record<string, unknown> = {}): Caso => ({
    id: 'c-58',
    number: 58,
    title: 'No salen los recordatorios',
    status: 'IN_PROGRESS',
    startedAt: hace(1),
    resolvedAt: null,
    resolutionNote: null,
    reporterId: 'u-ana',
    reporterNotifiedStatus: null,
    reporterNotifiedAt: null,
    ...cambios,
  });
  const igual = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date
      ? a.getTime() === b.getTime()
      : (a ?? null) === (b ?? null);

  beforeEach(() => {
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    casos = [];
    pref = null;
    ultima = { chatId: '777', telegramUserId: '777' };
    usuario = { role: 'BOOKING_AGENT', organization: { isActive: true } };
    estado = { tipo: 'NINGUNA' };
    prisma = {
      supportTicket: {
        findMany: jest.fn(async () =>
          casos
            .filter(
              (c) =>
                (c.status === 'IN_PROGRESS' || c.status === 'RESOLVED') &&
                c.reporterNotifiedStatus !== c.status,
            )
            .map((c) => ({ ...c })),
        ),
        // El compare-and-set de verdad: solo cambia la fila que sigue igual.
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            const filas = casos.filter((c) =>
              Object.entries(where).every(([k, v]) => igual(c[k], v)),
            );
            for (const c of filas) Object.assign(c, data);
            return { count: filas.length };
          },
        ),
      },
      supportBotPreference: { findUnique: jest.fn(async () => pref) },
      supportBotConversation: { findFirst: jest.fn(async () => ultima) },
      user: { findUnique: jest.fn(async () => usuario) },
    };
    enviarAviso = jest.fn(async () => ({ ok: true, messageId: '9' }));
    runtime = jest.fn(async () => ({
      enabled: true,
      token: 'T',
      piloto: { activo: false, usuarios: [] as string[] },
    }));
    svc = new SupportBotNoticesService(
      prisma as unknown as PrismaService,
      { runtime } as unknown as SupportBotConfigService,
      {
        conversacionDe: jest.fn(async () => estado),
      } as unknown as SupportBotSessionService,
      { enviarAviso } as unknown as SupportBotService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('con el asistente apagado no mira nada', async () => {
    runtime.mockResolvedValue({ enabled: false });
    casos = [caso()];
    await svc.vuelta(AHORA);
    expect(prisma.supportTicket.findMany).not.toHaveBeenCalled();
    runtime.mockResolvedValue(null);
    await svc.vuelta(AHORA);
    expect(prisma.supportTicket.findMany).not.toHaveBeenCalled();
  });

  it('«lo tomaron»: a la cuenta de su última conversación, una sola vez', async () => {
    casos = [caso()];
    await expect(svc.vuelta(AHORA)).resolves.toEqual({
      avisados: 1,
      sinAviso: 0,
      fallidos: 0,
    });
    expect(enviarAviso).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'T' }),
      { chatId: '777', yo: null },
      TEXTOS_SOPORTE.avisoTomado({
        numero: 58,
        titulo: 'No salen los recordatorios',
      }),
      null,
    );
    expect(casos[0]).toMatchObject({
      reporterNotifiedStatus: 'IN_PROGRESS',
      reporterNotifiedAt: AHORA,
    });
    await svc.vuelta(AHORA);
    expect(enviarAviso).toHaveBeenCalledTimes(1);
  });

  it('las conversaciones de prueba del super admin no son destino', async () => {
    casos = [caso()];
    await svc.vuelta(AHORA);
    expect(prisma.supportBotConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-ana', isTest: false },
        orderBy: { startedAt: 'desc' },
      }),
    );
  });

  describe('«quedó resuelto, ¿quedó bien?»', () => {
    const resuelto = () =>
      caso({
        status: 'RESOLVED',
        resolvedAt: hace(2),
        resolutionNote: 'Se reinició el envío.',
        reporterNotifiedStatus: 'IN_PROGRESS',
      });

    it('🔒 sin conversación abierta: sin la respuesta y con «Ver la respuesta»', async () => {
      casos = [resuelto()];
      await svc.vuelta(AHORA);
      expect(enviarAviso).toHaveBeenCalledWith(
        expect.anything(),
        { chatId: '777', yo: null },
        TEXTOS_SOPORTE.avisoResuelto({
          numero: 58,
          titulo: 'No salen los recordatorios',
          respuesta: null,
        }),
        { caso: 58, conVer: true },
      );
    });

    it('con su conversación abierta: con la respuesta, y queda en la conversación', async () => {
      estado = { tipo: 'VIGENTE', interlocutor: ANA };
      casos = [resuelto()];
      await svc.vuelta(AHORA);
      expect(enviarAviso).toHaveBeenCalledWith(
        expect.anything(),
        { chatId: '777', yo: ANA },
        expect.stringContaining('Respuesta del equipo: Se reinició el envío.'),
        { caso: 58, conVer: false },
      );
    });

    it('🔒 si en esa cuenta conversa otra persona, va como sin conversación', async () => {
      estado = {
        tipo: 'VIGENTE',
        interlocutor: { ...ANA, userId: 'u-beto' },
      };
      casos = [resuelto()];
      await svc.vuelta(AHORA);
      expect(enviarAviso).toHaveBeenCalledWith(
        expect.anything(),
        { chatId: '777', yo: null },
        expect.not.stringContaining('Se reinició'),
        { caso: 58, conVer: true },
      );
    });

    it('de abierto a resuelto sin pasar por «en atención»: solo el «resuelto»', async () => {
      casos = [{ ...resuelto(), reporterNotifiedStatus: null }];
      await svc.vuelta(AHORA);
      expect(enviarAviso).toHaveBeenCalledTimes(1);
      expect(enviarAviso.mock.calls[0][2]).toMatch(/quedó resuelto/);
    });
  });

  it.each([
    ['apagó los avisos', () => (pref = { ticketNotices: false })],
    ['nunca conversó con el asistente', () => (ultima = null)],
    ['ya no existe', () => (usuario = null)],
    [
      'es paciente',
      () => (usuario = { role: 'PATIENT', organization: { isActive: true } }),
    ],
    [
      'su clínica está suspendida',
      () =>
        (usuario = {
          role: 'BOOKING_AGENT',
          organization: { isActive: false },
        }),
    ],
  ])('si %s, no sale nada (y se da por avisado)', async (_, preparar) => {
    preparar();
    casos = [caso()];
    await expect(svc.vuelta(AHORA)).resolves.toMatchObject({ sinAviso: 1 });
    expect(enviarAviso).not.toHaveBeenCalled();
    expect(casos[0].reporterNotifiedStatus).toBe('IN_PROGRESS');
  });

  it('🧪 durante el piloto, a quien no está en él no le llega nada', async () => {
    runtime.mockResolvedValue({
      enabled: true,
      token: 'T',
      piloto: { activo: true, usuarios: ['otra'] },
    });
    casos = [caso()];
    await expect(svc.vuelta(AHORA)).resolves.toMatchObject({ sinAviso: 1 });
    expect(enviarAviso).not.toHaveBeenCalled();
    runtime.mockResolvedValue({
      enabled: true,
      token: 'T',
      piloto: { activo: true, usuarios: ['u-ana'] },
    });
    casos = [caso({ id: 'c-2' })];
    await svc.vuelta(AHORA);
    expect(enviarAviso).toHaveBeenCalledTimes(1);
  });

  it('un cambio de hace más de 24 h no se avisa (el asistente estuvo apagado)', async () => {
    casos = [
      caso({ startedAt: hace(25 * 60) }),
      caso({ id: 'c-2', startedAt: null }),
    ];
    await expect(svc.vuelta(AHORA)).resolves.toMatchObject({ sinAviso: 2 });
    expect(enviarAviso).not.toHaveBeenCalled();
    expect(prisma.supportBotPreference.findUnique).not.toHaveBeenCalled();
  });

  it('si Telegram falla por algo pasajero, se devuelve y se reintenta', async () => {
    enviarAviso.mockResolvedValueOnce({ ok: false, reintentar: true });
    casos = [caso()];
    await expect(svc.vuelta(AHORA)).resolves.toMatchObject({ fallidos: 1 });
    expect(casos[0].reporterNotifiedStatus).toBeNull();
    await svc.vuelta(AHORA);
    expect(enviarAviso).toHaveBeenCalledTimes(2);
    expect(casos[0].reporterNotifiedStatus).toBe('IN_PROGRESS');
  });

  it('si lo bloqueó (no vale la pena reintentar), queda dado por avisado', async () => {
    enviarAviso.mockResolvedValueOnce({ ok: false, reintentar: false });
    casos = [caso()];
    await svc.vuelta(AHORA);
    expect(casos[0].reporterNotifiedStatus).toBe('IN_PROGRESS');
    await svc.vuelta(AHORA);
    expect(enviarAviso).toHaveBeenCalledTimes(1);
  });

  it('🏁 si otra réplica ya lo reclamó, no lo avisa', async () => {
    casos = [caso()];
    prisma.supportTicket.updateMany.mockResolvedValueOnce({ count: 0 });
    await svc.vuelta(AHORA);
    expect(enviarAviso).not.toHaveBeenCalled();
  });

  it('una vuelta a la vez; nunca lanza', async () => {
    casos = [caso()];
    const [a, b] = await Promise.all([svc.vuelta(AHORA), svc.vuelta(AHORA)]);
    expect(a.avisados + b.avisados).toBe(1);
    prisma.supportTicket.findMany.mockRejectedValueOnce(new Error('db caída'));
    await expect(svc.vuelta(AHORA)).resolves.toEqual({
      avisados: 0,
      sinAviso: 0,
      fallidos: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();
    await svc.cadaMinuto();
  });
});
