import { AutorizacionDatosService } from './autorizacion-datos.service';

/**
 * 🔒 El servicio de la autorización de datos, con Prisma de mentiras. Las
 * conversaciones completas (con la tabla en memoria) están en la sección 13 de
 * chatbot.flows.e2e.spec.ts; aquí, los bordes: la base que falla, una pregunta
 * que ya no está abierta, Telegram y el retiro.
 */
describe('AutorizacionDatosService', () => {
  const ORG = 'org-1';
  const WA = {
    senderId: '573001112233',
    phone: '573001112233',
    bsuid: 'CO.123',
  };
  const TG = {
    senderId: 'tg:555',
    phone: null,
    bsuid: null,
    telegramChatId: '555',
  };

  let prisma: any;
  let config: { get: jest.Mock };
  let svc: AutorizacionDatosService;

  beforeEach(() => {
    prisma = {
      organizationSettings: {
        findUnique: jest.fn(async () => ({
          dataConsentEnabled: true,
          dataPolicyUrl: null,
          dataPolicyVersion: ' 2 ',
        })),
      },
      dataConsent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'nueva' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
    };
    config = { get: jest.fn(() => ' https://servidor/politica ') };
    svc = new AutorizacionDatosService(prisma, config as any);
  });

  describe('configuracion', () => {
    it('encendida: la versión normalizada y, sin enlace propio, el del servidor', async () => {
      expect(await svc.configuracion(ORG)).toEqual({
        version: '2',
        urlPolitica: 'https://servidor/politica',
      });
    });

    it('con enlace propio, el de la clínica', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        dataConsentEnabled: true,
        dataPolicyUrl: 'https://clinica/datos',
        dataPolicyVersion: '1',
      });
      expect((await svc.configuracion(ORG))?.urlPolitica).toBe(
        'https://clinica/datos',
      );
    });

    it('apagada, sin fila o con la base caída: null', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValueOnce({
        dataConsentEnabled: false,
      });
      expect(await svc.configuracion(ORG)).toBeNull();
      prisma.organizationSettings.findUnique.mockResolvedValueOnce(null);
      expect(await svc.configuracion(ORG)).toBeNull();
      prisma.organizationSettings.findUnique.mockRejectedValueOnce(
        new Error('caída'),
      );
      expect(await svc.configuracion(ORG)).toBeNull();
    });

    it('sin enlace en ningún lado: null', async () => {
      config.get.mockReturnValue(undefined);
      expect((await svc.configuracion(ORG))?.urlPolitica).toBeNull();
    });
  });

  describe('urlPolitica (para el resumen de la cita)', () => {
    it('la de la clínica, la del servidor, o la del servidor si la base falla', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValueOnce({
        dataPolicyUrl: 'https://c/d',
      });
      expect(await svc.urlPolitica(ORG)).toBe('https://c/d');
      prisma.organizationSettings.findUnique.mockResolvedValueOnce(null);
      expect(await svc.urlPolitica(ORG)).toBe('https://servidor/politica');
      prisma.organizationSettings.findUnique.mockRejectedValueOnce(
        new Error('caída'),
      );
      expect(await svc.urlPolitica(ORG)).toBe('https://servidor/politica');
      config.get.mockReturnValue(undefined);
      prisma.organizationSettings.findUnique.mockRejectedValueOnce(
        new Error('caída'),
      );
      expect(await svc.urlPolitica(ORG)).toBeUndefined();
      prisma.organizationSettings.findUnique.mockResolvedValueOnce(null);
      expect(await svc.urlPolitica(ORG)).toBeUndefined();
    });
  });

  describe('vigente', () => {
    const si = (d: string) => ({ answeredAt: new Date(d) });

    it('busca por la clave, el teléfono y el BSUID del remitente', async () => {
      await svc.vigente(ORG, WA, '1');
      expect(prisma.dataConsent.findFirst.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
        OR: [
          { senderKey: WA.senderId },
          { phone: WA.phone },
          { bsuid: WA.bsuid },
        ],
        status: 'ACCEPTED',
        policyVersion: '1',
      });
      await svc.vigente(ORG, TG, '1');
      expect(prisma.dataConsent.findFirst.mock.calls[2][0].where.OR).toEqual([
        { senderKey: 'tg:555' },
      ]);
    });

    it('sin SÍ, no; con SÍ y sin retiro, sí; un retiro después lo anula; uno anterior, no', async () => {
      expect(await svc.vigente(ORG, WA, '1')).toBe(false);

      prisma.dataConsent.findFirst
        .mockResolvedValueOnce(si('2026-11-20T10:00:00Z'))
        .mockResolvedValueOnce(null);
      expect(await svc.vigente(ORG, WA, '1')).toBe(true);

      prisma.dataConsent.findFirst
        .mockResolvedValueOnce(si('2026-11-20T10:00:00Z'))
        .mockResolvedValueOnce(si('2026-11-20T11:00:00Z'));
      expect(await svc.vigente(ORG, WA, '1')).toBe(false);

      prisma.dataConsent.findFirst
        .mockResolvedValueOnce(si('2026-11-20T12:00:00Z'))
        .mockResolvedValueOnce(si('2026-11-20T11:00:00Z'));
      expect(await svc.vigente(ORG, WA, '1')).toBe(true);
    });
  });

  describe('necesitaPreguntar y autorizoYa', () => {
    it('encendida y sin SÍ: pregunta; con SÍ: no', async () => {
      expect(await svc.necesitaPreguntar(ORG, WA)).toMatchObject({
        version: '2',
      });
      expect(await svc.autorizoYa(ORG, WA)).toBe(false);
      prisma.dataConsent.findFirst.mockResolvedValue({
        answeredAt: new Date(),
      });
      prisma.dataConsent.findFirst
        .mockResolvedValueOnce({ answeredAt: new Date() })
        .mockResolvedValueOnce(null);
      expect(await svc.necesitaPreguntar(ORG, WA)).toBeNull();
    });

    it('apagada: ni pregunta ni quita el párrafo legal', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        dataConsentEnabled: false,
      });
      expect(await svc.necesitaPreguntar(ORG, WA)).toBeNull();
      expect(await svc.autorizoYa(ORG, WA)).toBe(false);
    });

    it('si la base falla al revisar: no pregunta (el chat sigue) y deja el párrafo legal', async () => {
      prisma.dataConsent.findFirst.mockRejectedValue(new Error('caída'));
      expect(await svc.necesitaPreguntar(ORG, WA)).toBeNull();
      expect(await svc.autorizoYa(ORG, WA)).toBe(false);
    });
  });

  describe('registrarPregunta', () => {
    const p = { version: '1', urlPolitica: 'https://x', aviso: 'AVISO' };

    it('sin pregunta abierta crea la fila (Telegram va como TELEGRAM)', async () => {
      expect(await svc.registrarPregunta(ORG, TG, { ...p, filaId: null })).toBe(
        'nueva',
      );
      expect(prisma.dataConsent.create.mock.calls[0][0].data).toEqual({
        organizationId: ORG,
        channel: 'TELEGRAM',
        senderKey: 'tg:555',
        phone: null,
        bsuid: null,
        policyVersion: '1',
        policyUrl: 'https://x',
        noticeText: 'AVISO',
      });
    });

    it('con la pregunta abierta solo suma una vez', async () => {
      expect(
        await svc.registrarPregunta(ORG, WA, { ...p, filaId: 'abierta' }),
      ).toBe('abierta');
      expect(prisma.dataConsent.updateMany).toHaveBeenCalledWith({
        where: { id: 'abierta', organizationId: ORG, status: 'PENDING' },
        data: { timesAsked: { increment: 1 } },
      });
      expect(prisma.dataConsent.create).not.toHaveBeenCalled();
    });

    it('si esa pregunta ya se respondió, crea otra', async () => {
      prisma.dataConsent.updateMany.mockResolvedValue({ count: 0 });
      expect(
        await svc.registrarPregunta(ORG, WA, { ...p, filaId: 'vieja' }),
      ).toBe('nueva');
      expect(prisma.dataConsent.create.mock.calls[0][0].data.channel).toBe(
        'WHATSAPP',
      );
    });
  });

  describe('registrarRespuesta', () => {
    const base = {
      version: '1',
      urlPolitica: null,
      aviso: 'AVISO',
      via: 'TEXT' as const,
    };

    it('el SÍ va a la pregunta abierta, recortado', async () => {
      await svc.registrarRespuesta(ORG, WA, {
        ...base,
        filaId: 'abierta',
        respuesta: 'SI',
        texto: `  ${'sí '.repeat(300)}`,
      });
      const { where, data } = prisma.dataConsent.updateMany.mock.calls[0][0];
      expect(where).toEqual({
        id: 'abierta',
        organizationId: ORG,
        status: 'PENDING',
      });
      expect(data.status).toBe('ACCEPTED');
      expect(data.answerText).toHaveLength(500);
      expect(data.answeredAt).toBeInstanceOf(Date);
      expect(prisma.dataConsent.create).not.toHaveBeenCalled();
    });

    it('sin filaId busca la última pregunta sin respuesta de esa versión', async () => {
      prisma.dataConsent.findFirst.mockResolvedValue({ id: 'ultima' });
      await svc.registrarRespuesta(ORG, WA, {
        ...base,
        filaId: null,
        respuesta: 'NO',
        texto: 'no',
      });
      expect(prisma.dataConsent.findFirst.mock.calls[0][0]).toMatchObject({
        where: { status: 'PENDING', policyVersion: '1' },
        orderBy: { askedAt: 'desc' },
      });
      expect(prisma.dataConsent.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 'ultima' },
        data: { status: 'REJECTED', answerText: 'no', answerVia: 'TEXT' },
      });
    });

    it('si no hay pregunta abierta (o ya se respondió), la respuesta crea su fila completa', async () => {
      await svc.registrarRespuesta(ORG, WA, {
        ...base,
        filaId: null,
        respuesta: 'SI',
        texto: '',
      });
      expect(prisma.dataConsent.create.mock.calls[0][0].data).toMatchObject({
        status: 'ACCEPTED',
        noticeText: 'AVISO',
        answerText: null,
        phone: WA.phone,
        bsuid: WA.bsuid,
      });

      prisma.dataConsent.updateMany.mockResolvedValue({ count: 0 });
      await svc.registrarRespuesta(ORG, WA, {
        ...base,
        filaId: 'ya-respondida',
        respuesta: 'SI',
        texto: 'sí',
      });
      expect(prisma.dataConsent.create).toHaveBeenCalledTimes(2);
    });
  });

  it('retirar crea una fila REVOKED con lo que escribió y lo que se le respondió', async () => {
    await svc.retirar(ORG, WA, {
      version: '1',
      urlPolitica: null,
      texto: 'Retiro mi autorización',
      respuesta: 'Listo…',
    });
    const data = prisma.dataConsent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'REVOKED',
      noticeText: 'Listo…',
      answerText: 'Retiro mi autorización',
      answerVia: 'TEXT',
    });
    expect(data.askedAt).toEqual(data.answeredAt);
  });

  describe('enlazarPaciente', () => {
    it('agrega el paciente a la autorización vigente, una sola vez', async () => {
      prisma.dataConsent.findFirst
        .mockResolvedValueOnce({ answeredAt: new Date() }) // vigente: SÍ
        .mockResolvedValueOnce(null) // vigente: sin retiro
        .mockResolvedValueOnce({ id: 'fila', patientIds: [] });
      await svc.enlazarPaciente(ORG, WA, 'pat-1');
      expect(prisma.dataConsent.update).toHaveBeenCalledWith({
        where: { id: 'fila' },
        data: { patientIds: { push: 'pat-1' } },
      });

      prisma.dataConsent.findFirst
        .mockResolvedValueOnce({ answeredAt: new Date() })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fila', patientIds: ['pat-1'] });
      await svc.enlazarPaciente(ORG, WA, 'pat-1');
      expect(prisma.dataConsent.update).toHaveBeenCalledTimes(1);
    });

    it('apagada o sin autorización vigente: nada', async () => {
      await svc.enlazarPaciente(ORG, WA, 'pat-1');
      prisma.organizationSettings.findUnique.mockResolvedValue({
        dataConsentEnabled: false,
      });
      await svc.enlazarPaciente(ORG, WA, 'pat-1');
      expect(prisma.dataConsent.update).not.toHaveBeenCalled();
    });

    it('vigente pero sin la fila (carrera): nada', async () => {
      prisma.dataConsent.findFirst
        .mockResolvedValueOnce({ answeredAt: new Date() })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      await svc.enlazarPaciente(ORG, WA, 'pat-1');
      expect(prisma.dataConsent.update).not.toHaveBeenCalled();
    });

    it('si la base falla, nunca frena la cita', async () => {
      prisma.dataConsent.findFirst.mockRejectedValue(new Error('caída'));
      await expect(
        svc.enlazarPaciente(ORG, WA, 'pat-1'),
      ).resolves.toBeUndefined();
    });
  });
});
