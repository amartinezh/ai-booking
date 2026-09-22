import {
  HisConfirmationService,
  MSG_CONFIRMACION,
} from './his-confirmation.service';

/**
 * Confirmar al paciente una cita que agendó el hospital (rastreo, escenario B, §12 #7).
 * Escrito del lado de lo que podría salir mal:
 *  · mandarle un dato de salud a quien no es (número del body, paciente de otra clínica);
 *  · confirmar algo que no es una cita del hospital (cupo libre, cita de AgenIA, pasada);
 *  · saltarse el alcance de un agente acotado;
 *  · fuera de la ventana de 24 h, intentar texto libre (Meta lo rechaza en silencio).
 */
describe('HisConfirmationService', () => {
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

  describe('✅ el caso bueno', () => {
    it('dentro de la ventana de 24 h: sale como TEXTO, al WhatsApp del paciente, con los datos del cupo', async () => {
      const { service, chatbot, templates } = build();

      await expect(enviar(service)).resolves.toEqual({
        success: true,
        via: 'TEXTO',
      });

      expect(templates.sendTemplate).not.toHaveBeenCalled();
      const [org, destino, texto, ctx] = chatbot.sendOutboundForOrg.mock
        .calls[0] as [string, string, string, unknown];
      expect(org).toBe(ORG);
      expect(destino).toBe('573001112233');
      expect(ctx).toEqual({ kind: 'BOOKING_CONFIRMATION' });
      expect(texto).toMatch(/Hola María/);
      expect(texto).toMatch(/Medicina general/);
      expect(texto).toMatch(/Dr\(a\)\. Ana Ruiz/);
      // 13:00 UTC = 8:00 a. m. en Bogotá.
      expect(texto).toMatch(/08:00|8:00/);
      // El bot no conoce esta cita: no se le invita a cancelarla por el bot.
      expect(texto).not.toMatch(/cancelar cita/i);
      expect(texto).toMatch(/comuníquese con el hospital/);
    });

    it('fuera de la ventana: sale con la PLANTILLA de confirmación y sus cuatro variables', async () => {
      const { service, chatbot, templates } = build({ dentroDeVentana: false });

      await expect(enviar(service)).resolves.toEqual({
        success: true,
        via: 'PLANTILLA',
      });

      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      const arg = templates.sendTemplate.mock.calls[0][0] as {
        organizationId: string;
        recipientId: string;
        kind: string;
        bodyParams: string[];
      };
      expect(arg).toMatchObject({
        organizationId: ORG,
        recipientId: '573001112233',
        kind: 'HIS_APPOINTMENT_CONFIRMATION',
      });
      expect(arg.bodyParams).toHaveLength(4);
      expect(arg.bodyParams.slice(0, 3)).toEqual([
        'María',
        'Medicina general',
        'Dr(a). Ana Ruiz',
      ]);
    });

    it('el BSUID manda sobre el teléfono, como en los recordatorios', async () => {
      const { service, chatbot } = build({
        paciente: paciente({ bsuid: 'CO.123' }),
      });
      await enviar(service);
      expect(chatbot.sendOutboundForOrg.mock.calls[0][1]).toBe('CO.123');
    });

    it('queda en la conversación del paciente y en la bitácora del sistema, con quién y cómo se verificó', async () => {
      const { service, interactionLog, systemLog } = build();
      await enviar(service, { verificacion: 'FUNCIONARIO' });

      expect(interactionLog.log.mock.calls[0][0]).toMatchObject({
        whatsappId: '573001112233',
        organizationId: ORG,
        status: 'OUTBOUND',
        patientUserId: 'user-pac-1',
        metadata: {
          tipo: 'CONFIRMACION_CITA_HIS',
          via: 'TEXTO',
          scheduleSlotId: 'slot-1',
        },
      });
      expect(systemLog.event.mock.calls[0][0]).toMatchObject({
        action: 'HIS_CONFIRMATION_SENT',
        organizationId: ORG,
        userId: 'u-admin',
        metadata: {
          verificacion: 'FUNCIONARIO',
          patientId: 'pac-1',
          actorRole: 'ORG_ADMIN',
        },
      });
    });
  });

  describe('🔒 a quién y de qué clínica', () => {
    it('el cupo y el paciente se buscan DENTRO de la clínica del token', async () => {
      const { service, prisma } = build();
      await enviar(service);
      expect(prisma.scheduleSlot.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'slot-1', organizationId: ORG },
      });
      expect(prisma.patientProfile.findFirst.mock.calls[0][0]).toMatchObject({
        where: { id: 'pac-1', organizationId: ORG },
      });
    });

    it('un paciente de otra clínica (no aparece) no recibe nada', async () => {
      const { service, chatbot, templates } = build({ paciente: null });
      await expect(enviar(service)).resolves.toEqual({
        success: false,
        error: MSG_CONFIRMACION.paciente,
      });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    });

    it('sin WhatsApp conocido NO se envía: nunca a un número escrito en pantalla', async () => {
      const { service, chatbot } = build({
        paciente: paciente({ whatsappId: null, bsuid: null }),
      });
      await expect(enviar(service, { to: '573009999999' })).resolves.toEqual({
        success: false,
        error: MSG_CONFIRMACION.sinWhatsapp,
      });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    });
  });

  describe('solo el escenario B: un cupo que el hospital ocupó y AgenIA no tiene', () => {
    it.each([
      [
        'el cupo no existe (u otra clínica)',
        { cupo: null },
        MSG_CONFIRMACION.cupo,
      ],
      [
        'la cita ya pasó',
        { cupo: cupo({ startTime: new Date('2026-09-23T14:00:00.000Z') }) },
        MSG_CONFIRMACION.pasada,
      ],
      [
        'el cupo está LIBRE en AgenIA (no hay cita del hospital)',
        { cupo: cupo({ isAvailable: true }) },
        MSG_CONFIRMACION.libre,
      ],
      [
        'el cupo tiene una cita de AgenIA (el bot ya la muestra)',
        { cupo: cupo({ appointments: [{ id: 'apt-1' }] }) },
        MSG_CONFIRMACION.conCita,
      ],
    ])('%s → no se envía', async (_n, opts, error) => {
      const { service, chatbot, templates, redis } = build(opts as never);
      await expect(enviar(service)).resolves.toEqual({ success: false, error });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('una cita CANCELADA del cupo no cuenta como «AgenIA la tiene»', async () => {
      const { service, prisma } = build();
      await enviar(service);
      expect(prisma.scheduleSlot.findFirst.mock.calls[0][0]).toMatchObject({
        select: { appointments: { where: { status: { not: 'CANCELLED' } } } },
      });
    });
  });

  describe('lo que pide la entrada', () => {
    it.each([
      [{ scheduleSlotId: undefined }, MSG_CONFIRMACION.datos],
      [{ patientId: 42 }, MSG_CONFIRMACION.datos],
      [{ verificacion: undefined }, MSG_CONFIRMACION.verificacion],
      [
        { verificacion: 'CONFIO_EN_EL_PACIENTE' },
        MSG_CONFIRMACION.verificacion,
      ],
    ])('%j → %s', async (over, error) => {
      const { service, prisma } = build();
      await expect(enviar(service, over)).resolves.toEqual({
        success: false,
        error,
      });
      expect(prisma.scheduleSlot.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('alcance del agente', () => {
    it('un BOOKING_AGENT de OTRA EPS no confirma (la EPS es la del paciente)', async () => {
      const { service, chatbot } = build({
        agente: { epsId: 'eps-OTRA', doctorId: null },
      });
      await expect(
        enviar(service, { actor: { userId: 'u-ag', role: 'BOOKING_AGENT' } }),
      ).resolves.toEqual({ success: false, error: MSG_CONFIRMACION.alcance });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    });

    it('un BOOKING_AGENT de SU EPS sí', async () => {
      const { service } = build({ agente: { epsId: 'eps-1', doctorId: null } });
      await expect(
        enviar(service, { actor: { userId: 'u-ag', role: 'BOOKING_AGENT' } }),
      ).resolves.toMatchObject({ success: true });
    });

    it('un agente acotado a una EPS y un paciente SIN EPS: fuera (falla cerrado)', async () => {
      const { service } = build({
        agente: { epsId: 'eps-1', doctorId: null },
        paciente: paciente({ epsId: null }),
      });
      await expect(
        enviar(service, { actor: { userId: 'u-ag', role: 'BOOKING_AGENT' } }),
      ).resolves.toEqual({ success: false, error: MSG_CONFIRMACION.alcance });
    });
  });

  describe('antirrepetición y fallos', () => {
    it('una segunda confirmación del mismo cupo y paciente en 10 min no sale', async () => {
      const { service, chatbot, redis } = build({ reserva: null });
      await expect(enviar(service)).resolves.toEqual({
        success: false,
        error: MSG_CONFIRMACION.repetida,
      });
      expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(redis.set.mock.calls[0]).toEqual([
        `his-confirm:${ORG}:slot-1:pac-1`,
        '1',
        'EX',
        600,
        'NX',
      ]);
    });

    it('si Redis no responde, no bloquea el envío (no es un control de seguridad)', async () => {
      const { service } = build({ reserva: new Error('redis caído') });
      await expect(enviar(service)).resolves.toMatchObject({ success: true });
    });

    it('fuera de la ventana y SIN plantilla: lo dice claro, libera el candado y no deja constancia de envío', async () => {
      const { service, redis, interactionLog, systemLog } = build({
        dentroDeVentana: false,
        envio: { success: false, error: 'template-not-configured' },
      });
      await expect(enviar(service)).resolves.toEqual({
        success: false,
        error: MSG_CONFIRMACION.sinPlantilla,
      });
      expect(redis.del).toHaveBeenCalledWith(`his-confirm:${ORG}:slot-1:pac-1`);
      expect(interactionLog.log).not.toHaveBeenCalled();
      expect(systemLog.event).not.toHaveBeenCalled();
    });

    it('Meta rechaza: mensaje genérico y se puede reintentar enseguida', async () => {
      const { service, redis } = build({
        envio: { success: false, error: 'meta-api-error' },
      });
      await expect(enviar(service)).resolves.toEqual({
        success: false,
        error: MSG_CONFIRMACION.fallo,
      });
      expect(redis.del).toHaveBeenCalled();
    });

    it('una excepción al enviar no escapa: se trata como fallo', async () => {
      const { service, chatbot } = build();
      chatbot.sendOutboundForOrg.mockRejectedValueOnce(new Error('timeout'));
      await expect(enviar(service)).resolves.toEqual({
        success: false,
        error: MSG_CONFIRMACION.fallo,
      });
    });
  });
});
