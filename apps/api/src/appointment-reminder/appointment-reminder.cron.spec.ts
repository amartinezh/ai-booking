import {
  AppointmentReminderCronService,
  confirmadaPorElChatDentroDeLaVentana,
  HORAS_ENTRE_CONFIRMACION_Y_RECORDATORIO,
} from './appointment-reminder.cron';

/**
 * Cubre la decisión que introdujo la capa de plantillas: DENTRO de la ventana
 * de 24 h se responde con texto libre; FUERA hay que usar plantilla aprobada,
 * porque Meta rechaza el texto libre. Antes se mandaba texto libre siempre.
 */

/**
 * La llamada de la consulta de citas ELEGIBLES (la que no busca la marca
 * `fueraDeTurno`). Desde el 2026-10-29 antes va otra consulta de citas: la de las
 * del hospital que nacieron fuera del turno.
 */
const llamadaElegibles = (prisma: {
  appointment: { findMany: { mock: { calls: unknown[][] } } };
}) =>
  prisma.appointment.findMany.mock.calls.find(
    (c) =>
      !(c[0] as { where?: { metaLog?: unknown } } | undefined)?.where?.metaLog,
  ) as unknown[];

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

  // La plantilla aprobada en Meta dice «… el {{4}}. Si no puede asistir…».
  // Con la fecha terminada en «a. m.», el paciente leía «a. m.. Si no puede».
  it('la fecha de la plantilla no trae su punto final: la frase de Meta lo pone', async () => {
    const ctx = build({ withinWindow: false });
    await run(ctx);

    const fecha = ctx.templates.sendTemplate.mock.calls[0][0].bodyParams[3];
    // `\s`: según el ICU de Node, entre «a.» y «m» va un espacio normal o uno
    // de no separación (U+00A0); el arreglo funciona con los dos.
    expect(fecha).toMatch(/[ap]\.\sm$/);
    expect(
      `… el ${fecha}. Si no puede asistir, por favor avísenos con anticipación.`,
    ).not.toContain('..');
  });

  it('el texto libre tampoco deja «a. m.» seguido de otro punto', async () => {
    const ctx = build({ withinWindow: true });
    await run(ctx);

    const texto = ctx.chatbot.sendOutboundForOrg.mock.calls[0][2] as string;
    expect(texto).toMatch(/[ap]\.\sm\*\./);
    expect(texto).not.toMatch(/m\.\*\./);
  });

  it('📬 el recordatorio queda ligado a SU cita en el libro de mensajes (plantilla y texto libre)', async () => {
    const fuera = build({ withinWindow: false });
    await run(fuera);
    expect(fuera.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'apt-1' }),
    );

    const dentro = build({ withinWindow: true });
    await run(dentro);
    expect(dentro.chatbot.sendOutboundForOrg).toHaveBeenCalledWith(
      ORG,
      PHONE,
      expect.any(String),
      { kind: 'APPOINTMENT_REMINDER', appointmentId: 'apt-1' },
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

  // Las citas de los ejemplos son del 1-sep a las 14:00 UTC: el reloj se fija
  // 4 h antes para que estén en plazo y lejos de la anticipación mínima (60
  // min por defecto). Solo el reloj: los temporizadores siguen siendo reales.
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-09-01T10:00:00.000Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });
  afterEach(() => jest.useRealTimers());

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
    /** Casos `TELEFONO_EQUIVOCADO` abiertos en la bandeja. */
    telefonoEquivocado?: { patientId: string | null }[];
    /** Casos abiertos de citas que el hospital no tiene (2026-10-29). */
    casosSinCitaEnElHospital?: { appointmentId: string | null }[];
    /** Altas de citas que no han llegado al hospital. */
    altasSinEntregar?: { entityId: string }[];
    /** Citas del hospital que nacieron fuera del turno (2026-10-29). */
    fueraDeTurno?: { id: string }[];
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
        findMany: jest.fn(async (...a: unknown[]) => {
          // 🗓️ La consulta de las citas del hospital que nacieron fuera del turno.
          const where = (a[0] as { where?: { metaLog?: unknown } })?.where;
          if (where?.metaLog) return opts?.fueraDeTurno ?? [];
          return opts?.eligibles ?? [];
        }),
        findFirst: jest.fn(
          async (): Promise<Record<string, unknown> | null> => null,
        ),
        findUnique: jest.fn(async () => ({
          id: 'apt-1',
          reminderSentAt: new Date('2026-08-31T14:00:00.000Z'),
        })),
        update: jest.fn(async () => ({})),
      },
      syncException: {
        findMany: jest.fn(async (...a: unknown[]) => {
          const where = (a[0] as { where?: { kind?: unknown } })?.where;
          // 🏥 La consulta de las citas que el hospital no tiene (2026-10-29).
          if (where && typeof where.kind === 'object') {
            return opts?.casosSinCitaEnElHospital ?? [];
          }
          return opts?.telefonoEquivocado ?? [];
        }),
      },
      syncOutbox: {
        findMany: jest.fn(async () => opts?.altasSinEntregar ?? []),
      },
      // Perfiles: el servicio los lee para acotar a un agente o a un médico (§12 #10b).
      agentProfile: { findUnique: jest.fn(async () => null as unknown) },
      doctorProfile: { findUnique: jest.fn(async () => null as unknown) },
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
    describe('⏱️ anticipación mínima (caso real 2026-10-17: recordatorio a 4 min de la cita)', () => {
      // Reloj en 2026-09-01T10:00Z.
      const enMinutos = (min: number) =>
        cita({
          id: `apt-${min}`,
          scheduleSlot: {
            ...cita().scheduleSlot,
            startTime: new Date(
              Date.parse('2026-09-01T10:00:00.000Z') + min * 60_000,
            ),
          },
        });
      const conMinimo = (apt: any, minutos: number | undefined) => ({
        ...apt,
        organization: {
          ...apt.organization,
          settings:
            minutos === undefined ? null : { reminderMinLeadMinutes: minutos },
        },
      });

      it('sin ajuste (60 min por defecto): la de 4 min no sale ni se marca; la de 3 h sí', async () => {
        const { service, chatbot, prisma } = build({
          eligibles: [
            conMinimo(enMinutos(4), undefined),
            conMinimo(enMinutos(180), undefined),
          ],
        });

        const r = await service.runOnce();

        expect(r).toEqual({
          sent: 1,
          failed: 0,
          skipped: 0,
          tooClose: 1,
          yaConfirmadas: 0,
        });
        expect(chatbot.sendOutboundForOrg).toHaveBeenCalledTimes(1);
        const marcadas = prisma.appointment.update.mock.calls.map(
          (c: any[]) => c[0].where.id,
        );
        expect(marcadas).toEqual(['apt-180']);
      });

      it('la clínica lo configura: con 30 min, la de 45 min sí sale', async () => {
        const { service } = build({
          eligibles: [conMinimo(enMinutos(45), 30)],
        });
        await expect(service.runOnce()).resolves.toMatchObject({
          sent: 1,
          tooClose: 0,
        });
      });

      it('con 0 (sin mínimo) sale aunque falten 4 minutos, como antes', async () => {
        const { service } = build({ eligibles: [conMinimo(enMinutos(4), 0)] });
        await expect(service.runOnce()).resolves.toMatchObject({
          sent: 1,
          tooClose: 0,
        });
      });

      it('solo citas demasiado cerca: no envía nada pero el lote lo deja dicho', async () => {
        const { service, systemLog, chatbot } = build({
          eligibles: [conMinimo(enMinutos(10), 60)],
        });

        await expect(service.runOnce()).resolves.toEqual({
          sent: 0,
          failed: 0,
          skipped: 0,
          tooClose: 1,
          yaConfirmadas: 0,
        });
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
        expect(systemLog.event).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              '1 sin enviar por empezar antes de la anticipación mínima',
            ),
          }),
        );
      });
    });

    it('sin citas elegibles no escribe ni un log de lote', async () => {
      const { service, systemLog } = build({ eligibles: [] });

      await expect(service.runOnce()).resolves.toEqual({
        sent: 0,
        failed: 0,
        skipped: 0,
        tooClose: 0,
        yaConfirmadas: 0,
      });
      expect(systemLog.event).not.toHaveBeenCalled();
    });

    // 💬 2026-10-27: las 17 citas del chat del 26 y 27 de octubre recibieron el
    // recordatorio entre 2 y 26 minutos después de la confirmación.
    describe('💬 agendada por el chat ya dentro de la ventana: la confirmación hizo de recordatorio', () => {
      // Reloj: martes 1-sep 10:00Z (5:00 a. m. en Bogotá); la cita, 14:00Z.
      const agendada = (origin: string, createdAt: string) =>
        cita({ id: `apt-${origin}`, origin, createdAt: new Date(createdAt) });

      it('WhatsApp hace 10 minutos: no sale, no se marca y el lote lo deja dicho', async () => {
        const { service, chatbot, templates, prisma, systemLog } = build({
          eligibles: [agendada('WHATSAPP', '2026-09-01T09:50:00.000Z')],
        });

        await expect(service.runOnce()).resolves.toEqual({
          sent: 0,
          failed: 0,
          skipped: 0,
          tooClose: 0,
          yaConfirmadas: 1,
        });
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
        expect(templates.sendTemplate).not.toHaveBeenCalled();
        expect(prisma.appointment.update).not.toHaveBeenCalled();
        expect(systemLog.event).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              '1 sin enviar porque se agendaron por el chat poco antes (la confirmación hizo de recordatorio)',
            ),
          }),
        );
      });

      it('Telegram, igual', async () => {
        const { service } = build({
          eligibles: [agendada('TELEGRAM', '2026-09-01T09:50:00.000Z')],
        });
        await expect(service.runOnce()).resolves.toMatchObject({
          sent: 0,
          yaConfirmadas: 1,
        });
      });

      it('por el chat pero con más anticipación (el viernes para el martes): sí sale', async () => {
        const { service } = build({
          eligibles: [agendada('WHATSAPP', '2026-08-28T14:00:00.000Z')],
        });
        await expect(service.runOnce()).resolves.toMatchObject({
          sent: 1,
          yaConfirmadas: 0,
        });
      });

      it.each(['MIRROR', 'MANUAL'])(
        'la del %s agendada hace 10 minutos sí sale: nadie se la confirmó por el chat',
        async (origin) => {
          const { service } = build({
            eligibles: [agendada(origin, '2026-09-01T09:50:00.000Z')],
          });
          await expect(service.runOnce()).resolves.toMatchObject({
            sent: 1,
            yaConfirmadas: 0,
          });
        },
      );
    });

    it('la consulta pide solo SCHEDULED sin recordatorio y dentro de la ventana', async () => {
      const { service, prisma } = build();
      await service.runOnce();

      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where.status).toBe('SCHEDULED');
      expect(where.reminderSentAt).toBeNull();
      expect(where.scheduleSlot.startTime.gt).toBeInstanceOf(Date);
      expect(where.scheduleSlot.startTime.lte).toBeInstanceOf(Date);
    });

    it('🔔 excluye a quien pidió no recibir recordatorios (D2): ni se le envía ni se le marca', async () => {
      const { service, prisma } = build();
      await service.runOnce();

      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      // En la CONSULTA, no al enviar: si se filtrara después, la cita quedaría
      // con `reminderSentAt` puesto — «ya se le avisó» de algo que nunca salió.
      expect(where.patient).toEqual({ remindersOptOut: false });
    });

    it('☎️ excluye a los pacientes con un caso de «teléfono equivocado» abierto, en la consulta', async () => {
      const { service, prisma } = build({
        telefonoEquivocado: [
          { patientId: 'pat-9' },
          { patientId: 'pat-9' },
          { patientId: null },
        ],
      });
      await service.runOnce();

      // Solo lo ABIERTO: cerrarlo (corregido o descartado) devuelve los recordatorios.
      expect(prisma.syncException.findMany.mock.calls[0][0]).toEqual({
        where: {
          kind: 'TELEFONO_EQUIVOCADO',
          status: { in: ['ABIERTA', 'EN_REVISION'] },
          patientId: { not: null },
        },
        select: { patientId: true },
      });
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where.patientId).toEqual({ notIn: ['pat-9'] });
      // Se suma a los demás filtros, no los reemplaza.
      expect(where.patient).toEqual({ remindersOptOut: false });
    });

    // 🏥 2026-10-29: a una paciente el hospital no le registró la cita (el médico se
    // quedó sin turno) y AgenIA la seguía teniendo vigente: el recordatorio le
    // habría dicho «le esperamos» y habría ido al hospital para nada.
    it('🏥 excluye las citas que el hospital no tiene: alta sin entregar o caso abierto, en la consulta', async () => {
      const { service, prisma } = build({
        casosSinCitaEnElHospital: [
          { appointmentId: 'apt-deriva' },
          { appointmentId: null },
        ],
        altasSinEntregar: [
          { entityId: 'apt-rendida' },
          { entityId: 'apt-deriva' },
        ],
      });
      await service.runOnce();

      const consultas = prisma.syncException.findMany.mock.calls.map(
        (c) => (c as unknown as [{ where: Record<string, unknown> }])[0].where,
      );
      expect(consultas).toContainEqual({
        kind: { in: ['CITA_NO_ENTREGADA', 'DERIVA_EN_HIS'] },
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        appointmentId: { not: null },
      });
      expect(prisma.syncOutbox.findMany).toHaveBeenCalledWith({
        where: {
          entityType: 'APPOINTMENT',
          op: 'INSERT',
          origin: { not: 'MIRROR' },
          deliveredAt: null,
        },
        select: { entityId: true },
      });
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where.id).toEqual({ notIn: ['apt-deriva', 'apt-rendida'] });
      // Se suma a los demás filtros, no los reemplaza.
      expect(where.status).toBe('SCHEDULED');
      expect(where.patient).toEqual({ remindersOptOut: false });
    });

    it('🏥 sin citas que falten en el hospital, la consulta queda como antes', async () => {
      const { service, prisma } = build();
      await service.runOnce();
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where.id).toBeUndefined();
    });

    it('🏥 si esa consulta falla, los recordatorios siguen (no se frena ninguno)', async () => {
      const { service, prisma } = build();
      prisma.syncOutbox.findMany.mockRejectedValueOnce(new Error('base caída'));
      jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);
      await service.runOnce();
      expect(prisma.appointment.findMany).toHaveBeenCalled();
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where.id).toBeUndefined();
    });

    // 🗓️ 2026-10-29: el hospital crea citas «temporales» fuera de los turnos para
    // guardar cupos de Nueva EPS que maneja a mano, a nombre de personas al azar.
    it('🗓️ excluye las citas del hospital que nacieron fuera del turno (marca del espejo)', async () => {
      const { service, prisma } = build({
        fueraDeTurno: [{ id: 'apt-reserva' }],
      });
      await service.runOnce();

      const consulta = prisma.appointment.findMany.mock.calls
        .map(
          (c) =>
            (c as unknown as [{ where: Record<string, unknown> }])[0].where,
        )
        .find((w) => w.metaLog);
      expect(consulta).toEqual({
        status: 'SCHEDULED',
        origin: 'MIRROR',
        reminderSentAt: null,
        metaLog: { path: ['fueraDeTurno'], equals: true },
      });
      const elegibles = prisma.appointment.findMany.mock.calls
        .map((c) => (c as unknown as [{ where: Record<string, any> }])[0].where)
        .find((w) => !w.metaLog)!;
      expect(elegibles.id).toEqual({ notIn: ['apt-reserva'] });
    });

    // 🗓️ Una cita en un día u hora que el hospital quitó DESPUÉS sí recibe el
    // recordatorio: el hospital borra el turno de un día lleno para cerrar la
    // agenda, y sus citas son reales (2026-10-29, la Dra. Osorio).
    it('🗓️ un caso «agenda quitada» abierto ya NO frena el recordatorio', async () => {
      const { service, prisma } = build();
      await service.runOnce();
      const kinds = prisma.syncException.findMany.mock.calls
        .map(
          (c) =>
            (c as unknown as [{ where: { kind?: { in?: string[] } } }])[0].where
              .kind?.in,
        )
        .filter(Boolean)
        .flat();
      expect(kinds).not.toContain('CITA_EN_AGENDA_QUITADA');
    });

    it('🩺 solo citas de médicos con «WhatsApp ON»: lo demás que trae el hospital no se recuerda (y no se marca)', async () => {
      const { service, prisma } = build();
      await service.runOnce();
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      // En la CONSULTA: una cita de odontología ni se envía ni queda marcada.
      expect(where.scheduleSlot.doctor).toEqual({
        whatsappBookingEnabled: true,
      });
      expect(where.scheduleSlot.startTime.gt).toBeInstanceOf(Date);
    });

    it('🩺 y solo de servicios activos: hipertensos o lectura de exámenes del mismo médico no se recuerdan', async () => {
      const { service, prisma } = build();
      await service.runOnce();
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where.scheduleSlot.service).toEqual({ isActive: true });
    });

    it('☎️ sin casos abiertos la consulta no lleva filtro por paciente', async () => {
      const { service, prisma } = build();
      await service.runOnce();
      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      expect(where).not.toHaveProperty('patientId');
    });

    it('🔕 excluye a las clínicas que apagaron los recordatorios, en la consulta de cada vuelta', async () => {
      const { service, prisma } = build();
      await service.runOnce();
      await service.runOnce();

      // Se lee en CADA vuelta: prender o apagar surte efecto sin reiniciar. (Sin
      // contar la consulta de las citas del hospital fuera del turno.)
      const elegibles = (
        prisma.appointment.findMany.mock.calls as unknown as [
          { where: Record<string, any> },
        ][]
      ).filter((c) => !c[0].where.metaLog);
      expect(elegibles).toHaveLength(2);
      for (const call of elegibles) {
        // Sin fila de settings cuenta como prendido (el default de la columna).
        expect(call[0].where.organization).toEqual({
          OR: [
            { settings: { is: null } },
            { settings: { is: { remindersEnabled: true } } },
          ],
        });
      }
    });

    it('💬 «solo a quien agendó él mismo»: con la opción encendida, solo citas del chat; apagada o sin settings, todas', async () => {
      const { service, prisma } = build();
      await service.runOnce();

      const where = (
        llamadaElegibles(prisma) as unknown as [{ where: Record<string, any> }]
      )[0].where;
      // También en la CONSULTA: las que excluye no quedan marcadas como
      // recordadas, y apagar la opción las devuelve al recordatorio.
      expect(where.OR).toEqual([
        { origin: { in: ['WHATSAPP', 'TELEGRAM'] } },
        {
          organization: {
            OR: [
              { settings: { is: null } },
              { settings: { is: { remindersOnlySelfBooked: false } } },
            ],
          },
        },
      ]);
      // No reemplaza ni relaja los demás filtros: se suma a ellos.
      expect(where.status).toBe('SCHEDULED');
      expect(where.reminderSentAt).toBeNull();
      expect(where.patient).toEqual({ remindersOptOut: false });
      expect(where.organization).toEqual({
        OR: [
          { settings: { is: null } },
          { settings: { is: { remindersEnabled: true } } },
        ],
      });
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
        tooClose: 0,
        yaConfirmadas: 0,
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
        tooClose: 0,
        yaConfirmadas: 0,
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

      expect(r).toEqual({
        sent: 2,
        failed: 1,
        skipped: 0,
        tooClose: 0,
        yaConfirmadas: 0,
      });
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
        tooClose: 0,
        yaConfirmadas: 0,
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

    it.each(['FORMAL', 'INFORMAL'])(
      '🔒 %s: con cancelar y cambiar apagados remite al hospital, no al bot',
      async (estilo) => {
        const { service, chatbot } = build({
          eligibles: [
            cita({
              organization: {
                id: ORG,
                name: 'Hospital San Vicente',
                supportPhone: '6068538838',
                settings: { cancelEnabled: false, rescheduleEnabled: false },
              },
            }),
          ],
          estilo,
        });
        await service.runOnce();

        const texto = textoEnviado(chatbot);
        expect(texto).not.toContain('*cancelar cita*');
        expect(texto).not.toContain('*cambiar cita*');
        expect(texto).toContain('el hospital al *6068538838*');
      },
    );

    // Cada operación tiene su interruptor: el recordatorio ofrece por el bot
    // solo la que está prendida y remite al hospital para la otra.
    it.each([
      ['FORMAL', true, true],
      ['FORMAL', true, false],
      ['FORMAL', false, true],
      ['INFORMAL', true, true],
      ['INFORMAL', true, false],
      ['INFORMAL', false, true],
    ])(
      '%s: cancelar=%s, cambiar=%s → ofrece por el bot solo lo prendido',
      async (estilo, cancelEnabled, rescheduleEnabled) => {
        const { service, chatbot } = build({
          eligibles: [
            cita({
              organization: {
                id: ORG,
                name: 'Hospital San Vicente',
                supportPhone: '6068538838',
                settings: { cancelEnabled, rescheduleEnabled },
              },
            }),
          ],
          estilo,
        });
        await service.runOnce();

        const texto = textoEnviado(chatbot);
        expect(texto.includes('*cancelar cita*')).toBe(cancelEnabled);
        expect(texto.includes('*cambiar cita*')).toBe(rescheduleEnabled);
        // Lo que no se puede por el bot, con el hospital.
        expect(texto.includes('el hospital al *6068538838*')).toBe(
          !(cancelEnabled && rescheduleEnabled),
        );
      },
    );

    it('🚪 con espejo y el envío de citas nuevas apagado, cancelar y cambiar se ofrecen con su interruptor (2026-10-15)', async () => {
      const { service, chatbot } = build({
        eligibles: [
          cita({
            organization: {
              id: ORG,
              name: 'Hospital San Vicente',
              supportPhone: '6068538838',
              settings: { cancelEnabled: true, rescheduleEnabled: false },
              hospitalMirrorConfig: { enabled: true, pushEnabled: false },
            },
          }),
        ],
      });
      await service.runOnce();

      const texto = textoEnviado(chatbot);
      expect(texto).toContain('*cancelar cita*');
      expect(texto).not.toContain('*cambiar cita*');
      expect(texto).toContain('el hospital al *6068538838*');
    });

    it('🚪 con espejo, sin fila de settings no se ofrece nada: la compuerta hacia el hospital falla cerrada', async () => {
      const { service, chatbot } = build({
        eligibles: [
          cita({
            organization: {
              id: ORG,
              name: 'Hospital San Vicente',
              supportPhone: '6068538838',
              settings: null,
              hospitalMirrorConfig: { enabled: true, pushEnabled: true },
            },
          }),
        ],
      });
      await service.runOnce();

      const texto = textoEnviado(chatbot);
      expect(texto).not.toContain('*cancelar cita*');
      expect(texto).not.toContain('*cambiar cita*');
    });

    it('🏥 con espejo y el envío al hospital encendido sí lo ofrece', async () => {
      const { service, chatbot } = build({
        eligibles: [
          cita({
            organization: {
              id: ORG,
              name: 'Hospital San Vicente',
              settings: { cancelEnabled: true, rescheduleEnabled: false },
              hospitalMirrorConfig: { enabled: true, pushEnabled: true },
            },
          }),
        ],
      });
      await service.runOnce();

      expect(textoEnviado(chatbot)).toContain('*cancelar cita*');
    });

    // 🐛 El saludo estaba fijo en «Buenos días». El cron corre cada 15 min, y
    // en la campaña E2E del 2026-09-22 llegó un recordatorio a las 2:21 p. m.
    // dando los buenos días. Es la primera línea que lee el paciente.
    it.each([
      ['2026-09-22T14:00:00Z', '09:00 en Bogotá', 'Buenos días'],
      ['2026-09-22T19:21:00Z', '02:21 p. m. en Bogotá', 'Buenas tardes'],
      ['2026-09-23T01:00:00Z', '08:00 p. m. en Bogotá', 'Buenas noches'],
    ])('a las %s (%s) saluda «%s»', async (ahoraIso, _local, saludo) => {
      jest.useFakeTimers().setSystemTime(new Date(ahoraIso));
      try {
        // La cita, un día después de «ahora»: lejos de la anticipación mínima.
        const { service, chatbot } = build({
          eligibles: [
            cita({
              scheduleSlot: {
                ...cita().scheduleSlot,
                startTime: new Date(Date.parse(ahoraIso) + 86_400_000),
              },
            }),
          ],
        });
        await service.runOnce();
        expect(textoEnviado(chatbot).startsWith(saludo)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
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
      expect(texto).toContain('su hospital');
    });
  });

  describe('sendManualForAppointment (botón del dashboard)', () => {
    /** Un ORG_ADMIN no queda acotado: es el actor de los ejemplos que ya existían. */
    const ADMIN = { userId: 'u-admin', role: 'ORG_ADMIN' };
    it('🩺 una cita de un médico sin «WhatsApp ON» (p. ej. odontología) no se recuerda ni a mano', async () => {
      const { service, prisma, chatbot, templates } = build();
      prisma.appointment.findFirst.mockResolvedValue(
        cita({
          scheduleSlot: {
            startTime: new Date('2026-09-01T14:00:00.000Z'),
            doctor: { fullName: 'Dr. Muela', whatsappBookingEnabled: false },
            service: { name: 'CITA ODONTOLOGICA' },
          },
        }),
      );

      const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

      expect(r).toMatchObject({ success: false, outcome: 'skipped' });
      expect(r.error).toMatch(/WhatsApp ON/);
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('🩺 una cita de un servicio inactivo (p. ej. hipertensos) no se recuerda ni a mano', async () => {
      const { service, prisma, chatbot, templates } = build();
      prisma.appointment.findFirst.mockResolvedValue(
        cita({
          scheduleSlot: {
            startTime: new Date('2026-09-01T14:00:00.000Z'),
            doctor: { fullName: 'MDD2', whatsappBookingEnabled: true },
            service: {
              name: 'Consulta ambularoria control hipertensos',
              isActive: false,
            },
          },
        }),
      );

      const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

      expect(r).toMatchObject({ success: false, outcome: 'skipped' });
      expect(r.error).toMatch(/servicio de esta cita no está activo/);
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('envía y devuelve el reminderSentAt ya actualizado', async () => {
      const { service, prisma, systemLog } = build();
      prisma.appointment.findFirst.mockResolvedValue(cita());

      const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

      expect(r.success).toBe(true);
      expect(r.outcome).toBe('sent');
      expect(r.appointment?.reminderSentAt).toBeInstanceOf(Date);
      expect(systemLog.event).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REMINDER_MANUAL_SENT' }),
      );
    });

    // ══════════════════════════════════════════════════════════════════
    // §12 #10b: este endpoint aplicaba solo ROL y TENANT. Un agente acotado a
    // una EPS o a un médico podía mandarle un WhatsApp al paciente de cualquier
    // otro llamándolo directo con su token, saltándose la pantalla. La regla es
    // la misma que aplica la web (`citaFueraDeAlcance`, en @agenia/shared).
    // ══════════════════════════════════════════════════════════════════
    describe('🎯 el alcance del actor, también aquí', () => {
      const conCita = () => {
        const ctx = build();
        ctx.prisma.appointment.findFirst.mockResolvedValue(
          cita({
            epsId: 'eps-1',
            scheduleSlot: {
              startTime: new Date('2026-09-01T14:00:00.000Z'),
              doctorId: 'doc-1',
              doctor: { fullName: 'Dr. Ruiz' },
              service: { name: 'Cardiología' },
            },
          }),
        );
        return ctx;
      };

      it('un agente acotado a OTRA EPS no manda el recordatorio', async () => {
        const { service, prisma, chatbot } = conCita();
        prisma.agentProfile.findUnique.mockResolvedValue({
          epsId: 'eps-9',
          doctorId: null,
        });

        const r = await service.sendManualForAppointment('apt-1', ORG, {
          userId: 'u-1',
          role: 'BOOKING_AGENT',
        });

        expect(r).toMatchObject({ success: false, outcome: 'skipped' });
        expect(r.error).toContain('fuera de su alcance');
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      });

      it('un agente acotado a OTRO médico tampoco', async () => {
        const { service, prisma, chatbot } = conCita();
        prisma.agentProfile.findUnique.mockResolvedValue({
          epsId: null,
          doctorId: 'doc-9',
        });

        const r = await service.sendManualForAppointment('apt-1', ORG, {
          userId: 'u-1',
          role: 'BOOKING_AGENT',
        });

        expect(r.success).toBe(false);
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      });

      it('dentro de su alcance, sí', async () => {
        const { service, prisma } = conCita();
        prisma.agentProfile.findUnique.mockResolvedValue({
          epsId: 'eps-1',
          doctorId: 'doc-1',
        });

        const r = await service.sendManualForAppointment('apt-1', ORG, {
          userId: 'u-1',
          role: 'BOOKING_AGENT',
        });

        expect(r.success).toBe(true);
      });

      it('un DOCTOR queda acotado a SU agenda', async () => {
        const { service, prisma, chatbot } = conCita();
        prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doc-9' });

        const ajena = await service.sendManualForAppointment('apt-1', ORG, {
          userId: 'u-2',
          role: 'DOCTOR',
        });
        expect(ajena.success).toBe(false);
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();

        prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doc-1' });
        const suya = await service.sendManualForAppointment('apt-1', ORG, {
          userId: 'u-2',
          role: 'DOCTOR',
        });
        expect(suya.success).toBe(true);
      });

      it('un ORG_ADMIN no queda acotado y ni siquiera lee perfiles', async () => {
        const { service, prisma } = conCita();

        const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

        expect(r.success).toBe(true);
        expect(prisma.agentProfile.findUnique).not.toHaveBeenCalled();
        expect(prisma.doctorProfile.findUnique).not.toHaveBeenCalled();
      });

      it('💥 si el perfil no se puede leer, NO se envía (falla cerrado)', async () => {
        const { service, prisma, chatbot } = conCita();
        prisma.agentProfile.findUnique.mockRejectedValue(new Error('db caída'));

        const r = await service.sendManualForAppointment('apt-1', ORG, {
          userId: 'u-1',
          role: 'BOOKING_AGENT',
        });

        expect(r.success).toBe(false);
        expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      });
    });

    it('🏢 la cita se busca acotada a la clínica que la pide', async () => {
      const { service, prisma } = build();
      await service.sendManualForAppointment('apt-1', ORG, ADMIN);

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-1', organizationId: ORG },
        }),
      );
    });

    it('una cita de otra clínica (o inexistente) se rechaza sin enviar nada', async () => {
      const { service, chatbot } = build();

      const r = await service.sendManualForAppointment('apt-ajena', ORG, ADMIN);

      expect(r).toMatchObject({ success: false, outcome: 'skipped' });
      expect(r.error).toContain('no pertenece');
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    });

    it.each(['CANCELLED', 'COMPLETED'])(
      'no se recuerda una cita en estado %s',
      async (status) => {
        const { service, prisma, chatbot } = build();
        prisma.appointment.findFirst.mockResolvedValue(cita({ status }));

        const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

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

      const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

      expect(r).toMatchObject({ success: false, outcome: 'skipped' });
      expect(r.error).toContain('WhatsApp');
    });

    it('un envío rechazado por Meta se reporta como fallo accionable', async () => {
      const { service, prisma } = build({
        envio: { success: false, error: '401' },
      });
      prisma.appointment.findFirst.mockResolvedValue(cita());

      const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

      expect(r).toMatchObject({ success: false, outcome: 'failed' });
      expect(r.error).toContain('credenciales');
    });

    it('el reenvío manual SÍ se permite aunque ya se hubiera enviado', async () => {
      const { service, prisma } = build();
      prisma.appointment.findFirst.mockResolvedValue(
        cita({ reminderSentAt: new Date('2026-08-30T00:00:00Z') }),
      );

      const r = await service.sendManualForAppointment('apt-1', ORG, ADMIN);

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
      // El primero lee antes los casos de «teléfono equivocado»: se le deja
      // llegar a la consulta de citas, donde se queda esperando.
      await new Promise((r) => setImmediate(r));

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

/**
 * 🚨 Alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md, Fase 2): el grupo técnico
 * se entera si los recordatorios no están saliendo o si el cron revienta; un
 * número sin WhatsApp no es una caída.
 */
describe('AppointmentReminderCronService — alertas técnicas', () => {
  const montar = () => {
    const alertas = {
      avisar: jest.fn(async () => undefined),
      resolver: jest.fn(async () => undefined),
      cronFallo: jest.fn(async () => undefined),
      cronBien: jest.fn(async () => undefined),
    };
    const service = new AppointmentReminderCronService(
      { get: jest.fn(() => undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { log: jest.fn() } as any,
      {} as any,
      { addInterval: jest.fn(), deleteInterval: jest.fn() } as any,
      alertas as any,
    );
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    const lote = (sent: number, failed: number) =>
      jest
        .spyOn(service, 'runOnce')
        .mockResolvedValue({ sent, failed, skipped: 0, tooClose: 0 });
    return { service, alertas, lote };
  };

  it('ninguno salió y fallaron varios → «los recordatorios no están saliendo»', async () => {
    const { service, alertas, lote } = montar();
    lote(0, 4);
    await service.ejecutarLote();
    expect(alertas.cronBien).toHaveBeenCalledWith('recordatorios');
    expect(alertas.avisar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RECORDATORIOS_FALLIDOS',
        dedupeKey: 'cron:recordatorios:lote',
        detail: expect.stringContaining('fallaron 4 y no salió ninguno'),
      }),
    );
  });

  it('un fallo suelto no es una caída; un lote con envíos resuelve', async () => {
    const { service, alertas, lote } = montar();
    lote(0, 1);
    await service.ejecutarLote();
    expect(alertas.avisar).not.toHaveBeenCalled();
    expect(alertas.resolver).not.toHaveBeenCalled();
    lote(5, 1);
    await service.ejecutarLote();
    expect(alertas.resolver).toHaveBeenCalledWith('cron:recordatorios:lote');
  });

  it('si el cron revienta, se avisa y no se propaga', async () => {
    const { service, alertas } = montar();
    jest
      .spyOn(service, 'runOnce')
      .mockRejectedValue(new Error('timeout de Prisma'));
    await expect(service.ejecutarLote()).resolves.toBeUndefined();
    expect(alertas.cronFallo).toHaveBeenCalledWith(
      'recordatorios',
      'Recordatorios de citas',
      expect.any(Error),
    );
    expect(alertas.cronBien).not.toHaveBeenCalled();
  });
});

describe('confirmadaPorElChatDentroDeLaVentana', () => {
  const inicio = new Date('2026-10-27T17:00:00.000Z'); // martes 12:00 en Bogotá
  const apt = (origin: string | null, createdAt: string | null) => ({
    origin,
    createdAt: createdAt ? new Date(createdAt) : null,
    scheduleSlot: { startTime: inicio },
  });

  it('agendada por WhatsApp minutos antes → sí', () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(
        apt('WHATSAPP', '2026-10-27T13:00:00.000Z'),
        24,
      ),
    ).toBe(true);
  });

  it('agendada el lunes a la misma hora → justo en el borde de 24 h hábiles → sí', () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(
        apt('WHATSAPP', '2026-10-26T17:00:00.000Z'),
        24,
      ),
    ).toBe(true);
  });

  it('agendada el viernes para el martes → no (el fin de semana no cuenta y quedan más de 24 h hábiles)', () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(
        apt('WHATSAPP', '2026-10-23T17:00:00.000Z'),
        24,
      ),
    ).toBe(false);
  });

  it('del hospital, del panel o sin origen → no', () => {
    for (const origin of ['MIRROR', 'MANUAL', null]) {
      expect(
        confirmadaPorElChatDentroDeLaVentana(
          apt(origin, '2026-10-27T13:00:00.000Z'),
          24,
        ),
      ).toBe(false);
    }
  });

  it('sin fecha de creación → no', () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(apt('WHATSAPP', null), 24),
    ).toBe(false);
  });

  // 2026-10-28: agendadas con 24 a 26 horas, el recordatorio llegaba entre 12
  // minutos y 2 horas después de la confirmación.
  it('agendada 26 horas antes → sí: el recordatorio llegaría 2 horas después de la confirmación', () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(
        apt('WHATSAPP', '2026-10-26T15:00:00.000Z'), // lunes 10:00
        24,
      ),
    ).toBe(true);
  });

  it(`agendada justo ${24 + HORAS_ENTRE_CONFIRMACION_Y_RECORDATORIO} horas hábiles antes → sí (el borde)`, () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(
        apt('WHATSAPP', '2026-10-26T05:00:00.000Z'), // lunes 00:00
        24,
      ),
    ).toBe(true);
  });

  it('agendada el viernes a las 6 p. m. para el martes al mediodía → no: el recordatorio sale el lunes', () => {
    expect(
      confirmadaPorElChatDentroDeLaVentana(
        apt('WHATSAPP', '2026-10-23T23:00:00.000Z'),
        24,
      ),
    ).toBe(false);
  });
});
