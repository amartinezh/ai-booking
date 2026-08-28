import {
  generateAgentToken,
  hashAgentToken,
  parseAgentToken,
  verifyAgentToken,
} from './mirror-token.util';

describe('mirror-token.util', () => {
  it('generateAgentToken → parseAgentToken recupera el organizationId', () => {
    const token = generateAgentToken('org-123');
    const parsed = parseAgentToken(token);
    expect(parsed?.organizationId).toBe('org-123');
    expect(parsed?.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parseAgentToken rechaza formato inválido (sin prefijo, sin partes)', () => {
    expect(parseAgentToken('no-es-un-token')).toBeNull();
    expect(parseAgentToken('otraCosa_org_secreto')).toBeNull();
    expect(parseAgentToken('mirror_soloOrg')).toBeNull();
  });

  it('verifyAgentToken acepta el token correcto contra su propio hash', () => {
    const token = generateAgentToken('org-1');
    const hash = hashAgentToken(token);
    expect(verifyAgentToken(token, hash)).toBe(true);
  });

  it('verifyAgentToken rechaza un token distinto (aunque comparta el mismo organizationId)', () => {
    const token = generateAgentToken('org-1');
    const hash = hashAgentToken(token);
    const otherToken = generateAgentToken('org-1');
    expect(verifyAgentToken(otherToken, hash)).toBe(false);
  });

  it('verifyAgentToken rechaza un hash de longitud distinta sin lanzar', () => {
    expect(verifyAgentToken('mirror_org_abc', 'ff')).toBe(false);
  });
});
