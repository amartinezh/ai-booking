import {
  AltasNoRegistradasService,
  ESPERA_SIN_INTENTO_MS,
} from './altas-no-registradas.service';

/**
 * 🏥 Citas del chat que el hospital no registró (2026-10-29). El caso que lo
 * motivó: una paciente agendó a las 8:37 para el día siguiente a las 6:30, el
 * envío se rindió y a ella solo le llegó «en proceso»; habría ido para nada.
 */
const ORG = 'org-1';
const AHORA = new Date('2026-10-29T16:00:00.000Z'); // 11:00 en Bogotá
const MANANA_630 = new Date('2026-10-30T11:30:00.000Z');
const EN_3_DIAS = new Date('2026-11-01T14:00:00.000Z');

const evento = (over: Record<string, unknown> = {}) => ({
  seq: 101n,
  entityId: 'apt-1',
  attempts: 10,
  deadLettered: true,
  lastError: 'El médico RU70 no tiene turno el 2026-10-30',
  createdAt: new Date('2026-10-29T13:37:00.000Z'),
  ...over,
});
const cita = (inicio = MANANA_630) => ({
  id: 'apt-1',
  patientId: 'pac-1',
  epsId: 'eps-1',
  scheduleSlot: { startTime: inicio, doctorId: 'doc-1' },
});

function armar(
  opts: {
    eventos?: unknown[];
    citas?: unknown[];
    bookingEnabled?: boolean;
    rechazo?: boolean;
    casosAbiertos?: { id: string; meta: unknown }[];
    escrito?: boolean;
  } = {},
) {
  const prisma = {
    hospitalMirrorConfig: {
      findMany: jest.fn().mockResolvedValue([{ organizationId: ORG }]),
    },
    organizationSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ bookingEnabled: opts.bookingEnabled ?? true }),
    },
    syncOutbox: {
      findMany: jest.fn().mockResolvedValue(opts.eventos ?? [evento()]),
    },
    appointment: {
      findMany: jest.fn().mockResolvedValue(opts.citas ?? [cita()]),
    },
    syncException: {
      findMany: jest.fn(async ({ where }: { where: { status?: unknown } }) =>
        // Con estado: los casos abiertos. Sin estado: todos los de la cita.
        where.status
          ? (opts.casosAbiertos ?? [
              { id: 'caso-1', meta: { motivo: 'RENDIDA' } },
            ])
          : [{ id: 'caso-1' }],
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    syncExceptionLog: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.escrito ? { id: 'log-1' } : null),
    },
  };
  const dispatch = {
    markRejectedByHis: jest.fn().mockResolvedValue(opts.rechazo ?? true),
  };
  const exceptions = {
    anotar: jest.fn().mockResolvedValue(undefined),
    registrar: jest.fn().mockResolvedValue('CREADA'),
  };
  const svc = new AltasNoRegistradasService(
    prisma as never,
    dispatch as never,
    exceptions as never,
  );
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  return { svc, prisma, dispatch, exceptions };
}

