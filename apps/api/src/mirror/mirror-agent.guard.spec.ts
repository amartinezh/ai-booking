import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { MirrorAgentGuard } from './mirror-agent.guard';
import { generateAgentToken, hashAgentToken } from './mirror-token.util';

describe('MirrorAgentGuard', () => {
  const buildContext = (authorization?: string): ExecutionContext => {
    const request: any = {
      headers: { authorization },
      mirrorConfig: undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  const buildPrisma = (config: any) => ({
    hospitalMirrorConfig: {
      findUnique: jest.fn(() => Promise.resolve(config)),
    },
  });

  it('sin header Authorization → 401', async () => {
    const guard = new MirrorAgentGuard(buildPrisma(null) as any);
    await expect(guard.canActivate(buildContext(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token con formato inválido → 401', async () => {
    const guard = new MirrorAgentGuard(buildPrisma(null) as any);
    await expect(
      guard.canActivate(buildContext('Bearer no-es-un-token-valido')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('organización sin HospitalMirrorConfig → 401', async () => {
    const token = generateAgentToken('org-1');
    const guard = new MirrorAgentGuard(buildPrisma(null) as any);
    await expect(
      guard.canActivate(buildContext(`Bearer ${token}`)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('espejo deshabilitado (enabled=false) → 401 aunque el token sea correcto', async () => {
    const token = generateAgentToken('org-1');
    const prisma = buildPrisma({
      id: 'cfg1',
      organizationId: 'org-1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: {},
      enabled: false,
      agentTokenHash: hashAgentToken(token),
    });
    const guard = new MirrorAgentGuard(prisma as any);
    await expect(
      guard.canActivate(buildContext(`Bearer ${token}`)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token que no coincide con el hash guardado → 401', async () => {
    const realToken = generateAgentToken('org-1');
    const impostorToken = generateAgentToken('org-1');
    const prisma = buildPrisma({
      id: 'cfg1',
      organizationId: 'org-1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: {},
      enabled: true,
      agentTokenHash: hashAgentToken(realToken),
    });
    const guard = new MirrorAgentGuard(prisma as any);
    await expect(
      guard.canActivate(buildContext(`Bearer ${impostorToken}`)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token válido + espejo habilitado → pasa y cuelga mirrorConfig en el request', async () => {
    const token = generateAgentToken('org-1');
    const prisma = buildPrisma({
      id: 'cfg1',
      organizationId: 'org-1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: { hisCatalog: 'ESEHSVP' },
      enabled: true,
      agentTokenHash: hashAgentToken(token),
    });
    const guard = new MirrorAgentGuard(prisma as any);
    const context = buildContext(`Bearer ${token}`);

    const activated = await guard.canActivate(context);

    expect(activated).toBe(true);
    const request = (context.switchToHttp().getRequest as any)();
    expect(request.mirrorConfig).toEqual({
      id: 'cfg1',
      organizationId: 'org-1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: { hisCatalog: 'ESEHSVP' },
    });
  });
});
