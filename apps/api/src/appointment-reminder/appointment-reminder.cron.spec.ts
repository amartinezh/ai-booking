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
      isWithinServiceWindow: jest.fn(() => opts?.withinWindow ?? false),
      sendOutboundForOrg: jest.fn(() => ({ success: true })),
    };
    const templates = {
      sendTemplate: jest.fn(() => opts?.templateResult ?? { success: true }),
    };
    const prisma = { appointment: { update: jest.fn(() => ({})) } };
    const interactionLog = { logReminderSent: jest.fn(async () => {}) };

    const service = new AppointmentReminderCronService(
      { get: jest.fn(() => undefined) } as any, // ConfigService → defaults
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

// ══════════════════════════════════════════════════════════════════════════
// El LOTE completo y el disparo manual desde el dashboard.
//
// El cron corre cada pocos minutos sobre citas reales de varias clínicas. Sus
// dos garantías duras: un fallo individual no detiene el lote, y nunca se
// envía dos veces (`reminderSentAt`). Ninguna de las dos estaba probada.
// ══════════════════════════════════════════════════════════════════════════
describe('AppointmentReminderCronService — el lote y el disparo manual', () => {
  const ORG = 'org-1';

  const cita = (over: Record<string, any> = {}) => ({
    id: 'apt-1',
    status: 'SCHEDULED',
    organizationId: ORG,
    patient: {
      cedula: '1088123456',
      fullName: 'Ana Pérez',
      whatsappId: '573001112233',
      bsuid: null,
    },
    scheduleSlot: {
      startTime: new Date('2026-09-01T14:00:00.000Z'),
      doctor: { fullName: 'Dr. Ruiz' },
      service: { name: 'Cardiología' },
    },
    organization: { id: ORG, name: 'Hospital San Vicente' },
    ...over,
  });

  const build = (opts?: {
    eligibles?: any[];
    withinWindow?: boolean;
    envio?: { success: boolean; error?: string };
    estilo?: 'FORMAL' | 'INFORMAL';
  }) => {
    const chatbot = {
      isWithinServiceWindow: jest.fn(async () => opts?.withinWindow ?? true),
      sendOutboundForOrg: jest.fn(async () => opts?.envio ?? { success: true }),
    };
    const templates = {
      sendTemplate: jest.fn(async () => ({ success: true })),
    };
    const prisma = {
      appointment: {
        findMany: jest.fn(async () => opts?.eligibles ?? []),
        findFirst: jest.fn(
          async (): Promise<Record<string, unknown> | null> => null,
        ),
        findUnique: jest.fn(async () => ({
          id: 'apt-1',
          reminderSentAt: new Date('2026-08-31T14:00:00.000Z'),
        })),
        update: jest.fn(async () => ({})),
      },
    };
    const interactionLog = { logReminderSent: jest.fn(async () => {}) };
    const systemLog = {
      event: jest.fn(async () => {}),
      error: jest.fn(async () => {}),
    };
    const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };

    const service = new AppointmentReminderCronService(
      { get: jest.fn(() => undefined) } as any,
      prisma as any,
      chatbot as any,
      {
        getCommunicationStyle: jest.fn(async () => opts?.estilo ?? 'FORMAL'),
        getBotName: jest.fn(async () => 'Geni'),
      } as any,
      interactionLog as any,
      systemLog as any,
      templates as any,
      scheduler as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

    return {
      service,
      chatbot,
      templates,
      prisma,
      interactionLog,
      systemLog,
      scheduler,
    };
  };

  describe('runOnce', () => {
    it('sin citas elegibles no escribe ni un log de lote', async () => {
      const { service, systemLog } = build({ eligibles: [] });

      await expect(service.runOnce()).resolves.toEqual({
        sent: 0,
        failed: 0,
        skipped: 0,
      });
      expect(systemLog.event).not.toHaveBeenCalled();
    });

    it('la consulta pide solo SCHEDULED sin recordatorio y dentro de la ventana', async () => {
      const { service, prisma } = build();
      await service.runOnce();

      const where = (
        prisma.appointment.findMany.mock.calls[0] as unknown as [
          { where: Record<string, any> },
        ]
      )[0].where;
      expect(where.status).toBe('SCHEDULED');
      expect(where.reminderSentAt).toBeNull();
      expect(where.scheduleSlot.startTime.gt).toBeInstanceOf(Date);
      expect(where.scheduleSlot.startTime.lte).toBeInstanceOf(Date);
    });

    it('procesa en orden cronológico y con tope de seguridad', async () => {
      const { service, prisma } = build();
      await service.runOnce();

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { scheduleSlot: { startTime: 'asc' } },
          take: 200,
        }),
      );
    });

    it('un envío bueno marca la cita y cuenta como enviado', async () => {
      const { service, prisma, interactionLog } = build({
        eligibles: [cita()],
      });

      await expect(service.runOnce()).resolves.toEqual({
        sent: 1,
        failed: 0,
        skipped: 0,
      });
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        data: { reminderSentAt: expect.any(Date) },
      });
      expect(interactionLog.logReminderSent).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it('🚫 un envío fallido NO marca la cita: el próximo tick lo reintenta', async () => {
      const { service, prisma, interactionLog } = build({
        eligibles: [cita()],
        envio: { success: false, error: '401 token expirado' },
      });

      await expect(service.runOnce()).resolves.toEqual({
        sent: 0,
        failed: 1,
        skipped: 0,
      });
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(interactionLog.logReminderSent).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: '401 token expirado',
        }),
      );
    });

    it('🛡️ un fallo en UNA cita no detiene el lote: las demás siguen', async () => {
      const { service, chatbot, prisma } = build({
        eligibles: [cita({ id: 'a' }), cita({ id: 'b' }), cita({ id: 'c' })],
      });
      chatbot.sendOutboundForOrg
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('la red se cayó'))
        .mockResolvedValueOnce({ success: true });

      const r = await service.runOnce();

      expect(r).toEqual({ sent: 2, failed: 1, skipped: 0 });
      expect(prisma.appointment.update).toHaveBeenCalledTimes(2);
    });

    it('el fallo inesperado de una cita deja huella en SystemLog con su id', async () => {
      const { service, chatbot, systemLog } = build({ eligibles: [cita()] });
      chatbot.sendOutboundForOrg.mockRejectedValue(new Error('boom'));

      await service.runOnce();

      expect(systemLog.error).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REMINDER_CRON_ITEM_ERROR',
          organizationId: ORG,
          metadata: expect.objectContaining({ appointmentId: 'apt-1' }),
        }),
      );
    });

    it('una cita sin clínica se omite antes de tocar Meta', async () => {
      const { service, chatbot } = build({
        eligibles: [cita({ organizationId: null })],
      });

      await expect(service.runOnce()).resolves.toEqual({
        sent: 0,
        failed: 0,
        skipped: 1,
      });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    });

    it('el resumen del lote queda en SystemLog con la ventana usada', async () => {
      const { service, systemLog } = build({ eligibles: [cita()] });

      await service.runOnce();

      expect(systemLog.event).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REMINDER_CRON_RUN',
          metadata: expect.objectContaining({
            sent: 1,
            failed: 0,
            skipped: 0,
            businessHoursBefore: expect.any(Number),
            windowFrom: expect.any(String),
            windowTo: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('el texto del recordatorio', () => {
    const textoEnviado = (chatbot: { sendOutboundForOrg: jest.Mock }) =>
      (
        chatbot.sendOutboundForOrg.mock.calls[0] as unknown as unknown[]
      )[2] as string;

    it('formal trata de usted y nombra clínica, servicio, médico y fecha', async () => {
      const { service, chatbot } = build({ eligibles: [cita()] });
      await service.runOnce();

      const texto = textoEnviado(chatbot);
      expect(texto).toContain('Le recordamos');
      expect(texto).toContain('Hospital San Vicente');
      expect(texto).toContain('Cardiología');
      expect(texto).toContain('Dr. Ruiz');
      expect(texto).toContain('Ana'); // solo el primer nombre
      expect(texto).toContain('Geni');
    });

    it('informal tutea', async () => {
      const { service, chatbot } = build({
        eligibles: [cita()],
        estilo: 'INFORMAL',
      });
      await service.runOnce();

      expect(textoEnviado(chatbot)).toContain('Te recuerdo');
    });

    it('siempre dice cómo cancelar: el recordatorio es una vía de salida', async () => {
      const { service, chatbot } = build({ eligibles: [cita()] });
      await service.runOnce();
      expect(textoEnviado(chatbot).toLowerCase()).toContain('cancelar');
    });

    it('la fecha se presenta en hora de Bogotá, no en la UTC del contenedor', async () => {
      const { service, chatbot } = build({ eligibles: [cita()] });
      await service.runOnce();
      // 14:00 UTC = 09:00 en Bogotá.
      expect(textoEnviado(chatbot)).toContain('09:00');
    });

    it('los datos que falten no dejan «undefined» en el mensaje', async () => {
      const { service, chatbot } = build({
        eligibles: [
          cita({
            patient: {
              cedula: null,
              fullName: null,
              whatsappId: 'x',
              bsuid: null,
            },
            scheduleSlot: {
              startTime: new Date('2026-09-01T14:00:00.000Z'),
              doctor: null,
              service: null,
            },
            organization: null,
          }),
        ],
      });

      await service.runOnce();

      const texto = textoEnviado(chatbot);
      expect(texto).not.toContain('undefined');
      expect(texto).toContain('su médico');
      expect(texto).toContain('su consulta');
      expect(texto).toContain('su clínica');
    });
  });

  describe('sendManualForAppointment (botón del dashboard)', () => {
    it('envía y devuelve el reminderSentAt ya actualizado', async () => {
      const { service, prisma, systemLog } = build();
      prisma.appointment.findFirst.mockResolvedValue(cita());

      const r = await service.sendManualForAppointment('apt-1', ORG);

      expect(r.success).toBe(true);
      expect(r.outcome).toBe('sent');
      expect(r.appointment?.reminderSentAt).toBeInstanceOf(Date);
      expect(systemLog.event).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REMINDER_MANUAL_SENT' }),
      );
    });

    it('🏢 la cita se busca acotada a la clínica que la pide', async () => {
      const { service, prisma } = build();
      await service.sendManualForAppointment('apt-1', ORG);

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-1', organizationId: ORG },
        }),
      );
    });

    it('una cita de otra clínica (o inexistente) se rechaza sin enviar nada', async () => {
      const { service, chatbot } = build();

      const r = await service.sendManualForAppointment('apt-ajena', ORG);

      expect(r).toMatchObject({ success: false, outcome: 'skipped' });
      expect(r.error).toContain('no pertenece');
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    });

    it.each(['CANCELLED', 'COMPLETED'])(
      'no se recuerda una cita en estado %s',
      async (status) => {
        const { service, prisma, chatbot } = build();
        prisma.appointment.findFirst.mockResolvedValue(cita({ status }));

        const r = await service.sendManualForAppointment('apt-1', ORG);

        expect(r.success).toBe(false);
        expect(r.error).toContain(status);
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      },
    );

    it('un paciente sin WhatsApp registrado se rechaza con un motivo claro', async () => {
      const { service, prisma } = build();
      prisma.appointment.findFirst.mockResolvedValue(
        cita({
          patient: {
            cedula: '1',
            fullName: 'Ana',
            whatsappId: null,
            bsuid: null,
          },
        }),
      );

      const r = await service.sendManualForAppointment('apt-1', ORG);

      expect(r).toMatchObject({ success: false, outcome: 'skipped' });
      expect(r.error).toContain('WhatsApp');
    });

    it('un envío rechazado por Meta se reporta como fallo accionable', async () => {
      const { service, prisma } = build({
        envio: { success: false, error: '401' },
      });
      prisma.appointment.findFirst.mockResolvedValue(cita());

      const r = await service.sendManualForAppointment('apt-1', ORG);

      expect(r).toMatchObject({ success: false, outcome: 'failed' });
      expect(r.error).toContain('credenciales');
    });

    it('el reenvío manual SÍ se permite aunque ya se hubiera enviado', async () => {
      const { service, prisma } = build();
      prisma.appointment.findFirst.mockResolvedValue(
        cita({ reminderSentAt: new Date('2026-08-30T00:00:00Z') }),
      );

      const r = await service.sendManualForAppointment('apt-1', ORG);

      expect(r.success).toBe(true);
      expect(prisma.appointment.update).toHaveBeenCalled();
    });
  });

  describe('ciclo de vida del intervalo', () => {
    it('onModuleInit registra el intervalo con el nombre esperado', () => {
      const { service, scheduler } = build();
      service.onModuleInit();

      expect(scheduler.addInterval).toHaveBeenCalledWith(
        'appointment-reminders',
        expect.anything(),
      );
      clearInterval(scheduler.addInterval.mock.calls[0][1]);
    });

    it('onModuleDestroy lo quita', () => {
      const { service, scheduler } = build();
      service.onModuleDestroy();
      expect(scheduler.deleteInterval).toHaveBeenCalledWith(
        'appointment-reminders',
      );
    });

    it('onModuleDestroy no revienta si nunca se llegó a registrar', () => {
      const { service, scheduler } = build();
      scheduler.deleteInterval.mockImplementation(() => {
        throw new Error('no existe');
      });
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it('🔒 un tick que se solapa con el anterior se omite en vez de duplicar envíos', async () => {
      const { service, prisma } = build();
      let resolver!: (v: unknown) => void;
      prisma.appointment.findMany.mockImplementation(
        () => new Promise((res) => (resolver = res)),
      );

      // Se captura el CUERPO del intervalo para dispararlo a mano.
      let cuerpo!: () => void;
      const spy = jest.spyOn(global, 'setInterval').mockImplementation(((
        fn: () => void,
      ) => {
        cuerpo = fn;
        return 0 as unknown as NodeJS.Timeout;
      }) as never);
      service.onModuleInit();
      spy.mockRestore();

      cuerpo(); // primer tick: se queda esperando a la base
      cuerpo(); // segundo tick: debe salirse por el lock

      expect(prisma.appointment.findMany).toHaveBeenCalledTimes(1);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('aún en curso'),
      );

      resolver([]);
      await new Promise((r) => setImmediate(r));
    });

    it('un fallo del tick se registra y NO se propaga fuera del intervalo', async () => {
      const { service, prisma } = build();
      prisma.appointment.findMany.mockRejectedValue(new Error('BD caída'));

      let cuerpo!: () => void;
      const spy = jest.spyOn(global, 'setInterval').mockImplementation(((
        fn: () => void,
      ) => {
        cuerpo = fn;
        return 0 as unknown as NodeJS.Timeout;
      }) as never);
      service.onModuleInit();
      spy.mockRestore();

      expect(() => cuerpo()).not.toThrow();
      await new Promise((r) => setImmediate(r));
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cron falló'),
        expect.stringContaining('BD caída'),
      );
    });
  });
});