describe('AltasNoRegistradasService', () => {
  it('🧾 el alta se rindió: la cita se anula con la marca «no llegó» y el caso queda abierto con la nota', async () => {
    const t = armar();
    await expect(t.svc.revisar(ORG, AHORA)).resolves.toBe(1);

    expect(t.dispatch.markRejectedByHis).toHaveBeenCalledWith(
      ORG,
      '101',
      'no llegó al sistema del hospital tras 10 intentos (último error: El médico RU70 no tiene turno el 2026-10-30)',
      { noLlego: true, yaSeLeEscribio: false },
    );
    expect(t.prisma.syncException.updateMany).toHaveBeenCalledWith({
      where: { id: 'caso-1', organizationId: ORG },
      data: {
        meta: {
          motivo: 'RENDIDA',
          noRegistrada: true,
          noRegistradaIso: AHORA.toISOString(),
        },
      },
    });
    expect(t.exceptions.anotar).toHaveBeenCalledWith(
      'caso-1',
      'NO_REGISTRADA',
      null,
      null,
      expect.stringContaining('AgenIA la anuló y le avisa al paciente'),
    );
  });

  it('solo mira altas de citas que salen de AgenIA, sin entregar y recientes; las del chat, vigentes y futuras', async () => {
    const t = armar();
    await t.svc.revisar(ORG, AHORA);

    const where = t.prisma.syncOutbox.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      organizationId: ORG,
      entityType: 'APPOINTMENT',
      op: 'INSERT',
      origin: { not: 'MIRROR' },
      deliveredAt: null,
    });
    expect(where.OR).toEqual([
      { deadLettered: true },
      {
        deadLettered: false,
        attempts: 0,
        createdAt: { lte: new Date(AHORA.getTime() - ESPERA_SIN_INTENTO_MS) },
      },
    ]);
    expect(t.prisma.appointment.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      id: { in: ['apt-1'] },
      status: 'SCHEDULED',
      origin: { in: ['WHATSAPP', 'TELEGRAM'] },
      scheduleSlot: { startTime: { gt: AHORA } },
    });
  });

  it('sin un solo intento en 30 min y la cita en menos de 24 h: también (el agente no la está tomando)', async () => {
    const t = armar({
      eventos: [evento({ deadLettered: false, attempts: 0, lastError: null })],
    });
    await t.svc.revisar(ORG, AHORA);
    expect(t.dispatch.markRejectedByHis).toHaveBeenCalledWith(
      ORG,
      '101',
      'el agente del hospital no la tomó en 143 minutos y la cita es en menos de 24 horas',
      { noLlego: true, yaSeLeEscribio: false },
    );
  });

  it('sin intento pero con la cita lejos (más de 24 h): todavía no', async () => {
    const t = armar({
      eventos: [evento({ deadLettered: false, attempts: 0 })],
      citas: [cita(EN_3_DIAS)],
    });
    await expect(t.svc.revisar(ORG, AHORA)).resolves.toBe(0);
    expect(t.dispatch.markRejectedByHis).not.toHaveBeenCalled();
  });

  it('una RENDIDA se trata aunque la cita esté lejos', async () => {
    const t = armar({ citas: [cita(EN_3_DIAS)] });
    await expect(t.svc.revisar(ORG, AHORA)).resolves.toBe(1);
  });

  it('con «Agendar» apagado, lo que está en cola espera por decisión: solo las rendidas', async () => {
    const t = armar({ bookingEnabled: false });
    await t.svc.revisar(ORG, AHORA);
    expect(t.prisma.syncOutbox.findMany.mock.calls[0][0].where.OR).toEqual([
      { deadLettered: true },
    ]);
  });

  it('una cita del panel, ya anulada o pasada (no viene en la consulta): no se toca', async () => {
    const t = armar({ citas: [] });
    await expect(t.svc.revisar(ORG, AHORA)).resolves.toBe(0);
    expect(t.dispatch.markRejectedByHis).not.toHaveBeenCalled();
  });

  it('si el personal ya le escribió desde la Bandeja, se marca para que el bot no repita', async () => {
    const t = armar({ escrito: true });
    await t.svc.revisar(ORG, AHORA);
    expect(t.dispatch.markRejectedByHis.mock.calls[0][3]).toEqual({
      noLlego: true,
      yaSeLeEscribio: true,
    });
    expect(t.prisma.syncExceptionLog.findFirst).toHaveBeenCalledWith({
      where: { exceptionId: { in: ['caso-1'] }, action: 'MENSAJE_AL_PACIENTE' },
      select: { id: true },
    });
  });

  it('sin caso abierto todavía: abre «Cita que el hospital aún no tiene» ya marcado', async () => {
    const t = armar({ casosAbiertos: [] });
    await t.svc.revisar(ORG, AHORA);
    expect(t.exceptions.registrar).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        kind: 'CITA_NO_ENTREGADA',
        dedupeKey: 'cita:apt-1:101',
        appointmentId: 'apt-1',
        patientId: 'pac-1',
        outboxSeq: 101n,
        appointmentStartAt: MANANA_630,
        meta: expect.objectContaining({
          motivo: 'RENDIDA',
          noRegistrada: true,
        }),
      }),
      AHORA,
    );
  });

  it('si el rechazo no se aplicó (otro lo hizo antes), no toca el caso', async () => {
    const t = armar({ rechazo: false });
    await expect(t.svc.revisar(ORG, AHORA)).resolves.toBe(0);
    expect(t.prisma.syncException.updateMany).not.toHaveBeenCalled();
    expect(t.exceptions.registrar).not.toHaveBeenCalled();
  });

  it('sin eventos, no consulta citas', async () => {
    const t = armar({ eventos: [] });
    await t.svc.revisar(ORG, AHORA);
    expect(t.prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('recorre las clínicas con espejo, y el fallo de una no frena a las demás', async () => {
    const t = armar();
    t.prisma.hospitalMirrorConfig.findMany.mockResolvedValue([
      { organizationId: 'org-mala' },
      { organizationId: ORG },
    ]);
    t.prisma.organizationSettings.findUnique.mockRejectedValueOnce(
      new Error('base caída'),
    );
    await t.svc.revisarTodas(AHORA);
    expect(t.dispatch.markRejectedByHis).toHaveBeenCalledTimes(1);
    expect(t.prisma.hospitalMirrorConfig.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      select: { organizationId: true },
    });
  });

  it('el cron llama al barrido sin argumentos', async () => {
    const t = armar();
    const espia = jest
      .spyOn(t.svc, 'revisarTodas')
      .mockResolvedValue(undefined);
    await t.svc.cadaMinuto();
    expect(espia).toHaveBeenCalledWith();
  });
});
