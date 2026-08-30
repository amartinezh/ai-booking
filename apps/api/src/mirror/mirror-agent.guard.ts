import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { parseAgentToken, verifyAgentToken } from './mirror-token.util';

export interface MirrorAgentRequest {
  mirrorConfig: {
    id: string;
    organizationId: string;
    driverKey: string;
    driverConfig: unknown;
  };
}

/**
 * Autenticación de los endpoints /mirror/* — NO es un usuario con JWT (eso es
 * RolesGuard), es un agente on-premise con un token de larga vida. El guard:
 *   1. extrae organizationId del propio token (ver mirror-token.util.ts),
 *   2. carga el HospitalMirrorConfig de esa organización,
 *   3. exige enabled=true y compara el hash en tiempo constante,
 *   4. cuelga la config resuelta en request.mirrorConfig para los handlers.
 *
 * `enabled=false` corta el acceso inmediatamente — es el interruptor de
 * emergencia descrito en el plan (§9 Seguridad: "revocación inmediata").
 */
@Injectable()
export class MirrorAgentGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<import('express').Request & MirrorAgentRequest>();

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('Falta el token del agente.');
    }

    const parsed = parseAgentToken(token);
    if (!parsed) {
      throw new UnauthorizedException('Formato de token de agente inválido.');
    }

    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId: parsed.organizationId },
    });

    if (!config || !config.enabled || !config.agentTokenHash) {
      throw new UnauthorizedException(
        'Espejo no habilitado o token no configurado para esta organización.',
      );
    }

    if (!verifyAgentToken(token, config.agentTokenHash)) {
      throw new UnauthorizedException('Token de agente inválido.');
    }

    // driverConfig guarda credenciales del HIS (§9 del plan: "nube: patrón
    // existente de credenciales cifradas"). Desde que existe esta guarda se
    // persiste cifrado (string `iv:authTag:cipher`, ver CryptoService) — si
    // llega como objeto es data legada de antes de este cambio.
    const rawDriverConfig = config.driverConfig;
    const driverConfig =
      typeof rawDriverConfig === 'string'
        ? this.crypto.decryptJson(rawDriverConfig)
        : rawDriverConfig;

    request.mirrorConfig = {
      id: config.id,
      organizationId: config.organizationId,
      driverKey: config.driverKey,
      driverConfig,
    };

    return true;
  }
}
