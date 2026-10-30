import {
  AvisoCambioHospitalService,
  momentoDelAviso,
} from './aviso-cambio-hospital.service';
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
/**
 * ⏳ 2026-10-29: el aviso de una CANCELACIÓN espera 10 minutos por si el hospital
 * vuelve a crear la cita. Las pruebas corren el camino real: la cancelación a las
 * 11:47 y el barrido a las 11:58.
 */
const DESPUES = new Date(AHORA.getTime() + 11 * 60_000);

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
    /** La cita que el hospital creó DESPUÉS de cancelar (la ve solo el barrido). */
    nuevaDespues?: any;
    /** El personal ya le escribió al paciente desde la Bandeja. */
    escritoPorElPersonal?: boolean;
  } = {},
) {
  const laCita = opts.cita === undefined ? cita() : opts.cita;
  // La cita se carga por su id; la nueva, por el paciente. Al cancelar solo se ve
  // `nueva`; en el barrido, también `nuevaDespues`.
  let barriendo = false;
  const prisma = {
    appointment: {
      findFirst: jest.fn(async ({ where }: { where: { id?: unknown } }) => {
        if (typeof where.id === 'string') return laCita;
        return (
          (barriendo ? (opts.nuevaDespues ?? opts.nueva) : opts.nueva) ?? null
        );
      }),
    },
    syncException: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.telefonoMarcado ? { id: 'caso-tel' } : null),
      // El caso que dejó la cancelación, si quedó en espera.
      findMany: jest.fn(async () => {
        const e = exceptions.registrar.mock.calls[0]?.[1];
        if ((opts.registro ?? 'CREADA') !== 'CREADA') return [];
        if (!e || e.meta?.aviso !== 'EN_ESPERA') return [];
        return [
          {
            id: 'caso-1',
            organizationId: ORG,
            appointmentId: e.appointmentId,
            meta: e.meta,
            firstSeenAt: AHORA,
          },
        ];
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    syncExceptionLog: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.escritoPorElPersonal ? { id: 'log-1' } : null),
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
    autoResolver: jest.fn().mockResolvedValue(true),
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
  // La cancelación y, 11 minutos después, el barrido de los avisos en espera.
  const correr = async () => {
    await svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    barriendo = true;
    await svc.avisarLosPendientes(DESPUES);
  };
  const caso = () => exceptions.registrar.mock.calls[0]?.[1];
  /** Lo último que se escribió en el caso. */
  const final = () => {
    const llamadas = prisma.syncException.updateMany.mock.calls;
    return llamadas[llamadas.length - 1]?.[0]?.data;
  };
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
      // ⏳ Queda en espera 10 minutos, por si el hospital vuelve a crear la cita.
      meta: {
        aviso: 'EN_ESPERA',
        canceladaIso: AHORA.toISOString(),
        avisarDesdeIso: new Date(AHORA.getTime() + 10 * 60_000).toISOString(),
      },
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
        enviadoIso: DESPUES.toISOString(),
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

  describe('⏳ fuera de las 24 h: la plantilla «Cita cancelada por el hospital»', () => {
    const lejana = () =>
      cita({
        scheduleSlot: {
          ...cita().scheduleSlot,
          startTime: new Date('2026-10-26T14:00:00Z'), // lunes 26, 9:00 en Bogotá
        },
      });

    it('sale con sus cinco variables, en el orden del contrato', async () => {
      const t = armar({ dentroDeVentana: false, cita: lejana() });
      await t.correr();
      expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
      expect(t.templates.sendTemplate).toHaveBeenCalledWith({
        organizationId: ORG,
        recipientId: '573001112233',
        kind: 'HIS_APPOINTMENT_CANCELLED',
        bodyParams: [
          'Victoria',
          'Consulta ambulatoria de medicina general',
          'Dr(a). YULIETH ANDREA RIOS AGUIRRE',
          expect.stringMatching(/lunes.*26 de octubre/),
          'el hospital al 606 853 8860',
        ],
        appointmentId: 'apt-bot',
      });
      // Se avisó y la cita es en días: MEDIA.
      expect(t.final()).toMatchObject({
        severity: 'MEDIA',
        meta: {
          aviso: 'ENVIADO',
          via: 'PLANTILLA',
          plantilla: 'HIS_APPOINTMENT_CANCELLED',
        },
      });
    });

    it('sin la plantilla registrada no sale, y el caso lo dice (ALTA: hay que llamarlo)', async () => {
      const t = armar({
        dentroDeVentana: false,
        cita: lejana(),
        plantilla: { success: false, error: 'template-not-configured' },
      });
      await t.correr();
      expect(t.final()).toMatchObject({
        severity: 'ALTA',
        meta: {
          aviso: 'NO_ENVIADO',
          motivo: 'SIN_PLANTILLA',
          plantilla: 'HIS_APPOINTMENT_CANCELLED',
        },
      });
    });

    it('sin teléfono de soporte, «con quién comunicarse» es el hospital', async () => {
      const t = armar({ dentroDeVentana: false, cita: lejana() });
      t.prisma.organization.findUnique.mockResolvedValue({
        name: 'Hospital San Vicente de Paúl',
        supportPhone: null,
        timezone: 'America/Bogota',
      });
      await t.correr();
      expect(t.templates.sendTemplate.mock.calls[0][0].bodyParams[4]).toBe(
        'el hospital',
      );
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
        meta: {
          aviso: 'ENVIADO',
          via: 'PLANTILLA',
          plantilla: 'HIS_APPOINTMENT_CONFIRMATION',
        },
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

// ══════════════════════════════════════════════════════════════════════════
// ⏳ La espera antes de avisar una cancelación (2026-10-29). El 28-oct a Yully le
// avisamos «su cita fue cancelada» a las 9:18 y el hospital se la volvió a crear
// igual a las 9:22: tenía cita y creyó que no.
// ══════════════════════════════════════════════════════════════════════════
describe('AvisoCambioHospitalService — ⏳ la espera antes de avisar una cancelación', () => {
  const laMisma = {
    ...cita({ id: 'apt-otra-vez', origin: 'MIRROR' }),
  };

  it('al cancelar no se le escribe todavía: el caso queda en espera', async () => {
    const t = armar();
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).not.toHaveBeenCalled();
    expect(t.caso().meta).toMatchObject({ aviso: 'EN_ESPERA' });
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
  });

  it('🧾 Yully: el hospital la volvió a crear igual (mismo médico y hora) → no se le escribe y el caso se cierra solo', async () => {
    const t = armar({ nuevaDespues: laMisma });
    await t.correr();
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: {
        aviso: 'NO_HIZO_FALTA',
        motivo: 'MISMA_CITA',
        nuevaCitaId: 'apt-otra-vez',
      },
    });
    expect(t.exceptions.autoResolver).toHaveBeenCalledWith(
      ORG,
      'caso-1',
      expect.stringContaining('misma cita'),
      DESPUES,
    );
  });

  it('si al cancelar ya estaba creada igual, ni caso ni aviso', async () => {
    const t = armar({ nueva: laMisma });
    await t.correr();
    expect(t.exceptions.registrar).not.toHaveBeenCalled();
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
  });

  it('el hospital le dio OTRA cita después de cancelar: el caso pasa a cambio de hora y se le avisa la nueva', async () => {
    const t = armar({ nuevaDespues: nuevaCita });
    await t.correr();
    expect(t.prisma.syncException.updateMany).toHaveBeenCalledWith({
      where: { id: 'caso-1', organizationId: ORG },
      data: {
        kind: 'CITA_MOVIDA_POR_HOSPITAL',
        title: expect.any(String),
        doctorId: 'doc-daniela',
        appointmentStartAt: MANANA,
      },
    });
    expect(t.texto()).toContain('el hospital cambió su cita');
    expect(t.texto()).toContain('✅ Ahora: *viernes, 23 de octubre');
    expect(t.final()).toMatchObject({
      meta: {
        aviso: 'ENVIADO',
        nuevaCitaId: 'apt-nueva',
        nuevaIso: MANANA.toISOString(),
      },
    });
  });

  it('el barrido busca la nueva desde 10 min antes de la cancelación, también las creadas después', async () => {
    const t = armar();
    await t.correr();
    const busquedas = t.prisma.appointment.findFirst.mock.calls
      .map((c) => c[0].where)
      .filter((w: any) => typeof w.id !== 'string');
    const delBarrido = busquedas[busquedas.length - 1];
    expect(delBarrido).toMatchObject({
      organizationId: ORG,
      patientId: 'pat-1',
      id: { not: 'apt-bot' },
      status: 'SCHEDULED',
      origin: 'MIRROR',
      scheduleSlot: { startTime: { gt: DESPUES } },
    });
    expect(delBarrido.createdAt.gte.getTime()).toBe(
      AHORA.getTime() - 10 * 60_000,
    );
  });

  it('antes de su hora no se envía; en su hora, sí', async () => {
    const t = armar();
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    await t.svc.avisarLosPendientes(new Date(AHORA.getTime() + 5 * 60_000));
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
    await t.svc.avisarLosPendientes(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).toHaveBeenCalledTimes(1);
  });

  it('con la cita a menos de una hora también espera, 5 minutos', async () => {
    const pronto = new Date(AHORA.getTime() + 50 * 60_000);
    const t = armar({
      cita: cita({
        scheduleSlot: { ...cita().scheduleSlot, startTime: pronto },
      }),
    });
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    expect(t.caso().meta).toMatchObject({
      aviso: 'EN_ESPERA',
      avisarDesdeIso: new Date(AHORA.getTime() + 5 * 60_000).toISOString(),
    });
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    await t.svc.avisarLosPendientes(new Date(AHORA.getTime() + 5 * 60_000));
    expect(t.chatbot.sendOutboundForOrg).toHaveBeenCalledTimes(1);
    expect(t.final()).toMatchObject({ meta: { aviso: 'ENVIADO' } });
  });

  it('🧾 Luis (2026-10-29): anulada 17 min antes y creada igual al minuto, al recibirlo en ventanilla → no se le escribe', async () => {
    const enDiecisiete = new Date(AHORA.getTime() + 17 * 60_000);
    const suCita = cita({
      scheduleSlot: { ...cita().scheduleSlot, startTime: enDiecisiete },
    });
    const t = armar({ cita: suCita });
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).not.toHaveBeenCalled();
    // Al minuto, el hospital la crea igual.
    t.prisma.appointment.findFirst.mockImplementation(
      async ({ where }: { where: { id?: unknown } }) =>
        typeof where.id === 'string'
          ? suCita
          : { ...suCita, id: 'apt-otra-vez', origin: 'MIRROR' },
    );
    await t.svc.avisarLosPendientes(new Date(AHORA.getTime() + 5 * 60_000));
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: { aviso: 'NO_HIZO_FALTA', motivo: 'MISMA_CITA' },
    });
  });

  it('si la cita empieza antes de que termine la espera, ya no se le escribe', async () => {
    const enTres = new Date(AHORA.getTime() + 3 * 60_000);
    const t = armar({
      cita: cita({
        scheduleSlot: { ...cita().scheduleSlot, startTime: enTres },
      }),
    });
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    await t.svc.avisarLosPendientes(new Date(AHORA.getTime() + 5 * 60_000));
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: { aviso: 'NO_ENVIADO', motivo: 'YA_PASO' },
    });
  });

  it('si otra réplica ya lo tomó, esta no le escribe', async () => {
    const t = armar();
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    t.prisma.syncException.updateMany.mockResolvedValueOnce({ count: 0 });
    await t.svc.avisarLosPendientes(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    // El reclamo fue un compare-and-set sobre el aviso en espera.
    expect(
      t.prisma.syncException.updateMany.mock.calls[0][0].where,
    ).toMatchObject({
      id: 'caso-1',
      organizationId: ORG,
      status: { in: ['ABIERTA', 'EN_REVISION'] },
      meta: { path: ['aviso'], equals: 'EN_ESPERA' },
    });
  });

  it('si el personal ya le escribió desde la Bandeja, no se le repite', async () => {
    const t = armar({ escritoPorElPersonal: true });
    await t.correr();
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: { aviso: 'NO_HIZO_FALTA', motivo: 'LE_ESCRIBIO_EL_PERSONAL' },
    });
    expect(t.exceptions.autoResolver).not.toHaveBeenCalled();
  });

  it('si cuando toca avisar la cita ya pasó, no se envía y el caso lo dice', async () => {
    const t = armar();
    await t.svc.alCancelarElHospital(ORG, 'apt-bot', AHORA);
    await t.svc.avisarLosPendientes(new Date(EN_2H.getTime() + 60_000));
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: { aviso: 'NO_ENVIADO', motivo: 'YA_PASO' },
    });
  });

  it('el barrido solo mira cancelaciones activas en espera', async () => {
    const t = armar();
    await t.svc.avisarLosPendientes(DESPUES);
    expect(t.prisma.syncException.findMany.mock.calls[0][0].where).toEqual({
      kind: 'CITA_CANCELADA_POR_HOSPITAL',
      status: { in: ['ABIERTA', 'EN_REVISION'] },
      meta: { path: ['aviso'], equals: 'EN_ESPERA' },
    });
  });

  it('nunca lanza: un error queda en el log', async () => {
    const t = armar();
    t.prisma.syncException.findMany.mockRejectedValueOnce(
      new Error('base caída'),
    );
    jest
      .spyOn((t.svc as any).logger, 'error')
      .mockImplementation(() => undefined);
    await expect(t.svc.avisarLosPendientes(DESPUES)).resolves.toBeUndefined();
  });

  it('el cron llama a los dos barridos sin pasarles argumentos', async () => {
    const t = armar();
    const avisos = jest
      .spyOn(t.svc, 'avisarLosPendientes')
      .mockResolvedValue(undefined);
    const correcciones = jest
      .spyOn(t.svc, 'corregirLosAvisos')
      .mockResolvedValue(undefined);
    await t.svc.cadaMinuto();
    expect(avisos).toHaveBeenCalledWith();
    expect(correcciones).toHaveBeenCalledWith();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🙏 2026-10-30: el aviso de cancelación ya salió y el hospital volvió a crear la
// misma cita. Se le escribe al paciente que su cita sigue en pie.
// ══════════════════════════════════════════════════════════════════════════
describe('AvisoCambioHospitalService — 🙏 la corrección cuando la cita vuelve', () => {
  const laMisma = { ...cita({ id: 'apt-otra-vez', origin: 'MIRROR' }) };
  const ESCRITO = new Date(AHORA.getTime() + 30_000);
  const casoEnviado = (meta: Record<string, unknown> = {}) => ({
    id: 'caso-1',
    organizationId: ORG,
    appointmentId: 'apt-bot',
    firstSeenAt: AHORA,
    updatedAt: ESCRITO,
    meta: {
      canalDeLaCita: 'WHATSAPP',
      canceladaIso: AHORA.toISOString(),
      aviso: 'ENVIADO',
      canal: 'WHATSAPP',
      via: 'TEXTO',
      ...meta,
    },
  });
  const armarCorreccion = (
    opts: Parameters<typeof armar>[0] = {},
    caso = casoEnviado(),
  ) => {
    const t = armar({ nueva: laMisma, ...opts });
    t.prisma.syncException.findMany.mockResolvedValue([caso]);
    return t;
  };

  it('dentro de las 24 h: le escribe que su cita sigue en pie y cierra el caso', async () => {
    const t = armarCorreccion();
    await t.svc.corregirLosAvisos(DESPUES);

    expect(t.texto()).toContain('Disculpe la confusión');
    expect(t.texto()).toContain('*Su cita sigue en pie.*');
    expect(t.texto()).toContain('YULIETH');
    // Primero se reclama con compare-and-set sobre la última escritura.
    expect(t.prisma.syncException.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'caso-1', organizationId: ORG, updatedAt: ESCRITO },
      data: { meta: { correccion: 'PENDIENTE' } },
    });
    expect(t.final()).toMatchObject({
      meta: {
        aviso: 'ENVIADO',
        correccion: 'ENVIADA',
        correccionVia: 'TEXTO',
        nuevaCitaId: 'apt-otra-vez',
      },
    });
    expect(t.exceptions.autoResolver).toHaveBeenCalledWith(
      ORG,
      'caso-1',
      expect.stringContaining('sigue en pie'),
      DESPUES,
    );
    expect(t.interactionLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ tipo: 'CITA_SIGUE_EN_PIE' }),
      }),
    );
  });

  it('fuera de las 24 h: la plantilla «Confirmación de una cita del hospital» con su hora', async () => {
    const t = armarCorreccion({ dentroDeVentana: false });
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'HIS_APPOINTMENT_CONFIRMATION',
        recipientId: '573001112233',
        appointmentId: 'apt-bot',
      }),
    );
    expect(t.final()).toMatchObject({
      meta: { correccion: 'ENVIADA', correccionVia: 'PLANTILLA' },
    });
  });

  it('si no sale, el caso queda abierto en ALTA y dice por qué', async () => {
    const t = armarCorreccion({
      dentroDeVentana: false,
      plantilla: { success: false, error: 'template-not-configured' },
    });
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.final()).toMatchObject({
      severity: expect.stringMatching(/ALTA|CRITICA/),
      meta: { correccion: 'NO_ENVIADA', correccionMotivo: 'SIN_PLANTILLA' },
    });
    expect(t.exceptions.autoResolver).not.toHaveBeenCalled();
  });

  it('si el personal ya le escribió desde la Bandeja, no se le escribe: el caso lo dice', async () => {
    const t = armarCorreccion({ escritoPorElPersonal: true });
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.templates.sendTemplate).not.toHaveBeenCalled();
    expect(t.final()).toMatchObject({
      meta: {
        correccion: 'NO_ENVIADA',
        correccionMotivo: 'LE_ESCRIBIO_EL_PERSONAL',
      },
    });
    expect(t.exceptions.autoResolver).not.toHaveBeenCalled();
  });

  it('otra cita distinta (otro médico u hora): no es una corrección, no se toca', async () => {
    const t = armarCorreccion({ nueva: nuevaCita });
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
  });

  it('sin cita nueva todavía: nada, y se vuelve a mirar en la vuelta siguiente', async () => {
    const t = armarCorreccion({ nueva: null });
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
  });

  it('con la hora de la cita ya encima, no se le escribe', async () => {
    const t = armarCorreccion();
    await t.svc.corregirLosAvisos(new Date(EN_2H.getTime() + 60_000));
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
  });

  it('una corrección ya hecha (o en curso) no se repite', async () => {
    const t = armarCorreccion({}, casoEnviado({ correccion: 'ENVIADA' }));
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
  });

  it('si otra réplica o una persona tocó el caso entretanto, esta no le escribe', async () => {
    const t = armarCorreccion();
    t.prisma.syncException.updateMany.mockResolvedValueOnce({ count: 0 });
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(t.prisma.syncException.updateMany).toHaveBeenCalledTimes(1);
  });

  it('solo mira avisos de cancelación enviados, activos y de las últimas 2 horas', async () => {
    const t = armarCorreccion();
    await t.svc.corregirLosAvisos(DESPUES);
    expect(t.prisma.syncException.findMany.mock.calls[0][0].where).toEqual({
      kind: 'CITA_CANCELADA_POR_HOSPITAL',
      status: { in: ['ABIERTA', 'EN_REVISION'] },
      meta: { path: ['aviso'], equals: 'ENVIADO' },
      firstSeenAt: { gte: new Date(DESPUES.getTime() - 2 * 60 * 60_000) },
    });
  });

  it('nunca lanza: un error queda en el log', async () => {
    const t = armarCorreccion();
    t.prisma.syncException.findMany.mockRejectedValueOnce(
      new Error('base caída'),
    );
    jest
      .spyOn((t.svc as any).logger, 'error')
      .mockImplementation(() => undefined);
    await expect(t.svc.corregirLosAvisos(DESPUES)).resolves.toBeUndefined();
  });
});

describe('momentoDelAviso', () => {
  const T0 = new Date('2026-10-28T14:18:00.000Z'); // 9:18 en Bogotá
  const min = (n: number) => new Date(T0.getTime() + n * 60_000);

  it('espera 10 minutos si la cita está lejos', () => {
    expect(momentoDelAviso(T0, min(24 * 60))).toEqual(min(10));
  });
  it('se acorta para avisar una hora antes de la cita', () => {
    expect(momentoDelAviso(T0, min(68))).toEqual(min(8));
  });
  it('pero nunca espera menos de 5 minutos, aunque la cita esté cerca (2026-10-30)', () => {
    expect(momentoDelAviso(T0, min(65))).toEqual(min(5));
    expect(momentoDelAviso(T0, min(60))).toEqual(min(5));
    expect(momentoDelAviso(T0, min(16))).toEqual(min(5));
    expect(momentoDelAviso(T0, min(3))).toEqual(min(5));
  });
  it('con una espera configurada menor que 5 minutos, esa', () => {
    expect(momentoDelAviso(T0, min(30), 2 * 60_000)).toEqual(min(2));
  });
  it('sin espera configurada, avisa ya', () => {
    expect(momentoDelAviso(T0, min(24 * 60), 0)).toBeNull();
  });
});
