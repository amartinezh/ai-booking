import { AppointmentReminderCronService } from './appointment-reminder.cron';

/**
 * Cubre la decisión que introdujo la capa de plantillas: DENTRO de la ventana
 * de 24 h se responde con texto libre; FUERA hay que usar plantilla aprobada,
 * porque Meta rechaza el texto libre. Antes se mandaba texto libre siempre.
 */
describe('AppointmentReminderCronService — plantilla vs texto libre', () => {
  const ORG = 'org-1';
  const PHONE = '573001112233';
  const BSUID = 'CO.13491208655302741918';

  const cita = (over: Record<string, any> = {}) => ({
    id: 'apt-1',
    organizationId: ORG,
    patient: {
      cedula: '1088123456',
      fullName: 'Ana Pérez',
      whatsappId: PHONE,
      bsuid: null,
      ...(over.patient ?? {}),
    },
    scheduleSlot: {
      startTime: new Date('2026-09-01T14:00:00.000Z'),
      doctor: { fullName: 'Dr. Ruiz' },
      service: { name: 'Cardiología' },
    },
    organization: { id: ORG, name: 'Hospital San Vicente' },
  });

  const build = (opts?: {
    withinWindow?: boolean;
    templateResult?: { success: boolean; error?: string };
  }) => {
    const chatbot = {
      isWithinServiceWindow: jest.fn(async () => opts?.withinWindow ?? false),
      sendOutboundForOrg: jest.fn(async () => ({ success: true })),
    };
    const templates = {
      sendTemplate: jest.fn(
        async () => opts?.templateResult ?? { success: true },
      ),
    };
    const prisma = { appointment: { update: jest.fn(async () => ({})) } };
    const interactionLog = { logReminderSent: jest.fn(async () => {}) };

    const service = new AppointmentReminderCronService(
      { get: jest.fn(() => undefined) } as any, // ConfigService → defaults
      prisma as any,
      chatbot as any,
      {
        getCommunicationStyle: jest.fn(async () => 'FORMAL'),
        getBotName: jest.fn(async () => 'Geni'),
      } as any,
      interactionLog as any,
      { log: jest.fn() } as any,
      templates as any,
      { addInterval: jest.fn(), deleteInterval: jest.fn() } as any,
    );
    return { service, chatbot, templates, prisma, interactionLog };
  };

  const run = (ctx: ReturnType<typeof build>, apt = cita()) =>
    (ctx.service as any).processOne(apt) as Promise<string>;

  it('DENTRO de la ventana → texto libre, sin plantilla', async () => {
    const ctx = build({ withinWindow: true });
    const res = await run(ctx);

    expect(res).toBe('sent');
    expect(ctx.chatbot.sendOutboundForOrg).toHaveBeenCalled();
    expect(ctx.templates.sendTemplate).not.toHaveBeenCalled();
  });

  it('FUERA de la ventana → plantilla, nunca texto libre', async () => {
    const ctx = build({ withinWindow: false });
    const res = await run(ctx);

    expect(res).toBe('sent');
    expect(ctx.templates.sendTemplate).toHaveBeenCalled();
    expect(ctx.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
  });

  it('la plantilla recibe las variables en el orden del contrato', async () => {
    const ctx = build({ withinWindow: false });
    await run(ctx);

    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        recipientId: PHONE,
        kind: 'APPOINTMENT_REMINDER',
        bodyParams: [
          'Ana',
          'Cardiología',
          'Dr. Ruiz',
          expect.any(String), // fecha ya formateada para el paciente
        ],
      }),
    );
  });

  it('el BSUID manda sobre el teléfono como destinatario', async () => {
    const ctx = build({ withinWindow: false });
    await run(ctx, cita({ patient: { bsuid: BSUID } }));

    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: BSUID }),
    );
  });

  it('la ventana se consulta con el MISMO identificador al que se enviará', async () => {
    const ctx = build({ withinWindow: false });
    await run(ctx, cita({ patient: { bsuid: BSUID } }));

    expect(ctx.chatbot.isWithinServiceWindow).toHaveBeenCalledWith(ORG, BSUID);
  });

  // ── Plantilla sin configurar: no es un fallo de red que reintentar ──────
  it('fuera de ventana y sin plantilla → skipped, y NO marca la cita como enviada', async () => {
    const ctx = build({
      withinWindow: false,
      templateResult: { success: false, error: 'template-not-configured' },
    });
    const res = await run(ctx);

    expect(res).toBe('skipped');
    expect(ctx.prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('sin plantilla configurada deja huella en la auditoría de la clínica', async () => {
    const ctx = build({
      withinWindow: false,
      templateResult: { success: false, error: 'template-not-configured' },
    });
    await run(ctx);

    expect(ctx.interactionLog.logReminderSent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        success: false,
        error: expect.stringContaining('APPOINTMENT_REMINDER'),
      }),
    );
  });

  it('paciente sin ningún identificador → omitido, sin tocar Meta', async () => {
    const ctx = build({ withinWindow: false });
    const res = await run(ctx, cita({ patient: { whatsappId: null } }));

    expect(res).toBe('skipped');
    expect(ctx.templates.sendTemplate).not.toHaveBeenCalled();
    expect(ctx.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
  });
});
