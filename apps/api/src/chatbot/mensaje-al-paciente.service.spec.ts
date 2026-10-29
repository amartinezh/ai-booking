import { MensajeAlPacienteService } from './mensaje-al-paciente.service';
import {
  MAX_MENSAJE_AL_PACIENTE,
  primerNombre,
  sugerenciasDeMensaje,
} from './mensaje-al-paciente';
import { InteractionStatus } from '../interaction-log/interaction-log.service';

/**
 * ✉️ El mensaje del personal al paciente desde la Bandeja (2026-10-29). El caso que
 * lo motivó: una cita agendada el jueves por un familiar desde su celular, que el
 * hospital nunca registró; la ficha tiene el teléfono de la paciente, pero quien
 * escribió (y tiene la ventana de 24 h abierta) es el familiar.
 */

const ORG = 'org-1';
const CITA = 'cita-1';
const PACIENTE_TEL = '573001115355';
const FAMILIAR = '573004449051';
const AHORA = Date.parse('2026-10-29T15:00:00Z');

type Paciente = {
  userId: string | null;
  fullName: string;
  whatsappId: string | null;
  bsuid: string | null;
  telegramChatId: string | null;
  telegramBlockedAt: Date | null;
};

function cita(
  over: { origin?: string; status?: string; patient?: Partial<Paciente> } = {},
) {
  return {
    id: CITA,
    origin: over.origin ?? 'WHATSAPP',
    status: over.status ?? 'SCHEDULED',
    createdAt: new Date('2026-10-29T13:37:00Z'),
    patientId: 'pac-1',
    patient: {
      userId: 'user-1',
      fullName: 'MARIA ROSALBA SANCHEZ',
      whatsappId: PACIENTE_TEL,
      bsuid: null,
      telegramChatId: null,
      telegramBlockedAt: null,
      ...over.patient,
    },
    scheduleSlot: {
      startTime: new Date('2026-10-30T11:30:00Z'),
      doctor: {
        fullName: 'SANTIAGO CARDENAS GUEVARA',
        isFunctionalAgenda: false,
      },
      service: { name: 'Consulta ambulatoria de medicina general' },
    },
  };
}

function montar(opts: {
  cita?: ReturnType<typeof cita> | null;
  /** Identificadores con la ventana de 24 h abierta. */
  ventanas?: string[];
  escribieron?: string[];
  telefonoEquivocado?: boolean;
  envio?: { success: boolean; error?: string };
}) {
  const prisma = {
    appointment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.cita === undefined ? cita() : opts.cita),
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Hospital San Vicente de Paúl',
        supportPhone: '606 853 0000',
        timezone: null,
      }),
    },
    syncException: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.telefonoEquivocado ? { id: 'exc-tel' } : null),
    },
    interactionLog: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opts.escribieron ?? []).map((whatsappId) => ({ whatsappId })),
        ),
    },
  };
  const ventanas = new Set(opts.ventanas ?? []);
  const chatbot = {
    serviceWindowEndsAt: jest.fn(async (_org: string, id: string) =>
      ventanas.has(id) ? new Date(AHORA + 18 * 3600_000) : null,
    ),
    sendOutboundForOrg: jest
      .fn()
      .mockResolvedValue(opts.envio ?? { success: true }),
  };
  const interactionLog = { log: jest.fn().mockResolvedValue(undefined) };
  const svc = new MensajeAlPacienteService(
    prisma as never,
    chatbot as never,
    interactionLog as never,
  );
  return { svc, prisma, chatbot, interactionLog };
}

