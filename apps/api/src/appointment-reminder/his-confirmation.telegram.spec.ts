import {
  HisConfirmationService,
  MSG_CONFIRMACION,
} from './his-confirmation.service';

/**
 * Confirmación de una cita del hospital a un paciente de Telegram
 * (docs/PLAN_TELEGRAM.md, T4). La cita es MIRROR: va por WhatsApp como siempre
 * y solo usa Telegram cuando el paciente no tiene WhatsApp. Telegram no tiene
 * ventana de 24 h, así que ahí siempre es texto libre, nunca plantilla.
 */
describe('HisConfirmationService — Telegram', () => {
  const ORG = 'org-1';
  const AHORA = new Date('2026-09-23T15:00:00.000Z');
  const ADMIN = { userId: 'u-admin', role: 'ORG_ADMIN' };

  const cupo = (over: Record<string, unknown> = {}) => ({
    id: 'slot-1',
    startTime: new Date('2026-09-25T13:00:00.000Z'),
    isAvailable: false,
    doctorId: 'doc-1',
    doctor: { fullName: 'Ana Ruiz', isFunctionalAgenda: false },
    service: { name: 'Medicina general' },
    appointments: [] as { id: string }[],
    ...over,
  });
  const paciente = (over: Record<string, unknown> = {}) => ({
    id: 'pac-1',
    userId: 'user-pac-1',
    fullName: 'María López Gómez',
    whatsappId: '573001112233' as string | null,
    bsuid: null as string | null,
    epsId: 'eps-1' as string | null,
    ...over,
  });

  const build = (
    opts: {
      cupo?: unknown;
      paciente?: unknown;
      dentroDeVentana?: boolean;
      envio?: { success: boolean; error?: string };
      reserva?: 'OK' | null | Error;
      agente?: { epsId: string | null; doctorId: string | null } | null;
    } = {},
  ) => {
    const prisma = {
      scheduleSlot: {
        findFirst: jest.fn(async (..._a: unknown[]) =>
          'cupo' in opts ? opts.cupo : cupo(),
        ),
      },
      patientProfile: {
        findFirst: jest.fn(async (..._a: unknown[]) =>
          'paciente' in opts ? opts.paciente : paciente(),
        ),
      },
      organization: {
        findUnique: jest.fn(async (..._a: unknown[]) => ({
          name: 'Hospital San Vicente',
        })),
      },
      agentProfile: {
        findUnique: jest.fn(async (..._a: unknown[]) => opts.agente ?? null),
      },
      doctorProfile: { findUnique: jest.fn(async (..._a: unknown[]) => null) },
    };
    const redis = {
      set: jest.fn(async (..._a: unknown[]) => {
        if (opts.reserva instanceof Error) throw opts.reserva;
        return 'reserva' in opts ? opts.reserva : 'OK';
      }),
      del: jest.fn(async (..._a: unknown[]) => 1),
    };
    const chatbot = {
      isWithinServiceWindow: jest.fn(
        async (..._a: unknown[]) => opts.dentroDeVentana ?? true,
      ),
      sendOutboundForOrg: jest.fn(
        async (..._a: unknown[]) => opts.envio ?? { success: true },
      ),
    };
    const templates = {
      sendTemplate: jest.fn(
        async (..._a: unknown[]) => opts.envio ?? { success: true },
      ),
    };
    const organizationSettings = { getBotName: jest.fn(async () => 'Vicente') };
    const interactionLog = {
      log: jest.fn(async (..._a: unknown[]) => undefined),
    };
    const systemLog = { event: jest.fn(async (..._a: unknown[]) => undefined) };
    const service = new HisConfirmationService(
      prisma as never,
      redis as never,
      chatbot as never,
      templates as never,
      organizationSettings as never,
      interactionLog as never,
      systemLog as never,
    );
    return {
      service,
      prisma,
      redis,
      chatbot,
      templates,
      interactionLog,
      systemLog,
    };
  };

  const enviar = (
    s: HisConfirmationService,
    over: Record<string, unknown> = {},
  ) =>
    s.enviar(
      {
        organizationId: ORG,
        actor: ADMIN,
        scheduleSlotId: 'slot-1',
        patientId: 'pac-1',
        verificacion: 'HIS_EN_VIVO',
        ...over,
      } as never,
      AHORA,
    );

  it('paciente con WhatsApp y Telegram: sigue saliendo por WhatsApp, como siempre', async () => {
    const { service, chatbot } = build({
      paciente: paciente({ telegramChatId: '777', telegramBlockedAt: null }),
    });
    await expect(enviar(service)).resolves.toEqual({
      success: true,
      via: 'TEXTO',
    });
    expect(chatbot.sendOutboundForOrg.mock.calls[0][1]).toBe('573001112233');
  });

  it('paciente solo de Telegram: sale por Telegram, como TEXTO aunque esté «fuera de ventana»', async () => {
    const { service, chatbot, templates, interactionLog } = build({
      dentroDeVentana: false,
      paciente: paciente({
        whatsappId: null,
        telegramChatId: '777',
        telegramBlockedAt: null,
      }),
    });
    await expect(enviar(service)).resolves.toEqual({
      success: true,
      via: 'TEXTO',
    });
    expect(templates.sendTemplate).not.toHaveBeenCalled();
    expect(chatbot.isWithinServiceWindow).not.toHaveBeenCalled();
    const [, destino, , ctx] = chatbot.sendOutboundForOrg.mock.calls[0] as [
      string,
      string,
      string,
      unknown,
    ];
    expect(destino).toBe('tg:777');
    expect(ctx).toEqual({ kind: 'BOOKING_CONFIRMATION' });
    const log = (interactionLog.log.mock.calls[0] as [Record<string, any>])[0];
    expect(log.whatsappId).toBe('tg:777');
    expect(log.metadata.canal).toBe('TELEGRAM');
  });

  it('solo Telegram y bloqueó al bot: no hay a quién escribir', async () => {
    const { service, chatbot, templates } = build({
      paciente: paciente({
        whatsappId: null,
        telegramChatId: '777',
        telegramBlockedAt: new Date(),
      }),
    });
    await expect(enviar(service)).resolves.toEqual({
      success: false,
      error: MSG_CONFIRMACION.sinWhatsapp,
    });
    expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(templates.sendTemplate).not.toHaveBeenCalled();
  });

  it('un paciente de WhatsApp no gana `canal` en la auditoría', async () => {
    const { service, interactionLog } = build();
    await enviar(service);
    const log = (interactionLog.log.mock.calls[0] as [Record<string, any>])[0];
    expect(log.metadata).not.toHaveProperty('canal');
  });
});
