import { ChannelActivityService } from './channel-activity.service';

describe('ChannelActivityService', () => {
  const ENV = { ...process.env };
  let prisma: { channelActivityLog: { create: jest.Mock } };

  const build = () => {
    const s = new ChannelActivityService(prisma as never);
    jest.spyOn(s['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(s['logger'], 'error').mockImplementation(() => undefined);
    return s;
  };
  const datos = () => prisma.channelActivityLog.create.mock.calls[0][0].data;

  beforeEach(() => {
    process.env = { ...ENV, ENCRYPTION_KEY: 'clave-de-prueba' };
    delete process.env.CHANNEL_ACTIVITY_HASH_KEY;
    prisma = { channelActivityLog: { create: jest.fn(async () => ({})) } };
  });
  afterAll(() => {
    process.env = ENV;
  });

  it('registra canal, clínica, evento y tipo, SIN el remitente en claro', async () => {
    await build().record({
      organizationId: 'org-1',
      senderId: '573001234567',
      event: 'INBOUND',
      messageType: 'text',
    });
    const d = datos();
    expect(d).toMatchObject({
      organizationId: 'org-1',
      channel: 'WHATSAPP',
      event: 'INBOUND',
      messageType: 'text',
    });
    expect(d.senderHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(d)).not.toContain('3001234567');
  });

  it('un remitente tg: es Telegram', async () => {
    await build().record({
      organizationId: 'o',
      senderId: 'tg:99',
      event: 'BOOKED',
    });
    expect(datos().channel).toBe('TELEGRAM');
  });

  it('el mismo remitente da el mismo hash (se puede contar personas distintas)…', () => {
    const s = build();
    expect(s.hashSender('o', '57300')).toBe(s.hashSender('o', ' 57300 '));
  });

  it('…pero distinto en otra clínica (no se cruza el paciente entre clínicas)', () => {
    const s = build();
    expect(s.hashSender('o1', '57300')).not.toBe(s.hashSender('o2', '57300'));
  });

  it('depende de la clave: sin ella, un SHA de 10 dígitos se revertiría por fuerza bruta', () => {
    const a = build().hashSender('o', '57300');
    process.env.CHANNEL_ACTIVITY_HASH_KEY = 'otra';
    expect(build().hashSender('o', '57300')).not.toBe(a);
  });

  it('sin ninguna clave NO registra (y lo avisa una sola vez)', async () => {
    delete process.env.ENCRYPTION_KEY;
    const s = build();
    await s.record({ organizationId: 'o', senderId: '1', event: 'INBOUND' });
    await s.record({ organizationId: 'o', senderId: '1', event: 'INBOUND' });
    expect(prisma.channelActivityLog.create).not.toHaveBeenCalled();
    expect(s['logger'].warn).toHaveBeenCalledTimes(1);
  });

  it('sin clínica o sin remitente no registra', async () => {
    const s = build();
    await s.record({ organizationId: null, senderId: '1', event: 'INBOUND' });
    await s.record({ organizationId: 'o', senderId: '', event: 'INBOUND' });
    expect(prisma.channelActivityLog.create).not.toHaveBeenCalled();
  });

  it('🛡️ si la base falla, NO propaga: la conversación sigue', async () => {
    prisma.channelActivityLog.create.mockRejectedValue(new Error('BD caída'));
    await expect(
      build().record({ organizationId: 'o', senderId: '1', event: 'INBOUND' }),
    ).resolves.toBeUndefined();
  });
});
