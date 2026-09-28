import { Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { WhatsappTemplateService } from './whatsapp-template.service';

/**
 * Red de seguridad (docs/PLAN_TELEGRAM.md §8): ningún llamador debería pedir
 * una plantilla de Meta para un remitente de Telegram, pero si alguno lo hace,
 * el envío se corta ANTES de consultar plantilla, credenciales o Meta.
 */
describe('WhatsappTemplateService — destinatario de Telegram', () => {
  it('no llama a Meta ni a nada más', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const post = jest.fn(() => of({ data: {} }));
    const prisma = { whatsappTemplate: { findFirst: jest.fn() } };
    const credentials = { forOrg: jest.fn() };
    const messageLog = { recordOutbound: jest.fn() };
    const service = new WhatsappTemplateService(
      prisma as any,
      { post } as any,
      credentials as any,
      messageLog as any,
    );

    const res = await service.sendTemplate({
      organizationId: 'org-1',
      recipientId: 'tg:3001112233',
      kind: 'APPOINTMENT_REMINDER',
      bodyParams: ['Ana', 'Cardiología', 'Dr. Ruiz', 'martes 3pm'],
    });

    expect(res).toEqual({ success: false, error: 'not-a-whatsapp-recipient' });
    expect(post).not.toHaveBeenCalled();
    expect(credentials.forOrg).not.toHaveBeenCalled();
    expect(prisma.whatsappTemplate.findFirst).not.toHaveBeenCalled();
    expect(messageLog.recordOutbound).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