describe('MensajeAlPacienteService.revisar', () => {
  it('busca la cita en la clínica del token; si no está, NO_ENCONTRADA', async () => {
    const { svc, prisma } = montar({ cita: null });
    await expect(svc.revisar(ORG, CITA)).resolves.toEqual({
      ok: false,
      motivo: 'NO_ENCONTRADA',
    });
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CITA, organizationId: ORG } }),
    );
  });

  it('un id raro no consulta la base', async () => {
    const { svc, prisma } = montar({});
    await expect(svc.revisar(ORG, 'x'.repeat(65))).resolves.toEqual({
      ok: false,
      motivo: 'NO_ENCONTRADA',
    });
    await expect(svc.revisar(ORG, '')).resolves.toEqual({
      ok: false,
      motivo: 'NO_ENCONTRADA',
    });
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('sin teléfono, BSUID ni Telegram: SIN_CONTACTO', async () => {
    const { svc } = montar({ cita: cita({ patient: { whatsappId: null } }) });
    await expect(svc.revisar(ORG, CITA)).resolves.toEqual({
      ok: false,
      motivo: 'SIN_CONTACTO',
    });
  });

  it('con el caso «el teléfono es de otra persona» abierto: no se le escribe', async () => {
    const { svc, prisma } = montar({
      ventanas: [PACIENTE_TEL],
      telefonoEquivocado: true,
    });
    await expect(svc.revisar(ORG, CITA)).resolves.toEqual({
      ok: false,
      motivo: 'TELEFONO_EQUIVOCADO',
    });
    expect(prisma.syncException.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          kind: 'TELEFONO_EQUIVOCADO',
          patientId: 'pac-1',
        }),
      }),
    );
  });

  it('la paciente escribió hace poco: a su número, con hasta cuándo', async () => {
    const { svc } = montar({ ventanas: [PACIENTE_TEL] });
    const r = await svc.revisar(ORG, CITA);
    expect(r).toMatchObject({
      ok: true,
      canal: 'WHATSAPP',
      puedeEscribir: true,
      hastaIso: new Date(AHORA + 18 * 3600_000).toISOString(),
      destino: '•••5355',
      otroNumero: false,
      citaVigente: true,
    });
  });

  it('agendó un familiar desde su celular: va a ese número, que tiene la ventana abierta', async () => {
    const { svc, prisma } = montar({
      ventanas: [FAMILIAR],
      escribieron: [FAMILIAR, FAMILIAR],
    });
    const r = await svc.revisar(ORG, CITA);
    expect(r).toMatchObject({
      ok: true,
      puedeEscribir: true,
      destino: '•••9051',
      otroNumero: true,
    });
    // Solo filas de ESTA cita, de la clínica, entrantes y desde que nació la cita.
    expect(prisma.interactionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          status: { not: InteractionStatus.OUTBOUND },
          metadata: { path: ['appointmentId'], equals: CITA },
        }),
      }),
    );
  });

  it('nadie escribió en 24 horas: no se puede escribir (WhatsApp no lo entregaría)', async () => {
    const { svc } = montar({ escribieron: [FAMILIAR] });
    const r = await svc.revisar(ORG, CITA);
    expect(r).toMatchObject({
      ok: true,
      canal: 'WHATSAPP',
      puedeEscribir: false,
      hastaIso: null,
      destino: '•••5355',
    });
  });

  it('por Telegram siempre se puede (no hay ventana) y no muestra número', async () => {
    const { svc, chatbot } = montar({
      cita: cita({ origin: 'TELEGRAM', patient: { telegramChatId: '12345' } }),
    });
    const r = await svc.revisar(ORG, CITA);
    expect(r).toMatchObject({
      ok: true,
      canal: 'TELEGRAM',
      puedeEscribir: true,
      destino: null,
    });
    expect(chatbot.serviceWindowEndsAt).not.toHaveBeenCalled();
  });

  it('dice si la cita sigue vigente y trae los textos sugeridos con sus datos', async () => {
    const { svc } = montar({
      cita: cita({ status: 'CANCELLED' }),
      ventanas: [PACIENTE_TEL],
    });
    const r = await svc.revisar(ORG, CITA);
    if (!r.ok) throw new Error('debía poder revisarse');
    expect(r.citaVigente).toBe(false);
    expect(r.sugerencias.cancelada).toContain(
      'Hola, Maria. Le escribimos de Hospital San Vicente de Paúl.',
    );
    expect(r.sugerencias.cancelada).toContain(
      'Consulta ambulatoria de medicina general',
    );
    expect(r.sugerencias.cancelada).toContain(
      'viernes, 30 de octubre a las 06:30',
    );
    expect(r.sugerencias.cancelada).toContain('SANTIAGO CARDENAS GUEVARA');
    expect(r.sugerencias.cancelada).toContain('el hospital al 606 853 0000');
  });
});

