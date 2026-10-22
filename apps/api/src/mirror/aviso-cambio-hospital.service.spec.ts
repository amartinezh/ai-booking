import { AvisoCambioHospitalService } from './aviso-cambio-hospital.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { OrganizationSettingsService } from '../chatbot/organization-settings.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';

/**
 * 🏥 El hospital cancela o cambia una cita que el paciente agendó con el asistente
 * (2026-10-22: a una paciente le anularon la cita y nadie le avisó).
 */
const ORG = 'org-1';
const AHORA = new Date('2026-10-22T16:47:00.000Z'); // 11:47 en Bogotá
const EN_2H = new Date('2026-10-22T20:20:00.000Z'); // 15:20 en Bogotá
const MANANA = new Date('2026-10-23T14:00:00.000Z'); // 9:00 en Bogotá

const cita = (over: Record<string, any> = {}) => ({
  id: 'apt-bot',
  origin: 'WHATSAPP',
  epsId: 'eps-sura',
  patientId: 'pat-1',
  patient: {
    id: 'pat-1',
    userId: 'user-1',
    fullName: 'VICTORIA SANCHEZ ZAMORANO',
    whatsappId: '573001112233',
    bsuid: null,
    telegramChatId: null,
    telegramBlockedAt: null,
  },
  scheduleSlot: {
    startTime: EN_2H,
    doctorId: 'doc-yulieth',
    doctor: {
      fullName: 'YULIETH ANDREA RIOS AGUIRRE',
      isFunctionalAgenda: false,
    },
    service: { name: 'Consulta ambulatoria de medicina general' },
  },
  ...over,
});

const nuevaCita = {
  ...cita({ id: 'apt-nueva', origin: 'MIRROR' }),
  scheduleSlot: {
    startTime: MANANA,
    doctorId: 'doc-daniela',
    doctor: {
      fullName: 'DANIELA CARDENAS CASTRILLON',
      isFunctionalAgenda: false,
    },
    service: { name: 'Consulta ambulatoria de medicina general' },
  },
};

function armar(
  opts: {
    cita?: any;
    nueva?: any;
    dentroDeVentana?: boolean;
    telefonoMarcado?: boolean;
    registro?: string;
    envio?: { success: boolean; error?: string };
    plantilla?: { success: boolean; error?: string };
    /** Quién agendó (remitente de la confirmación). */
    remitente?: string;
    /** Identificadores con la ventana de 24 h abierta (si se da, manda sobre `dentroDeVentana`). */
    ventanasAbiertas?: string[];
  } = {},
) {
  const prisma = {
    appointment: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(opts.cita === undefined ? cita() : opts.cita)
        .mockResolvedValueOnce(opts.nueva ?? null),
    },
    syncException: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.telefonoMarcado ? { id: 'caso-tel' } : null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    interactionLog: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.remitente ? { whatsappId: opts.remitente } : null,
        ),
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Hospital San Vicente de Paúl',
        supportPhone: '606 853 8860',
        timezone: 'America/Bogota',
      }),
    },
  };
  const exceptions = {
    registrar: jest.fn().mockResolvedValue(opts.registro ?? 'CREADA'),
  };
  const templates = {
    sendTemplate: jest
      .fn()
      .mockResolvedValue(opts.plantilla ?? { success: true }),
  };
  const chatbot = {
    isWithinServiceWindow: jest.fn(async (_org: string, id: string) =>
      opts.ventanasAbiertas
        ? opts.ventanasAbiertas.includes(id)
        : (opts.dentroDeVentana ?? true),
    ),
    sendOutboundForOrg: jest
      .fn()
      .mockResolvedValue(opts.envio ?? { success: true }),
  };
  const ajustes = {
    getCommunicationStyle: jest.fn().mockResolvedValue('FORMAL'),
    operacionesDelBot: jest
      .fn()
      .mockResolvedValue({ agendar: true, cancelar: true, modificar: true }),
  };
  const interactionLog = { log: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === ChatbotService) return chatbot;
      if (token === OrganizationSettingsService) return ajustes;
      if (token === InteractionLogService) return interactionLog;
      throw new Error('token inesperado');
    }),
  };
  const svc = new AvisoCambioHospitalService(
    prisma as any,
    exceptions as any,
    templates as any,
    moduleRef as any,
  );
  const correr = () => svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
  const caso = () => exceptions.registrar.mock.calls[0]?.[1];
  const final = () => prisma.syncException.updateMany.mock.calls[0]?.[0]?.data;
  const texto = () => chatbot.sendOutboundForOrg.mock.calls[0]?.[2] as string;
  return {
    svc,
    prisma,
    exceptions,
    templates,
    chatbot,
    interactionLog,
    correr,
    caso,
    final,
    texto,
  };
}

