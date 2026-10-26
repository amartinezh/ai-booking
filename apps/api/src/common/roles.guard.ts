import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@agenia/database';
import { motivoSesionInvalida } from '@agenia/shared';
import { ROLES_KEY } from './roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import * as jwt from 'jsonwebtoken';
import type { JwtUserPayload } from './current-user.decorator';
import { getErrorMessage } from './error-message.util';

/** Lo único que este guard necesita leer/escribir de la request HTTP. */
interface GuardedRequest {
  cookies?: Record<string, string>;
  headers: { authorization?: string; cookie?: string };
  user?: JwtUserPayload;
}

/**
 * 🔒 Lo que este guard deja en los logs NUNCA incluye el contenido del token: el
 * payload trae el correo del usuario, y el journal de la API no es un lugar para
 * datos personales (plan del rastreo, pendiente de producción #11). Antes se
 * imprimía el usuario completo en CADA petición autenticada. Ahora:
 *   · petición aprobada → nada (era una línea por request: ruido y datos);
 *   · rechazo → una advertencia con el rol exigido y el que trae, sin identidad;
 *   · sin token → debug (lo dispara cualquier escaneo, no es un incidente).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  /**
   * `prisma` lo inyecta Nest siempre en la API (PrismaModule es global y todos
   * los servicios lo usan). Es `@Optional` solo para las pruebas que arman un
   * módulo con el controlador y sin base; si alguna vez faltara de verdad, queda
   * un error en el registro al crear el guard.
   */
  constructor(
    private reflector: Reflector,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    if (!prisma && process.env.NODE_ENV === 'production') {
      this.logger.error(
        'RolesGuard sin PrismaService: no se están comprobando las sesiones cerradas.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();

    let token = '';
    if (request.cookies?.['auth_token']) {
      token = request.cookies['auth_token'];
    } else if (request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    } else if (request.headers.cookie) {
      const match = /(^| )auth_token=([^;]+)/.exec(request.headers.cookie);
      if (match) token = match[2];
    }

    if (!token) {
      this.logger.debug('Petición rechazada: sin token.');
      throw new ForbiddenException('A token must be provided for analytics');
    }

    // SIN fallback hardcodeado: un secreto en el repo permitiría a cualquiera
    // forjar tokens de cualquier clínica. Sin la variable, se rechaza todo.
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      this.logger.error(
        'JWT_SECRET no está configurado — se rechaza toda autenticación. Defina la variable de entorno (mismo valor que el web).',
      );
      throw new ForbiddenException(
        'Autenticación no disponible: el servidor no tiene JWT_SECRET configurado.',
      );
    }

    try {
      request.user = jwt.verify(token, jwtSecret) as JwtUserPayload;
    } catch (e: unknown) {
      // El motivo de la librería («jwt expired», «invalid signature»), nunca el token.
      this.logger.warn(`Token rechazado: ${getErrorMessage(e)}.`);
      throw new ForbiddenException('Invalid token');
    }

    const user = request.user;
    if (!user) {
      this.logger.warn('Token válido pero sin usuario.');
      throw new ForbiddenException('A valid token must be provided');
    }

    if (user.role !== 'SUPER_ADMIN' && !user.organizationId) {
      this.logger.warn(`Rechazado: rol ${user.role} sin organización.`);
      throw new ForbiddenException(
        'Este usuario no pertenece a ninguna organización válida u organización inactiva.',
      );
    }

    const hasRole = requiredRoles.includes(user.role as Role);
    if (!hasRole) {
      this.logger.warn(
        `Rechazado por rol: exige ${requiredRoles.join('|')}, trae ${user.role}.`,
      );
      throw new ForbiddenException(
        'You do not have the required role to access this resource',
      );
    }

    if (!this.prisma) return true;
    return this.sesionVigente(user);
  }

  /**
   * 🔐 2026-10-27: la firma sola no basta. La cuenta tiene que seguir existiendo,
   * con el mismo rol y la misma clínica, la clínica activa y sin un «cerrar
   * sesiones» posterior al ingreso (misma regla que la web: @agenia/shared,
   * `motivoSesionInvalida`). Si la base no responde, se rechaza.
   */
  private async sesionVigente(user: JwtUserPayload): Promise<boolean> {
    let motivo: string | null;
    try {
      const u = user.userId
        ? await this.prisma!.user.findUnique({
            where: { id: user.userId },
            select: {
              role: true,
              organizationId: true,
              sessionsRevokedAt: true,
              organization: { select: { isActive: true } },
            },
          })
        : null;
      motivo = motivoSesionInvalida(
        user,
        u
          ? {
              role: u.role,
              organizationId: u.organizationId,
              sessionsRevokedAt: u.sessionsRevokedAt,
              clinicaActiva: u.organization ? u.organization.isActive : null,
            }
          : null,
      );
    } catch (e: unknown) {
      this.logger.error(
        `No se pudo comprobar la sesión en la base: ${getErrorMessage(e)}.`,
      );
      motivo = 'BASE_NO_RESPONDE';
    }
    if (motivo) {
      // El motivo, nunca la identidad (ver arriba).
      this.logger.warn(`Sesión rechazada: ${motivo}.`);
      throw new ForbiddenException(
        'La sesión ya no es válida. Vuelva a ingresar.',
      );
    }
    return true;
  }
}
