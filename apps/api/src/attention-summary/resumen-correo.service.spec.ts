const sendMail = jest.fn(async () => ({ messageId: '<m1@agenia>' }));
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({
  createTransport: (...a: unknown[]) => createTransport(...(a as [])),
}));

import { ResumenCorreoService } from './resumen-correo.service';

// El correo por SMTP (Fase 3): sin SMTP_HOST y MAIL_FROM no sale nada; con
// ellos, el mensaje lleva el remitente, el adjunto y no lanza si el servidor falla.
describe('ResumenCorreoService', () => {
  const antes = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
      'MAIL_REPLY_TO',
    ])
      delete process.env[k];
  });
  afterAll(() => {
    process.env = antes;
  });

  it('sin configurar: no está disponible y no intenta enviar', async () => {
    const s = new ResumenCorreoService();
    expect(s.estado()).toEqual({ configurado: false, remitente: null });
    await expect(
      s.enviar({ para: 'a@b.co', asunto: 'x', texto: 'x', html: 'x' }),
    ).resolves.toEqual({
      ok: false,
      error: 'El correo no está configurado en el servidor',
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('configurado: SMTP con usuario, remitente, respuesta y el PDF adjunto', async () => {
    Object.assign(process.env, {
      SMTP_HOST: 'smtp.proveedor.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      MAIL_FROM: 'Hospital <documentos@hospital.co>',
      MAIL_REPLY_TO: 'no-responder@hospital.co',
    });
    const s = new ResumenCorreoService();
    expect(s.estado()).toEqual({
      configurado: true,
      remitente: 'Hospital <documentos@hospital.co>',
    });
    await expect(
      s.enviar({
        para: 'ana@gmail.com',
        asunto: 'Documentos',
        texto: 't',
        html: '<p>t</p>',
        adjunto: {
          nombre: 'D.pdf',
          datos: Buffer.from('%PDF'),
          tipo: 'application/pdf',
        },
      }),
    ).resolves.toEqual({ ok: true, id: '<m1@agenia>' });
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.proveedor.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Hospital <documentos@hospital.co>',
        replyTo: 'no-responder@hospital.co',
        to: 'ana@gmail.com',
        attachments: [
          {
            filename: 'D.pdf',
            content: Buffer.from('%PDF'),
            contentType: 'application/pdf',
          },
        ],
      }),
    );
  });

  it('si el servidor rechaza, devuelve el motivo sin lanzar', async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.x', MAIL_FROM: 'a@b.co' });
    sendMail.mockRejectedValueOnce(
      new Error('550 mailbox unavailable') as never,
    );
    await expect(
      new ResumenCorreoService().enviar({
        para: 'a@b.co',
        asunto: 'x',
        texto: 'x',
        html: 'x',
      }),
    ).resolves.toEqual({
      ok: false,
      error: '550 mailbox unavailable',
    });
  });
});
