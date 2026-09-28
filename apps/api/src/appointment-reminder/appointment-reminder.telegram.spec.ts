import { Logger } from '@nestjs/common';
import { AppointmentReminderCronService } from './appointment-reminder.cron';

/**
 * Recordatorio por el canal de la cita (docs/PLAN_TELEGRAM.md, T4):
 *  - cita de Telegram → Telegram, texto libre (no hay ventana ni plantilla);
 *  - si Telegram no entrega → WhatsApp por el camino de siempre;
 *  - cita que no es de Telegram → WhatsApp, idéntico a antes.
 */
describe('AppointmentReminderCronService — canal del recordatorio', () => {
  const ORG = 'org-1';
  const PHONE = '573001112233';
  const TG = 'tg:777';

  const cita = (origin: string, patient: Record<string, unknown> = {}) => ({
    id: 'apt-1',
    organizationId: ORG,
    origin,
    patient: {
      cedula: '1088123456',
      fullName: 'Ana Pérez',
      whatsappId: PHONE,
      bsuid: null,
      telegramChatId: '777',
      telegramBlockedAt: null,
      ...patient,
    },
    scheduleSlot: {
      startTime: new Date('2026-09-01T14:00:00.000Z'),
      doctor: { fullName: 'Dr. Ruiz' },
      service: { name: 'Cardiología' },
    },
    organization: { id: ORG, name: 'Hospital San Vicente', timezone: null },
  });

  const build = (
    opts: {
      telegramOk?: boolean;
      withinWindow?: boolean;
      templateResult?: { success: boolean; error?: string };
    } = {},
  ) => {
    const chatbot = {
      isWithinServiceWindow: jest.fn(() => opts.withinWindow ?? false),
      sendOutboundForOrg: jest.fn((_org: string, to: string) =>
        to.startsWith('tg:')
          ? opts.telegramOk === false
            ? { success: false, error: 'telegram-send-failed' }
            : { success: true }
          : { success: true },
      ),
    };
    const templates = {
      sendTemplate: jest.fn(() => opts.templateResult ?? { success: true }),
    };
    const prisma = { appointment: { update: jest.fn(() => ({})) } };
    const interactionLog = { logReminderSent: jest.fn(async () => {}) };
    const service = new AppointmentReminderCronService(
      { get: jest.fn(() => undefined) } as any,
      prisma as any,
      chatbot as any,
      {
        getCommunicationStyle: jest.fn(() => 'FORMAL'),
        getBotName: jest.fn(() => 'Geni'),
      } as any,
      interactionLog as any,
      { log: jest.fn() } as any,
      templates as any,
      { addInterval: jest.fn(), deleteInterval: jest.fn() } as any,
    );
    const run = (apt: ReturnType<typeof cita>) =>
      (service as any).processOne(apt) as Promise<string>;
    return { run, chatbot, templates, prisma, interactionLog };
  };

  const destinatarios = (chatbot: { sendOutboundForOrg: jest.Mock }) =>
    chatbot.sendOutboundForOrg.mock.calls.map((c: any[]) => c[1]);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('cita de Telegram → sale por Telegram, texto libre, sin mirar la ventana ni plantillas', async () => {
    const ctx = build();
    await expect(ctx.run(cita('TELEGRAM'))).resolves.toBe('sent');
    expect(destinatarios(ctx.chatbot)).toEqual([TG]);
    expect(ctx.chatbot.sendOutboundForOrg.mock.calls[0][3]).toEqual({
      kind: 'APPOINTMENT_REMINDER',
      appointmentId: 'apt-1',
    });
    expect(ctx.chatbot.isWithinServiceWindow).not.toHaveBeenCalled();
    expect(ctx.templates.sendTemplate).not.toHaveBeenCalled();
    expect(ctx.prisma.appointment.update).toHaveBeenCalled(); // reminderSentAt
    expect(ctx.interactionLog.logReminderSent.mock.calls[0][0]).toMatchObject({
      whatsappId: TG,
      success: true,
    });
  });

  it('Telegram falla → cae a WhatsApp con PLANTILLA (fuera de la ventana), como siempre', async () => {
    const ctx = build({ telegramOk: false, withinWindow: false });
    await expect(ctx.run(cita('TELEGRAM'))).resolves.toBe('sent');
    expect(destinatarios(ctx.chatbot)).toEqual([TG]);
    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: PHONE,
        kind: 'APPOINTMENT_REMINDER',
      }),
    );
    expect(ctx.interactionLog.logReminderSent.mock.calls[0][0]).toMatchObject({
      whatsappId: PHONE,
      success: true,
    });
  });

  it('Telegram falla → cae a WhatsApp con texto libre si está dentro de la ventana', async () => {
    const ctx = build({ telegramOk: false, withinWindow: true });
    await expect(ctx.run(cita('TELEGRAM'))).resolves.toBe('sent');
    expect(destinatarios(ctx.chatbot)).toEqual([TG, PHONE]);
    expect(ctx.chatbot.isWithinServiceWindow).toHaveBeenCalledWith(ORG, PHONE);
  });

  it('Telegram falla y el paciente solo tiene Telegram → failed (se reintenta el próximo tick)', async () => {
    const ctx = build({ telegramOk: false });
    await expect(ctx.run(cita('TELEGRAM', { whatsappId: null }))).resolves.toBe(
      'failed',
    );
    expect(ctx.prisma.appointment.update).not.toHaveBeenCalled();
    expect(ctx.interactionLog.logReminderSent.mock.calls[0][0]).toMatchObject({
      whatsappId: TG,
      success: false,
      error: 'telegram-send-failed',
    });
  });

  it('paciente que bloqueó al bot → directo por WhatsApp, sin intentar Telegram', async () => {
    const ctx = build({ withinWindow: false });
    await ctx.run(cita('TELEGRAM', { telegramBlockedAt: new Date() }));
    expect(ctx.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: PHONE }),
    );
  });

  it('bloqueado y sin WhatsApp → skipped, sin intentar nada', async () => {
    const ctx = build();
    await expect(
      ctx.run(
        cita('TELEGRAM', { whatsappId: null, telegramBlockedAt: new Date() }),
      ),
    ).resolves.toBe('skipped');
    expect(ctx.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(ctx.templates.sendTemplate).not.toHaveBeenCalled();
  });

  it.each(['WHATSAPP', 'MANUAL', 'MIRROR'])(
    'cita %s con los dos canales → WhatsApp, como siempre (Telegram ni se toca)',
    async (origin) => {
      const ctx = build({ withinWindow: false });
      await expect(ctx.run(cita(origin))).resolves.toBe('sent');
      expect(ctx.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: PHONE }),
      );
    },
  );

  it('cita del hospital de un paciente que solo tiene Telegram → Telegram (antes se omitía)', async () => {
    const ctx = build();
    await expect(ctx.run(cita('MIRROR', { whatsappId: null }))).resolves.toBe(
      'sent',
    );
    expect(destinatarios(ctx.chatbot)).toEqual([TG]);
  });
});
