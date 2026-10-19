import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { ROLES_KEY } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TechAlertsController } from './tech-alerts.controller';
import type { TechAlertConfigService } from './tech-alert-config.service';
import type { TechAlertService } from './tech-alert.service';

/**
 * 🚨 Solo el SUPER_ADMIN: el canal con el equipo técnico no es de ninguna
 * clínica. El administrador de la clínica recibe 403 en TODAS las rutas, y el
 * actor de la auditoría sale del token, no del body.
 */
describe('TechAlertsController', () => {
  const SECRETO = 'secreto-de-prueba';
  const ORIGINAL = process.env.JWT_SECRET;

  let config: Record<string, jest.Mock>;
  let alerts: { listar: jest.Mock };
  let controller: TechAlertsController;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRETO;
    config = Object.fromEntries(
      [
        'getPublic',
        'updateSettings',
        'connect',
        'disconnect',
        'startLink',
        'findLink',
        'sendTest',
        'mute',
        'unmute',
      ].map((m) => [m, jest.fn(async () => m)]),
    );
    alerts = { listar: jest.fn(async () => ({ rows: [], total: 0 })) };
    controller = new TechAlertsController(
      config as unknown as TechAlertConfigService,
      alerts as unknown as TechAlertService,
    );
  });

  afterEach(() => {
    process.env.JWT_SECRET = ORIGINAL;
  });

  it('todo el controlador exige SUPER_ADMIN, y ningún método lo afloja', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TechAlertsController)).toEqual([
      'SUPER_ADMIN',
    ]);
    const proto = TechAlertsController.prototype as unknown as Record<
      string,
      () => unknown
    >;
    for (const metodo of Object.getOwnPropertyNames(proto)) {
      if (metodo === 'constructor') continue;
      expect(Reflect.getMetadata(ROLES_KEY, proto[metodo])).toBeUndefined();
    }
  });

  describe('el guard real, con un token real', () => {
    const contexto = (rol: string, organizationId: string | null) => {
      const token = jwt.sign(
        { userId: 'u1', email: 'a@b.co', role: rol, organizationId },
        SECRETO,
      );
      const request = { headers: { authorization: `Bearer ${token}` } };
      return {
        getHandler: () => TechAlertsController.prototype.getConfig,
        getClass: () => TechAlertsController,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
    };
    const guard = new RolesGuard(new Reflector());

    it('👑 SUPER_ADMIN pasa', () => {
      expect(guard.canActivate(contexto('SUPER_ADMIN', null))).toBe(true);
    });

    it.each(['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR'])(
      '🏥 %s recibe 403',
      (rol) => {
        expect(() => guard.canActivate(contexto(rol, 'org-1'))).toThrow(
          ForbiddenException,
        );
      },
    );
  });

  it('el actor sale del token y la IP de x-forwarded-for, nunca del body', async () => {
    const user = {
      userId: 'u-super',
      email: 'soporte@agenia.co',
      role: 'SUPER_ADMIN',
    };
    const req = {
      headers: { 'x-forwarded-for': '186.87.28.46, 10.0.0.2' },
      ip: '10.0.0.2',
    } as never;
    await controller.connect({ botToken: 't' }, user, req);
    expect(config.connect).toHaveBeenCalledWith('t', {
      userId: 'u-super',
      email: 'soporte@agenia.co',
      ip: '186.87.28.46',
    });
    await controller.mute({ opcion: 'UNA_HORA' }, user, {
      headers: {},
      ip: '1.2.3.4',
    } as never);
    expect(config.mute).toHaveBeenCalledWith('UNA_HORA', {
      userId: 'u-super',
      email: 'soporte@agenia.co',
      ip: '1.2.3.4',
    });
  });

  it('cada ruta llega a su método', async () => {
    const user = { userId: 'u', email: 'e', role: 'SUPER_ADMIN' };
    const req = { headers: {} } as never;
    await expect(controller.getConfig()).resolves.toBe('getPublic');
    await expect(
      controller.updateConfig({ enabled: true }, user, req),
    ).resolves.toBe('updateSettings');
    await expect(
      controller.updateConfig(undefined as never, user, req),
    ).resolves.toBe('updateSettings');
    expect(config.updateSettings).toHaveBeenLastCalledWith(
      {},
      { userId: 'u', email: 'e', ip: null },
    );
    await expect(controller.disconnect(user, req)).resolves.toBe('disconnect');
    await expect(controller.startLink(user, req)).resolves.toBe('startLink');
    await expect(controller.findLink(user, req)).resolves.toBe('findLink');
    await expect(controller.test()).resolves.toBe('sendTest');
    await expect(controller.unmute(user, req)).resolves.toBe('unmute');
  });

  it('la bitácora pasa los filtros, y lo que no es número se ignora', async () => {
    await controller.list('ABIERTA', '20', 'abc');
    expect(alerts.listar).toHaveBeenCalledWith({
      status: 'ABIERTA',
      limit: 20,
      offset: undefined,
    });
    await controller.list();
    expect(alerts.listar).toHaveBeenLastCalledWith({
      status: undefined,
      limit: undefined,
      offset: undefined,
    });
  });
});
