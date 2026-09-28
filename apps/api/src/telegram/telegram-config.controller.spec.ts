import { ForbiddenException } from '@nestjs/common';
import { TelegramConfigController } from './telegram-config.controller';
import type { TelegramConfigService } from './telegram-config.service';

/**
 * 🏢 El tenant sale del token, nunca del body: sin organización no se toca
 * nada, y cada acción opera sobre la clínica de quien la pide.
 */
describe('TelegramConfigController', () => {
  const ORG = 'org-1';
  let service: Record<
    'getPublic' | 'connect' | 'verify' | 'disconnect',
    jest.Mock
  >;
  let controller: TelegramConfigController;

  beforeEach(() => {
    service = {
      getPublic: jest.fn(async () => 'pub'),
      connect: jest.fn(async () => 'conn'),
      verify: jest.fn(async () => 'ver'),
      disconnect: jest.fn(async () => 'disc'),
    };
    controller = new TelegramConfigController(
      service as unknown as TelegramConfigService,
    );
  });

  it('cada acción opera sobre la clínica del token', async () => {
    await expect(controller.getMine(ORG)).resolves.toBe('pub');
    await expect(controller.connect(ORG, { botToken: 't' })).resolves.toBe(
      'conn',
    );
    await expect(controller.verify(ORG)).resolves.toBe('ver');
    await expect(controller.disconnect(ORG)).resolves.toBe('disc');
    expect(service.getPublic).toHaveBeenCalledWith(ORG);
    expect(service.connect).toHaveBeenCalledWith(ORG, 't');
    expect(service.verify).toHaveBeenCalledWith(ORG);
    expect(service.disconnect).toHaveBeenCalledWith(ORG);
  });

  it('un body vacío no revienta: el servicio rechaza el token ausente', async () => {
    await controller.connect(ORG, undefined as never);
    expect(service.connect).toHaveBeenCalledWith(ORG, undefined);
  });

  it('sin organización → 403 en todas', async () => {
    const sinOrg = '' as string;
    await expect(controller.getMine(sinOrg)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.connect(sinOrg, { botToken: 't' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.verify(sinOrg)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.disconnect(sinOrg)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    for (const m of Object.values(service)) expect(m).not.toHaveBeenCalled();
  });
});
