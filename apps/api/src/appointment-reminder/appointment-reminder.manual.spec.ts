import { AppointmentReminderCronService } from './appointment-reminder.cron';

/**
 * Botón «Recordar» del panel (`sendManualForAppointment`): acepta a quien el
 * cron SÍ le escribiría. Antes exigía `whatsappId`, y un paciente que ocultó
 * su número en WhatsApp (solo BSUID) se rechazaba con «no tiene número de
 * WhatsApp» aunque el recordatorio automático le llegaba sin problema.
 *
 * La comprobación usa ahora la misma regla con la que el cron elige el canal
 * (`destinoDeContacto`, en @agenia/shared).
 */
describe('AppointmentReminderCronService — recordatorio manual y destinatario', () => {
  const ORG = 'org-1';
  const ADMIN = { userId: 'u-admin', role: 'ORG_ADMIN' };
  const BSUID = 'CO.13491208655302741918';

  const cita = (origin: string, patient: Record<string, unknown>) => ({
    id: 'apt-1',
    status: 'SCHEDULED',
    organizationId: ORG,
    origin,
    epsId: null,
    patient: {
      cedula: '1088123456',
      fullName: 'Ana Pérez',
      whatsappId: null,
      bsuid: null,
      telegramChatId: null,
      telegramBlockedAt: null,
      ...patient,
    },
    scheduleSlot: {
      startTime: new Date('2026-09-01T14:00:00.000Z'),
      doctorId: 'doc-1',
      doctor: { fullName: 'Dr. Ruiz' },
      service: { name: 'Cardiología' },
    },
    organization: { id: ORG, name: 'Hospital San Vicente', timezone: null },
  });

  const build = (
    apt: unknown,
    opts: { envio?: { success: boolean; error?: string } } = {},
  ) => {
    const chatbot = {
      isWithinServiceWindow: jest.fn(async () => false),
      sendOutboundForOrg: jest.fn(async () => opts.envio ?? { success: true }),
    };
    const templates = {
      sendTemplate: jest.fn(async () => opts.envio ?? { success: true }),
    };
    const prisma = {
      appointment: {
        findFirst: jest.fn(async () => apt),
        findUnique: jest.fn(async () => ({
          id: 'apt-1',
          reminderSentAt: new Date(),
        })),
        update: jest.fn(async () => ({})),
      },
      agentProfile: { findUnique: jest.fn(async () => null) },
      doctorProfile: { findUnique: jest.fn(async () => null) },
    };
    const service = new AppointmentReminderCronService(
      { get: jest.fn(() => undefined) } as any,
      prisma as any,
      chatbot as any,
      {
        getCommunicationStyle: jest.fn(async () => 'FORMAL'),
        getBotName: jest.fn(async () => 'Geni'),
      } as any,
      { logReminderSent: jest.fn(async () => {}) } as any,
      { event: jest.fn(async () => {}), error: jest.fn(async () => {}) } as any,
      templates as any,
      { addInterval: jest.fn(), deleteInterval: jest.fn() } as any,
    );
    for (const l of ['log', 'debug', 'warn', 'error'] as const) {
      jest.spyOn((service as any).logger, l).mockImplementation(() => {});
    }
    const enviar = () => service.sendManualForAppointment('apt-1', ORG, ADMIN);
    return { enviar, chatbot, templates };
  };

  it('🐛 paciente con número oculto (solo BSUID): SE ENVÍA, al BSUID', async () => {
    const { enviar, templates } = build(cita('WHATSAPP', { bsuid: BSUID }));
    const r = await enviar();
    expect(r).toMatchObject({ success: true, outcome: 'sent' });
    // Fuera de la ventana de 24 h → plantilla, al BSUID (como el cron).
    expect(templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: BSUID,
        kind: 'APPOINTMENT_REMINDER',
      }),
    );
  });

  it('con teléfono, como siempre', async () => {
    const { enviar, templates } = build(
      cita('WHATSAPP', { whatsappId: '573001112233' }),
    );
    await expect(enviar()).resolves.toMatchObject({ success: true });
    expect(templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: '573001112233' }),
    );
  });

  it('solo Telegram: se envía por Telegram', async () => {
    const { enviar, chatbot } = build(
      cita('TELEGRAM', { telegramChatId: '777' }),
    );
    await expect(enviar()).resolves.toMatchObject({ success: true });
    expect(chatbot.sendOutboundForOrg.mock.calls[0][1]).toBe('tg:777');
  });

  it.each([
    ['sin ningún identificador', {}],
    [
      'solo Telegram y bloqueó al bot',
      { telegramChatId: '777', telegramBlockedAt: new Date() },
    ],
  ])(
    '%s: se rechaza con el motivo de siempre, sin intentar nada',
    async (_, patient) => {
      const { enviar, chatbot, templates } = build(cita('TELEGRAM', patient));
      const r = await enviar();
      expect(r).toMatchObject({
        success: false,
        outcome: 'skipped',
        error: 'El paciente no tiene número de WhatsApp registrado.',
      });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    },
  );

  it('si falla por Telegram, el mensaje al personal no habla de Meta', async () => {
    const { enviar } = build(cita('TELEGRAM', { telegramChatId: '777' }), {
      envio: { success: false, error: 'telegram-send-failed' },
    });
    const r = await enviar();
    expect(r).toMatchObject({ success: false, outcome: 'failed' });
    expect(r.error).toContain('Telegram');
    expect(r.error).not.toContain('Meta');
  });

  it('si falla por WhatsApp, el mensaje es el de siempre', async () => {
    const { enviar } = build(cita('WHATSAPP', { whatsappId: '573001112233' }), {
      envio: { success: false, error: '401' },
    });
    const r = await enviar();
    expect(r.error).toBe(
      'Meta no aceptó el envío del recordatorio. Revise las credenciales de WhatsApp o vuelva a intentar.',
    );
  });
});
