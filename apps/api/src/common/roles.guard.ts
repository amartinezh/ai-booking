import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@agenia/database';
import { ROLES_KEY } from './roles.decorator';
import * as jwt from 'jsonwebtoken';
import type { JwtUserPayload } from './current-user.decorator';
import { getErrorMessage } from './error-message.util';

/** Lo único que este guard necesita leer/escribir de la request HTTP. */
interface GuardedRequest {
  cookies?: Record<string, string>;
  headers: { authorization?: string; cookie?: string };
  user?: JwtUserPayload;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
      console.log('RolesGuard: No token provided');
      throw new ForbiddenException('A token must be provided for analytics');
    }

    // SIN fallback hardcodeado: un secreto en el repo permitiría a cualquiera
    // forjar tokens de cualquier clínica. Sin la variable, se rechaza todo.
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error(
        'RolesGuard: JWT_SECRET no está configurado — se rechaza toda autenticación. Defina la variable de entorno (mismo valor que el web).',
      );
      throw new ForbiddenException(
        'Autenticación no disponible: el servidor no tiene JWT_SECRET configurado.',
      );
    }

    try {
      request.user = jwt.verify(token, jwtSecret) as JwtUserPayload;
      console.log('RolesGuard: Token decoded user:', request.user);
    } catch (e: unknown) {
      console.log('RolesGuard: Invalid token error:', getErrorMessage(e));
      throw new ForbiddenException('Invalid token');
    }

    const user = request.user;
    if (!user) {
      console.log('RolesGuard: User is undefined');
      throw new ForbiddenException('A valid token must be provided');
    }

    if (user.role !== 'SUPER_ADMIN' && !user.organizationId) {
      console.log(
        'RolesGuard: User rejected due to missing organizationId. User has:',
        user.organizationId,
      );
      throw new ForbiddenException(
        'Este usuario no pertenece a ninguna organización válida u organización inactiva.',
      );
    }

    const hasRole = requiredRoles.includes(user.role as Role);
    if (!hasRole) {
      console.log(
        'RolesGuard: User rejected role check. Required:',
        requiredRoles,
        'Has:',
        user.role,
      );
      throw new ForbiddenException(
        'You do not have the required role to access this resource',
      );
    }

    console.log('RolesGuard: API Request Approved.');
    return true;
  }
}
