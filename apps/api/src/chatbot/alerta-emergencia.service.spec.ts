import { AlertaEmergenciaService } from './alerta-emergencia.service';

const ORG = 'org-1';
const AHORA = new Date('2026-11-22T04:22:10Z');

function montar(opciones: {
  lista?: { id: string; phone: string }[];
  plantilla?: (phone: string) => {
    success: boolean;
    error?: string;
    wamid?: string | null;
  };
}) {
  const prisma = {
    emergencyAlertRecipient: {
      findMany: jest.fn(async () => opciones.lista ?? []),
      findFirst: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    organization: { findUnique: jest.fn(async () => ({ timezone: null })) },
  };
  const plantillas = {
    sendTemplate: jest.fn(async (p: { recipientId: string }) =>
      (
        opciones.plantilla ??
        (() => ({ success: true, wamid: `wamid-${p.recipientId}` }))
      )(p.recipientId),
    ),
  };
  const tecnicas = { avisar: jest.fn(async () => undefined) };
  const servicio = new AlertaEmergenciaService(
    prisma as any,
    plantillas as any,
    tecnicas as any,
  );
  const enviarTexto = jest.fn(async () => ({ success: true }));
  const avisar = (extra: { supportPhone?: string | null } = {}) =>
    servicio.avisar({
      organizationId: ORG,
      organizationName: 'Hospital San Vicente',
      supportPhone: extra.supportPhone ?? '+57 606 853 8860',
      senderId: '573104445512',
      mensaje: 'Me estoy ahogando mucho',
      enviarTexto,
      ahora: AHORA,
    });
  return { servicio, prisma, plantillas, tecnicas, enviarTexto, avisar };
}

describe('AlertaEmergenciaService.avisar', () => {
  it('con la lista: plantilla EMERGENCY_ALERT a cada persona, con cuándo, teléfono y mensaje', async () => {
    const m = montar({
      lista: [
        { id: 'r1', phone: '573001112233' },
        { id: 'r2', phone: '573004445566' },
      ],
    });
    const r = await m.avisar();

    expect(m.plantillas.sendTemplate).toHaveBeenCalledTimes(2);
    const envio = m.plantillas.sendTemplate.mock.calls[0][0] as any;
    expect(envio).toMatchObject({
      organizationId: ORG,
      recipientId: '573001112233',
      kind: 'EMERGENCY_ALERT',
    });
    expect(envio.bodyParams).toHaveLength(3);
    expect(envio.bodyParams[1]).toBe('+57 310 444 5512');
    expect(envio.bodyParams[2]).toBe('«Me estoy ahogando mucho»');
    expect(r).toEqual({
      staffAlerted: true,
      canal: 'PLANTILLA',
      destinatarios: 2,
      aceptados: 2,
      wamids: ['wamid-573001112233', 'wamid-573004445566'],
      motivo: null,
    });
    // La salud de cada persona, en su fila.
    expect(m.prisma.emergencyAlertRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { lastSentAt: AHORA, lastWamid: 'wamid-573001112233' },
    });
    expect(m.tecnicas.avisar).not.toHaveBeenCalled();
    expect(m.enviarTexto).not.toHaveBeenCalled();
  });

  it('sin la plantilla registrada: texto libre (WhatsApp solo lo entrega si escribió en 24 h)', async () => {
    const m = montar({
      lista: [{ id: 'r1', phone: '573001112233' }],
      plantilla: () => ({ success: false, error: 'template-not-configured' }),
    });
    const r = await m.avisar();
    expect(m.enviarTexto).toHaveBeenCalledWith(
      '573001112233',
      expect.stringContaining('Teléfono del paciente: +57 310 444 5512'),
    );
    expect(r).toMatchObject({
      staffAlerted: true,
      canal: 'TEXTO',
      aceptados: 1,
    });
  });

  it('sin lista y con el teléfono de soporte FIJO: no se envía a nadie y se avisa al equipo técnico', async () => {
    const m = montar({ lista: [] });
    const r = await m.avisar({ supportPhone: '+57 606 853 8860' });
    expect(m.plantillas.sendTemplate).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      staffAlerted: false,
      canal: 'NINGUNO',
      destinatarios: 0,
    });
    expect(m.tecnicas.avisar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ALERTA_EMERGENCIA_NO_SALE',
        dedupeKey: `emergencia:alerta-no-sale:${ORG}`,
        organizationId: ORG,
      }),
    );
    // 🔒 Sin datos del paciente en la alerta técnica.
    const detalle = (m.tecnicas.avisar.mock.calls[0] as any)[0]
      .detail as string;
    expect(detalle).not.toMatch(/5512|ahogando/);
  });

  it('sin lista y con el teléfono de soporte CELULAR: le llega a ese celular (como antes)', async () => {
    const m = montar({ lista: [] });
    const r = await m.avisar({ supportPhone: '314 679 3010' });
    expect(m.plantillas.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: '573146793010' }),
    );
    expect(r.staffAlerted).toBe(true);
    expect(m.prisma.emergencyAlertRecipient.updateMany).not.toHaveBeenCalled();
  });

  it('Meta la rechaza para todos: no cuenta como avisado y va al equipo técnico', async () => {
    const m = montar({
      lista: [{ id: 'r1', phone: '573001112233' }],
      plantilla: () => ({
        success: false,
        error: '{"error":{"message":"Template does not exist","code":132001}}',
      }),
    });
    const r = await m.avisar();
    expect(r).toMatchObject({ staffAlerted: false, aceptados: 0, wamids: [] });
    expect(r.motivo).toMatch(/Template does not exist \(código 132001\)/);
    expect(m.prisma.emergencyAlertRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        lastError: 'Template does not exist (código 132001)',
        lastErrorAt: AHORA,
      },
    });
    expect(m.tecnicas.avisar).toHaveBeenCalledTimes(1);
  });

  it('a uno le llega y a otro no: cuenta como avisado, sin alerta técnica', async () => {
    const m = montar({
      lista: [
        { id: 'r1', phone: '573001112233' },
        { id: 'r2', phone: '573004445566' },
      ],
      plantilla: (phone) =>
        phone.endsWith('2233')
          ? { success: false, error: 'meta-api-error' }
          : { success: true, wamid: 'w2' },
    });
    const r = await m.avisar();
    expect(r).toMatchObject({
      staffAlerted: true,
      destinatarios: 2,
      aceptados: 1,
      wamids: ['w2'],
    });
    expect(m.tecnicas.avisar).not.toHaveBeenCalled();
  });

  it('nunca lanza: si la base falla, la respuesta al paciente no se cae', async () => {
    const m = montar({});
    m.prisma.emergencyAlertRecipient.findMany.mockRejectedValueOnce(
      new Error('db caída'),
    );
    await expect(m.avisar()).resolves.toMatchObject({
      staffAlerted: false,
      canal: 'NINGUNO',
    });
    expect(m.tecnicas.avisar).toHaveBeenCalled();
  });
});

