import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@antigravity/database';
import { ROLES_KEY } from './roles.decorator';
import * as jwt from 'jsonwebtoken';

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

    const request = context.switchToHttp().getRequest();
    
    let token = '';
    if (request.cookies && request.cookies['auth_token']) {
      token = request.cookies['auth_token'];
    } else if (request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    } else if (request.headers.cookie) {
       const match = request.headers.cookie.match(new RegExp('(^| )auth_token=([^;]+)'));
       if (match) token = match[2];
    }

    if (!token) {
      console.log('RolesGuard: No token provided');
      throw new ForbiddenException('A token must be provided for analytics');
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'clave-secreta-hospital-san-vicente-2026') as any;
      request.user = decoded;
      console.log('RolesGuard: Token decoded user:', request.user);
    } catch (e) {
      console.log('RolesGuard: Invalid token error:', e.message);
      throw new ForbiddenException('Invalid token');
    }

    const user = request.user;
    if (!user) {
      console.log('RolesGuard: User is undefined');
      throw new ForbiddenException('A valid token must be provided');
    }

    if (user.role !== 'SUPER_ADMIN' && !user.organizationId) {
      console.log('RolesGuard: User rejected due to missing organizationId. User has:', user.organizationId);
      throw new ForbiddenException('Este usuario no pertenece a ninguna organización válida u organización inactiva.');
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      console.log('RolesGuard: User rejected role check. Required:', requiredRoles, 'Has:', user.role);
      throw new ForbiddenException('You do not have the required role to access this resource');
    }

    console.log('RolesGuard: API Request Approved.');
    return true;
  }
}
