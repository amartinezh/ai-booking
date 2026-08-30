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

  // driverConfig legado (objetos planos en las specs de arriba) nunca pasa
  // por decryptJson — solo lo hace cuando el valor guardado es un string
  // cifrado (ver mirror-agent.guard.ts). Un mock básico basta aquí.
  const buildCrypto = (decryptJsonImpl?: (v: string) => unknown) => ({
    decryptJson: jest.fn(decryptJsonImpl ?? (() => ({}))),
  });

  it('sin header Authorization → 401', async () => {
    const guard = new MirrorAgentGuard(
      buildPrisma(null) as any,
      buildCrypto() as any,
    );
    await expect(guard.canActivate(buildContext(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token con formato inválido → 401', async () => {
    const guard = new MirrorAgentGuard(
      buildPrisma(null) as any,
      buildCrypto() as any,
    );
    await expect(
      guard.canActivate(buildContext('Bearer no-es-un-token-valido')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('organización sin HospitalMirrorConfig → 401', async () => {
    const token = generateAgentToken('org-1');
    const guard = new MirrorAgentGuard(
      buildPrisma(null) as any,
      buildCrypto() as any,
    );
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
    const guard = new MirrorAgentGuard(prisma as any, buildCrypto() as any);
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
    const guard = new MirrorAgentGuard(prisma as any, buildCrypto() as any);
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
    const crypto = buildCrypto();
    const guard = new MirrorAgentGuard(prisma as any, crypto as any);
    const context = buildContext(`Bearer ${token}`);

    const activated = await guard.canActivate(context);

    expect(activated).toBe(true);
    expect(crypto.decryptJson).not.toHaveBeenCalled();
    const request = (context.switchToHttp().getRequest as any)();
    expect(request.mirrorConfig).toEqual({
      id: 'cfg1',
      organizationId: 'org-1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: { hisCatalog: 'ESEHSVP' },
    });
  });

  it('driverConfig cifrado (string) → se descifra antes de colgarlo en el request', async () => {
    const token = generateAgentToken('org-1');
    const decrypted = { server: '192.168.1.16', port: 1433, user: 'agenia_sync' };
    const prisma = buildPrisma({
      id: 'cfg1',
      organizationId: 'org-1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: 'iv-hex:tag-hex:cipher-hex',
      enabled: true,
      agentTokenHash: hashAgentToken(token),
    });
    const crypto = buildCrypto((v) => {
      expect(v).toBe('iv-hex:tag-hex:cipher-hex');
      return decrypted;
    });
    const guard = new MirrorAgentGuard(prisma as any, crypto as any);
    const context = buildContext(`Bearer ${token}`);

    await guard.canActivate(context);

    expect(crypto.decryptJson).toHaveBeenCalledWith('iv-hex:tag-hex:cipher-hex');
    const request = (context.switchToHttp().getRequest as any)();
    expect(request.mirrorConfig.driverConfig).toEqual(decrypted);
  });
});
