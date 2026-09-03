import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { RolesGuard } from './roles.guard';

/**
 * La puerta de todo el dashboard clínico. Un fallo abierto aquí es un tenant
 * leyendo las citas de otro, así que las pruebas están escritas del lado del
 * atacante: token ausente, token forjado, usuario sin clínica, rol que no
 * alcanza, y el caso más peligroso — que el servidor arranque SIN JWT_SECRET.
 */
describe('RolesGuard', () => {
  const SECRETO = 'secreto-de-pruebas';
  const SECRETO_ORIGINAL = process.env.JWT_SECRET;

  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const contexto = (request: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const peticionConToken = (
    payload: Record<string, unknown>,
    donde: 'cookies' | 'authorization' | 'cookie-header' = 'authorization',
    secreto = SECRETO,
  ) => {
    const token = jwt.sign(payload, secreto);
    if (donde === 'cookies')
      return { cookies: { auth_token: token }, headers: {} };
    if (donde === 'cookie-header')
      return { headers: { cookie: `otra=1; auth_token=${token}; x=2` } };
    return { headers: { authorization: `Bearer ${token}` } };
  };

  beforeEach(() => {
    process.env.JWT_SECRET = SECRETO;
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']) };
    guard = new RolesGuard(reflector as unknown as Reflector);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (SECRETO_ORIGINAL === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = SECRETO_ORIGINAL;
    jest.restoreAllMocks();
  });

  it('una ruta sin @Roles es pública: pasa sin mirar el token', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contexto({ headers: {} }))).toBe(true);
  });

  describe('de dónde sale el token', () => {
    it.each(['authorization', 'cookies', 'cookie-header'] as const)(
      'lo encuentra en %s',
      (donde) => {
        const req = peticionConToken(
          { role: 'ADMIN', organizationId: 'org-1', id: 'u1' },
          donde,
        );
        expect(guard.canActivate(contexto(req))).toBe(true);
        expect((req as any).user.organizationId).toBe('org-1');
      },
    );

    it('la cookie manda sobre el header cuando vienen las dos', () => {
      const bueno = jwt.sign(
        { role: 'ADMIN', organizationId: 'org-1' },
        SECRETO,
      );
      const malo = jwt.sign(
        { role: 'ADMIN', organizationId: 'org-2' },
        SECRETO,
      );
      const req: any = {
        cookies: { auth_token: bueno },
        headers: { authorization: `Bearer ${malo}` },
      };
      guard.canActivate(contexto(req));
      expect(req.user.organizationId).toBe('org-1');
    });

    it('sin token en ningún sitio → 403', () => {
      expect(() => guard.canActivate(contexto({ headers: {} }))).toThrow(
        ForbiddenException,
      );
    });

    it('una cookie con otro nombre no cuenta como token', () => {
      expect(() =>
        guard.canActivate(contexto({ headers: { cookie: 'sesion=abc' } })),
      ).toThrow(ForbiddenException);
    });
  });

  describe('🔒 JWT_SECRET', () => {
    it('sin JWT_SECRET se rechaza TODO: nunca hay secreto por defecto', () => {
      delete process.env.JWT_SECRET;
      const req = peticionConToken({ role: 'ADMIN', organizationId: 'org-1' });
      expect(() => guard.canActivate(contexto(req))).toThrow(/JWT_SECRET/);
    });

    it('un token firmado con OTRO secreto se rechaza', () => {
      const req = peticionConToken(
        { role: 'ADMIN', organizationId: 'org-1' },
        'authorization',
        'secreto-del-atacante',
      );
      expect(() => guard.canActivate(contexto(req))).toThrow('Invalid token');
    });

    it('un token corrupto se rechaza sin reventar', () => {
      expect(() =>
        guard.canActivate(
          contexto({ headers: { authorization: 'Bearer no-es-un-jwt' } }),
        ),
      ).toThrow('Invalid token');
    });

    it('un token expirado se rechaza', () => {
      const token = jwt.sign(
        { role: 'ADMIN', organizationId: 'org-1' },
        SECRETO,
        { expiresIn: '-1s' },
      );
      expect(() =>
        guard.canActivate(
          contexto({ headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toThrow('Invalid token');
    });
  });

  describe('🏢 aislamiento de tenant', () => {
    it('un usuario sin organizationId se rechaza', () => {
      const req = peticionConToken({ role: 'ADMIN' });
      expect(() => guard.canActivate(contexto(req))).toThrow(
        /no pertenece a ninguna organización/,
      );
    });

    it('SUPER_ADMIN es la única excepción: puede no tener clínica', () => {
      reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
      const req = peticionConToken({ role: 'SUPER_ADMIN' });
      expect(guard.canActivate(contexto(req))).toBe(true);
    });
  });

  describe('rol requerido', () => {
    it('el rol que la ruta pide pasa', () => {
      reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'DOCTOR']);
      const req = peticionConToken({ role: 'DOCTOR', organizationId: 'org-1' });
      expect(guard.canActivate(contexto(req))).toBe(true);
    });

    it('un rol que no está en la lista se rechaza', () => {
      reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const req = peticionConToken({
        role: 'BOOKING_AGENT',
        organizationId: 'org-1',
      });
      expect(() => guard.canActivate(contexto(req))).toThrow(/required role/);
    });

    it('una lista de roles vacía no deja pasar a nadie', () => {
      reflector.getAllAndOverride.mockReturnValue([]);
      const req = peticionConToken({ role: 'ADMIN', organizationId: 'org-1' });
      // [] es "truthy": la ruta declara @Roles() sin nadie, así que nadie entra.
      expect(() => guard.canActivate(contexto(req))).toThrow(
        ForbiddenException,
      );
    });
  });

  it('el usuario decodificado queda en la request para los decoradores', () => {
    const req: any = peticionConToken({
      role: 'ADMIN',
      organizationId: 'org-1',
      id: 'u-9',
    });
    guard.canActivate(contexto(req));
    expect(req.user).toMatchObject({
      role: 'ADMIN',
      organizationId: 'org-1',
      id: 'u-9',
    });
  });
});