describe('AlertaEmergenciaService.probar', () => {
  it('manda la plantilla con el texto de PRUEBA a la persona de SU clínica', async () => {
    const m = montar({});
    m.prisma.emergencyAlertRecipient.findFirst.mockResolvedValue({
      id: 'r1',
      label: 'Urgencias',
      phone: '573001112233',
    });
    await expect(
      m.servicio.probar(ORG, 'r1', 'admin@clinica.co', AHORA),
    ).resolves.toEqual({ success: true });
    expect(m.prisma.emergencyAlertRecipient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', organizationId: ORG } }),
    );
    const envio = m.plantillas.sendTemplate.mock.calls[0][0] as any;
    expect(envio.kind).toBe('EMERGENCY_ALERT');
    expect(envio.bodyParams[0]).toMatch(/^PRUEBA/);
  });

  it('dos clics seguidos no mandan dos pruebas', async () => {
    const m = montar({});
    m.prisma.emergencyAlertRecipient.findFirst.mockResolvedValue({
      id: 'r1',
      label: 'Urgencias',
      phone: '573001112233',
    });
    m.prisma.emergencyAlertRecipient.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    const r = await m.servicio.probar(ORG, 'r1', 'admin@clinica.co', AHORA);
    expect(r).toEqual({
      success: false,
      error: expect.stringMatching(/espere 5 minutos/),
    });
    expect(m.plantillas.sendTemplate).not.toHaveBeenCalled();
  });

  it('sin la plantilla registrada, la prueba lo dice', async () => {
    const m = montar({
      plantilla: () => ({ success: false, error: 'template-not-configured' }),
    });
    m.prisma.emergencyAlertRecipient.findFirst.mockResolvedValue({
      id: 'r1',
      label: 'Urgencias',
      phone: '573001112233',
    });
    const r = await m.servicio.probar(ORG, 'r1', 'admin@clinica.co', AHORA);
    expect(r).toEqual({
      success: false,
      error: 'No salió: falta registrar la plantilla en Configuración.',
    });
  });

  it('una persona de otra clínica no existe', async () => {
    const m = montar({});
    m.prisma.emergencyAlertRecipient.findFirst.mockResolvedValue(null);
    const r = await m.servicio.probar(ORG, 'ajena', 'admin@clinica.co', AHORA);
    expect(r.success).toBe(false);
    expect(m.plantillas.sendTemplate).not.toHaveBeenCalled();
  });
});
