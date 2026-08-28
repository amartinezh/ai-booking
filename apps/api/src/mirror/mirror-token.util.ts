import * as crypto from 'crypto';

/**
 * Tokens de agente: `mirror_<organizationId>_<secreto aleatorio>`. El prefijo
 * con el organizationId permite al guard resolver qué HospitalMirrorConfig
 * cargar sin una tabla de lookup adicional; el secreto es lo único que se
 * hashea y compara — el organizationId por sí solo nunca autentica nada.
 */
const TOKEN_PREFIX = 'mirror';

export function generateAgentToken(organizationId: string): string {
  const secret = crypto.randomBytes(32).toString('hex');
  return `${TOKEN_PREFIX}_${organizationId}_${secret}`;
}

export function parseAgentToken(
  token: string,
): { organizationId: string; secret: string } | null {
  const parts = token.split('_');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const [, organizationId, secret] = parts;
  if (!organizationId || !secret) return null;
  return { organizationId, secret };
}

/** Hash de un solo sentido (SHA-256) — nunca se desencripta, solo se compara. */
export function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Comparación en tiempo constante — evita timing attacks sobre el hash. */
export function verifyAgentToken(token: string, storedHash: string): boolean {
  const candidate = hashAgentToken(token);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
