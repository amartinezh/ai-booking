import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Payload del JWT que RolesGuard deja en `request.user`.
 * Se firma en el login del web (apps/web/app/actions/auth.ts).
 */
export interface JwtUserPayload {
  userId: string;
  email: string;
  role: string;
  organizationId?: string | null;
}

/**
 * Usuario autenticado extraído del token. Para operaciones con valor legal
 * (firmas digitales, adendas) el actor debe salir SIEMPRE de aquí y nunca del
 * body de la request, que es suplantable.
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): JwtUserPayload => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtUserPayload }>();
    return request.user as JwtUserPayload;
  },
);
