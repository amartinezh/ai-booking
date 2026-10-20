import 'reflect-metadata';
import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLES_KEY } from '../common/roles.decorator';
import { SupportBotWebhookController } from './support-bot-webhook.controller';
import {
  SupportBotAdminController,
  SupportBotPanelController,
} from './support-bot.controller';
import { supportBotEnabled } from './support-bot.module';
import type { SupportBotConfigService } from './support-bot-config.service';
import type { SupportBotSessionService } from './support-bot-session.service';
import type { SupportBotService } from './support-bot.service';
import type { InboundQueueService } from '../chatbot/inbound-queue.service';
import type { Request } from 'express';

describe('SupportBotWebhookController', () => {
  const RT = { enabled: true, token: 't', routeKey: 'r', webhookSecret: 's' };
  let config: { destinoDelWebhook: jest.Mock };
  let bot: { procesar: jest.Mock };
  let cola: {
    admit: jest.Mock;
    enqueue: jest.Mock;
    releaseAdmission: jest.Mock;
  };
  let ctrl: SupportBotWebhookController;
  const update = {
    update_id: 5,
    message: {
      from: { id: 7 },
      chat: { id: 7, type: 'private' },
      text: 'hola',
    },
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    config = { destinoDelWebhook: jest.fn(async () => RT) };
    bot = { procesar: jest.fn(async () => undefined) };
    cola = {
      admit: jest.fn(async () => true),
      enqueue: jest.fn((_k: string, tarea: () => Promise<void>) => {
        void tarea();
        return true;
      }),
      releaseAdmission: jest.fn(async () => undefined),
    };
    ctrl = new SupportBotWebhookController(
      config as unknown as SupportBotConfigService,
      bot as unknown as SupportBotService,
      cola as unknown as InboundQueueService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('🔒 ruta o secreto inválidos: 401 y no llega al bot', async () => {
    config.destinoDelWebhook.mockResolvedValue(null);
    await expect(ctrl.recibir('r', update, 'malo')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(config.destinoDelWebhook).toHaveBeenCalledWith('r', 'malo');
    expect(bot.procesar).not.toHaveBeenCalled();
  });

  it('apagado desde el panel: 200 y nada más', async () => {
    config.destinoDelWebhook.mockResolvedValue({ ...RT, enabled: false });
    await expect(ctrl.recibir('r', update, 's')).resolves.toEqual({ ok: true });
    expect(cola.admit).not.toHaveBeenCalled();
  });

  it('lo que no atiende (un grupo) se descarta con 200', async () => {
    await ctrl.recibir(
      'r',
      {
        update_id: 6,
        message: {
          from: { id: 7 },
          chat: { id: -1, type: 'group' },
          text: 'x',
        },
      },
      's',
    );
    expect(cola.admit).not.toHaveBeenCalled();
  });

  it('deduplica por update_id y encola por cuenta de Telegram', async () => {
    await ctrl.recibir('r', update, 's');
    expect(cola.admit).toHaveBeenCalledWith('soporte:5');
    expect(cola.enqueue.mock.calls[0][0]).toBe('soporte:7');
    expect(bot.procesar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'mensaje', texto: 'hola' }),
      RT,
    );
  });

  it('un update repetido no se encola', async () => {
    cola.admit.mockResolvedValue(false);
    await expect(ctrl.recibir('r', update, 's')).resolves.toEqual({ ok: true });
    expect(cola.enqueue).not.toHaveBeenCalled();
  });

  it('con la cola llena libera la deduplicación y responde 503 (Telegram reintenta)', async () => {
    cola.enqueue.mockReturnValue(false);
    await expect(ctrl.recibir('r', update, 's')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(cola.releaseAdmission).toHaveBeenCalledWith('soporte:5');
  });
});

describe('SupportBotPanelController y SupportBotAdminController', () => {
  const USER = { userId: 'u-1', email: 'ana@x.co', role: 'BOOKING_AGENT' };
  const SA = { userId: 'sa', email: 'sa@agenia.co', role: 'SUPER_ADMIN' };
  const req = { ip: '10.0.0.9' } as Request;
  let sesiones: Record<string, jest.Mock>;
  let bot: { avisarCierreDesdePanel: jest.Mock };
  let config: Record<string, jest.Mock>;

  beforeEach(() => {
    sesiones = {
      estadoPara: jest.fn(async () => ({ disponible: true })),
      generarCodigo: jest.fn(async () => ({ codigo: '123456' })),
      cerrarDesdePanel: jest.fn(async () => '777'),
      cambiarAvisos: jest.fn(async () => undefined),
    };
    bot = { avisarCierreDesdePanel: jest.fn(async () => undefined) };
    config = {
      getPublic: jest.fn(async () => ({})),
      updateSettings: jest.fn(async () => ({})),
      connect: jest.fn(async () => ({})),
      disconnect: jest.fn(async () => ({})),
    };
  });

  it('🔒 la tarjeta es del personal de la clínica (no del paciente ni del super admin)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SupportBotPanelController)).toEqual([
      'ORG_ADMIN',
      'BOOKING_AGENT',
      'DOCTOR',
      'GENERAL_OBSERVER',
    ]);
  });

  it('🔒 la configuración es solo del super admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SupportBotAdminController)).toEqual([
      'SUPER_ADMIN',
    ]);
  });

  it('el código y el estado salen del usuario del token', async () => {
    const ctrl = new SupportBotPanelController(
      sesiones as unknown as SupportBotSessionService,
      bot as unknown as SupportBotService,
    );
    await ctrl.codigo(USER);
    expect(sesiones.generarCodigo).toHaveBeenCalledWith('u-1');
    await ctrl.estado(USER);
    expect(sesiones.estadoPara).toHaveBeenCalledWith('u-1');
  });

  it('cerrar desde el panel le avisa al chat; sin conversación, no', async () => {
    const ctrl = new SupportBotPanelController(
      sesiones as unknown as SupportBotSessionService,
      bot as unknown as SupportBotService,
    );
    await ctrl.cerrar(USER);
    expect(bot.avisarCierreDesdePanel).toHaveBeenCalledWith('777');
    sesiones.cerrarDesdePanel.mockResolvedValue(null);
    bot.avisarCierreDesdePanel.mockClear();
    await ctrl.cerrar(USER);
    expect(bot.avisarCierreDesdePanel).not.toHaveBeenCalled();
  });

  it('los avisos se cambian solo con un booleano', async () => {
    const ctrl = new SupportBotPanelController(
      sesiones as unknown as SupportBotSessionService,
      bot as unknown as SupportBotService,
    );
    await ctrl.avisos({ activos: false }, USER);
    expect(sesiones.cambiarAvisos).toHaveBeenCalledWith('u-1', false);
    await expect(ctrl.avisos({ activos: 'no' }, USER)).rejects.toThrow(
      /verdadero o falso/,
    );
  });

  it('el super admin: el actor sale del token, y el código de prueba exige una clínica', async () => {
    const ctrl = new SupportBotAdminController(
      config as unknown as SupportBotConfigService,
      sesiones as unknown as SupportBotSessionService,
    );
    await ctrl.getConfig();
    await ctrl.connect({ botToken: 'x' }, SA, req);
    expect(config.connect).toHaveBeenCalledWith('x', {
      userId: 'sa',
      email: 'sa@agenia.co',
      ip: '10.0.0.9',
    });
    await ctrl.updateConfig({ enabled: true }, SA, req);
    expect(config.updateSettings).toHaveBeenCalledWith(
      { enabled: true },
      expect.objectContaining({ userId: 'sa' }),
    );
    await ctrl.updateConfig(undefined as never, SA, {} as Request);
    expect(config.updateSettings).toHaveBeenLastCalledWith(
      {},
      { userId: 'sa', email: 'sa@agenia.co', ip: null },
    );
    await ctrl.disconnect(SA, req);
    expect(config.disconnect).toHaveBeenCalled();

    expect(() => ctrl.codigoDePrueba({}, SA)).toThrow(/Elija la clínica/);
    await ctrl.codigoDePrueba({ organizationId: 'org-9' }, SA);
    expect(sesiones.generarCodigo).toHaveBeenCalledWith('sa', {
      testOrganizationId: 'org-9',
    });
  });
});

describe('supportBotEnabled', () => {
  it.each([
    ['true', true],
    [' true ', true],
    ['TRUE', false],
    ['1', false],
    ['yes', false],
    [undefined, false],
  ])('SUPPORT_BOT_ENABLED=%p → %p', (valor, esperado) => {
    expect(
      supportBotEnabled({ SUPPORT_BOT_ENABLED: valor } as NodeJS.ProcessEnv),
    ).toBe(esperado);
  });
});