describe('AvisoCambioHospitalService — el hospital canceló una cita del asistente', () => {
  it('🧾 el caso de Victoria: dentro de las 24 h, se le avisa por WhatsApp y queda el caso', async () => {
    const t = armar();
    await t.correr();

    expect(t.caso()).toMatchObject({
      kind: 'CITA_CANCELADA_POR_HOSPITAL',
      dedupeKey: 'CAMBIO_HOSPITAL:apt-bot',
      appointmentId: 'apt-bot',
      patientId: 'pat-1',
      doctorId: 'doc-yulieth',
      epsId: 'eps-sura',
      appointmentStartAt: EN_2H,
      meta: { aviso: 'PENDIENTE' },
    });
    expect(t.chatbot.sendOutboundForOrg).toHaveBeenCalledWith(
      ORG,
      '573001112233',
      expect.any(String),
      { kind: 'SYSTEM_NOTICE', appointmentId: 'apt-bot' },
    );
    expect(t.texto()).toContain('Hola, Victoria.');
    expect(t.texto()).toContain('*Consulta ambulatoria de medicina general*');
    expect(t.texto()).toContain('Dr(a). YULIETH ANDREA RIOS AGUIRRE');
    expect(t.texto()).toContain('fue *cancelada* en el hospital');
    expect(t.texto()).toContain('el hospital al *606 853 8860*');
    expect(t.texto()).toContain('escribirme *agendar*');
    // A las 11:47 para una cita a las 15:20: menos de 4 horas → CRÍTICA.
    expect(t.final()).toMatchObject({
      severity: 'CRITICA',
      meta: {
        aviso: 'ENVIADO',
        canal: 'WHATSAPP',
        via: 'TEXTO',
        enviadoIso: AHORA.toISOString(),
      },
    });
    // Queda en la conversación del paciente.
    expect(t.interactionLog.log.mock.calls[0][0]).toMatchObject({
      whatsappId: '573001112233',
      metadata: {
        tipo: 'CITA_CANCELADA_POR_HOSPITAL',
        via: 'TEXTO',
        appointmentId: 'apt-bot',
      },
    });
  });

  it('con agendar apagado, no le ofrece escribir «agendar»', async () => {
    const t = armar();
    const ajustes = (t.svc as any).moduleRef.get(OrganizationSettingsService);
    ajustes.operacionesDelBot.mockResolvedValue({
      agendar: false,
      cancelar: true,
      modificar: true,
    });
    await t.correr();
    expect(t.texto()).not.toContain('agendar*');
  });

  it('fuera de las 24 h no hay plantilla para una cancelación: no se envía y el caso sube a ALTA', async () => {
    const t = armar({
      dentroDeVentana: false,
      cita: cita({
        scheduleSlot: {
          ...cita().scheduleSlot,
          startTime: new Date('2026-10-26T14:00:00Z'),
        },
      }),
    });
    await t.correr();
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      severity: 'ALTA',
      meta: {
        aviso: 'NO_ENVIADO',
        motivo: 'FUERA_DE_VENTANA',
        canal: 'WHATSAPP',
      },
    });
  });

  it('🧾 lo que pasó con Victoria: agendó un familiar; la ventana está abierta con SU teléfono y la ficha solo tiene el BSUID → se le escribe a ese teléfono', async () => {
    const t = armar({
      cita: cita({
        patient: {
          ...cita().patient,
          whatsappId: '573000001033',
          bsuid: 'CO.4096',
        },
      }),
      remitente: '573009999986',
      ventanasAbiertas: ['573009999986'],
    });
    await t.correr();
    // Se buscó quién agendó esta cita.
    expect(
      t.prisma.interactionLog.findFirst.mock.calls[0][0].where,
    ).toMatchObject({
      organizationId: ORG,
      status: 'BOOKING_CONFIRMED',
      metadata: { path: ['appointmentId'], equals: 'apt-bot' },
    });
    expect(t.chatbot.sendOutboundForOrg.mock.calls[0][1]).toBe('573009999986');
    expect(t.final()).toMatchObject({
      meta: { aviso: 'ENVIADO', via: 'TEXTO' },
    });
  });

  it('con la ventana abierta en el destino de siempre (el BSUID), va ahí', async () => {
    const t = armar({
      cita: cita({ patient: { ...cita().patient, bsuid: 'CO.4096' } }),
      remitente: '573009999986',
      ventanasAbiertas: ['CO.4096', '573009999986'],
    });
    await t.correr();
    expect(t.chatbot.sendOutboundForOrg.mock.calls[0][1]).toBe('CO.4096');
  });

  it('un número marcado como de otra persona no recibe nada', async () => {
    const t = armar({ telefonoMarcado: true });
    await t.correr();
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: { aviso: 'NO_ENVIADO', motivo: 'TELEFONO_EQUIVOCADO' },
    });
  });

  it('si el envío falla, el caso lo dice', async () => {
    const t = armar({ envio: { success: false, error: 'meta-131047' } });
    await t.correr();
    expect(t.final()).toMatchObject({
      meta: { aviso: 'NO_ENVIADO', motivo: 'FALLO', via: 'TEXTO' },
    });
  });

  it('✈️ una cita de Telegram se avisa por Telegram, sin ventana de 24 h', async () => {
    const t = armar({
      dentroDeVentana: false,
      cita: cita({
        origin: 'TELEGRAM',
        patient: {
          ...cita().patient,
          whatsappId: null,
          telegramChatId: '998877',
        },
      }),
    });
    await t.correr();
    expect(t.chatbot.isWithinServiceWindow).not.toHaveBeenCalled();
    expect(t.chatbot.sendOutboundForOrg.mock.calls[0][1]).toBe('tg:998877');
    expect(t.final()).toMatchObject({
      meta: { aviso: 'ENVIADO', canal: 'TELEGRAM' },
    });
  });

  describe('🔁 el hospital le dio otra cita: es un cambio de hora', () => {
    it('dentro de las 24 h: le dice la de antes y la nueva', async () => {
      const t = armar({ nueva: nuevaCita });
      await t.correr();
      expect(t.caso()).toMatchObject({
        kind: 'CITA_MOVIDA_POR_HOSPITAL',
        doctorId: 'doc-daniela',
        appointmentStartAt: MANANA,
        meta: { nuevaCitaId: 'apt-nueva', nuevaIso: MANANA.toISOString() },
      });
      expect(t.texto()).toContain('el hospital cambió su cita');
      expect(t.texto()).toContain('❌ Antes:');
      expect(t.texto()).toContain('✅ Ahora: *viernes, 23 de octubre');
      expect(t.texto()).toContain('Dr(a). DANIELA CARDENAS CASTRILLON');
      // La nueva es mañana: a menos de 24 h → ALTA aunque se avisó.
      expect(t.final().severity).toBe('ALTA');
    });

    it('la busca solo entre las del hospital, del mismo paciente, recientes y futuras', async () => {
      const t = armar({ nueva: nuevaCita });
      await t.correr();
      const where = t.prisma.appointment.findFirst.mock.calls[1][0].where;
      expect(where).toMatchObject({
        organizationId: ORG,
        patientId: 'pat-1',
        id: { not: 'apt-bot' },
        status: 'SCHEDULED',
        origin: 'MIRROR',
        scheduleSlot: { startTime: { gt: AHORA } },
      });
      expect(where.createdAt.gte.getTime()).toBe(AHORA.getTime() - 10 * 60_000);
    });

    it('fuera de las 24 h: la plantilla de confirmación de cita del hospital, con la hora NUEVA', async () => {
      const t = armar({ nueva: nuevaCita, dentroDeVentana: false });
      await t.correr();
      expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(t.templates.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          recipientId: '573001112233',
          kind: 'HIS_APPOINTMENT_CONFIRMATION',
          appointmentId: 'apt-bot',
          bodyParams: [
            'Victoria',
            'Consulta ambulatoria de medicina general',
            'Dr(a). DANIELA CARDENAS CASTRILLON',
            expect.stringMatching(/viernes/),
          ],
        }),
      );
      expect(t.final()).toMatchObject({
        meta: { aviso: 'ENVIADO', via: 'PLANTILLA' },
      });
    });

    it('sin la plantilla registrada, el caso lo dice', async () => {
      const t = armar({
        nueva: nuevaCita,
        dentroDeVentana: false,
        plantilla: { success: false, error: 'template-not-configured' },
      });
      await t.correr();
      expect(t.final()).toMatchObject({
        meta: { aviso: 'NO_ENVIADO', motivo: 'SIN_PLANTILLA' },
      });
    });
  });

  describe('lo que NO se toca', () => {
    it('una cita que nació en el hospital: ni aviso ni caso (la maneja el personal)', async () => {
      const t = armar({ cita: cita({ origin: 'MIRROR' }) });
      await t.correr();
      expect(t.exceptions.registrar).not.toHaveBeenCalled();
      expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    });

    it('una cita del panel (MANUAL): tampoco', async () => {
      const t = armar({ cita: cita({ origin: 'MANUAL' }) });
      await t.correr();
      expect(t.exceptions.registrar).not.toHaveBeenCalled();
    });

    it('una cita cuya hora ya pasó: nada', async () => {
      const t = armar({
        cita: cita({
          scheduleSlot: {
            ...cita().scheduleSlot,
            startTime: new Date('2026-10-22T13:00:00Z'),
          },
        }),
      });
      await t.correr();
      expect(t.exceptions.registrar).not.toHaveBeenCalled();
    });

    it('si el caso ya existía (la cancelación llegó otra vez), no le escribe dos veces', async () => {
      const t = armar({ registro: 'ACTUALIZADA' });
      await t.correr();
      expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
    });

    it('nunca lanza: un error queda en el log y la cancelación ya está aplicada', async () => {
      const t = armar();
      t.prisma.appointment.findFirst
        .mockReset()
        .mockRejectedValue(new Error('base caída'));
      jest
        .spyOn((t.svc as any).logger, 'error')
        .mockImplementation(() => undefined);
      await expect(t.correr()).resolves.toBeUndefined();
    });
  });
});