describe('MensajeAlPacienteService.enviar', () => {
  it('envía al número con la ventana abierta, como mensaje manual de la cita, y lo deja en su conversación', async () => {
    const { svc, chatbot, interactionLog } = montar({
      ventanas: [FAMILIAR],
      escribieron: [FAMILIAR],
    });
    await expect(
      svc.enviar(ORG, CITA, '  Hola, su cita se canceló.  '),
    ).resolves.toEqual({
      ok: true,
      canal: 'WHATSAPP',
      destino: '•••9051',
    });
    expect(chatbot.sendOutboundForOrg).toHaveBeenCalledWith(
      ORG,
      FAMILIAR,
      'Hola, su cita se canceló.',
      {
        kind: 'MANUAL',
        appointmentId: CITA,
      },
    );
    expect(interactionLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappId: FAMILIAR,
        organizationId: ORG,
        status: InteractionStatus.OUTBOUND,
        botReply: 'Hola, su cita se canceló.',
        patientUserId: 'user-1',
        metadata: expect.objectContaining({
          tipo: 'MENSAJE_DEL_PERSONAL',
          appointmentId: CITA,
        }),
      }),
    );
  });

  it('fuera de la ventana no envía nada', async () => {
    const { svc, chatbot, interactionLog } = montar({});
    await expect(svc.enviar(ORG, CITA, 'Hola')).resolves.toEqual({
      ok: false,
      motivo: 'FUERA_DE_VENTANA',
    });
    expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
    expect(interactionLog.log).not.toHaveBeenCalled();
  });

  it('con el teléfono marcado como de otra persona no envía', async () => {
    const { svc, chatbot } = montar({
      ventanas: [PACIENTE_TEL],
      telefonoEquivocado: true,
    });
    await expect(svc.enviar(ORG, CITA, 'Hola')).resolves.toEqual({
      ok: false,
      motivo: 'TELEFONO_EQUIVOCADO',
    });
    expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
  });

  it('un mensaje vacío o demasiado largo no se envía ni consulta la base', async () => {
    const { svc, prisma, chatbot } = montar({ ventanas: [PACIENTE_TEL] });
    for (const m of [
      '',
      '   ',
      'x'.repeat(MAX_MENSAJE_AL_PACIENTE + 1),
      undefined,
      42,
    ]) {
      await expect(svc.enviar(ORG, CITA, m)).resolves.toEqual({
        ok: false,
        motivo: 'MENSAJE_INVALIDO',
      });
    }
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
    expect(chatbot.sendOutboundForOrg).not.toHaveBeenCalled();
  });

  it('si el envío falla lo dice y no lo anota como enviado', async () => {
    const { svc, interactionLog } = montar({
      ventanas: [PACIENTE_TEL],
      envio: { success: false, error: 'meta-api-error' },
    });
    await expect(svc.enviar(ORG, CITA, 'Hola')).resolves.toEqual({
      ok: false,
      motivo: 'FALLO',
    });
    expect(interactionLog.log).not.toHaveBeenCalled();
  });

  it('por Telegram envía al chat y lo anota con su canal', async () => {
    const { svc, chatbot, interactionLog } = montar({
      cita: cita({ origin: 'TELEGRAM', patient: { telegramChatId: '12345' } }),
    });
    await expect(svc.enviar(ORG, CITA, 'Hola')).resolves.toEqual({
      ok: true,
      canal: 'TELEGRAM',
      destino: null,
    });
    expect(chatbot.sendOutboundForOrg).toHaveBeenCalledWith(
      ORG,
      'tg:12345',
      'Hola',
      {
        kind: 'MANUAL',
        appointmentId: CITA,
      },
    );
    expect(interactionLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ canal: 'TELEGRAM' }),
      }),
    );
  });
});

describe('sugerenciasDeMensaje', () => {
  const base = {
    paciente: 'MARIA ROSALBA',
    clinica: 'Hospital San Vicente de Paúl',
    servicio: 'Consulta ambulatoria de medicina general',
    fecha: 'viernes, 30 de octubre a las 06:30 a. m.',
    medico: 'Dr(a). SANTIAGO CARDENAS GUEVARA',
    telefonoClinica: '606 853 0000',
  };

  it('cancelada: dice que se canceló, pide disculpas y cómo pedir otra', () => {
    expect(sugerenciasDeMensaje(base).cancelada).toBe(
      'Hola, Maria. Le escribimos de Hospital San Vicente de Paúl.\n\n' +
        'Lamentamos informarle que su cita de Consulta ambulatoria de medicina general del ' +
        'viernes, 30 de octubre a las 06:30 a. m. con Dr(a). SANTIAGO CARDENAS GUEVARA fue cancelada. ' +
        'Le pedimos disculpas por el inconveniente.\n\n' +
        'Si desea una nueva cita, puede escribirnos por este medio o comunicarse con el hospital al 606 853 0000.',
    );
  });

  it('confirmada: dice que quedó registrada y se disculpa por la demora', () => {
    expect(sugerenciasDeMensaje(base).confirmada).toContain(
      'quedó registrada en el hospital',
    );
    expect(sugerenciasDeMensaje(base).confirmada).toContain(
      'disculpas por la demora',
    );
  });

  it('el saludo deja el resto para escribir', () => {
    expect(sugerenciasDeMensaje(base).saludo).toBe(
      'Hola, Maria. Le escribimos de Hospital San Vicente de Paúl.\n\n',
    );
  });

  it('sin datos no deja huecos raros', () => {
    const s = sugerenciasDeMensaje({
      paciente: null,
      clinica: null,
      servicio: null,
      fecha: 'mañana',
      medico: '',
      telefonoClinica: null,
    });
    expect(s.saludo).toBe('Hola. Le escribimos del hospital.\n\n');
    expect(s.cancelada).toContain(
      'su cita de consulta del mañana fue cancelada',
    );
    expect(s.cancelada).toContain('comunicarse con el hospital.');
    expect(s.cancelada).not.toContain('undefined');
    expect(s.cancelada).not.toContain(' con  ');
  });

  it('primerNombre', () => {
    expect(primerNombre('MARIA ROSALBA')).toBe('Maria');
    expect(primerNombre('  josé  ')).toBe('José');
    expect(primerNombre(null)).toBe('');
  });
});
