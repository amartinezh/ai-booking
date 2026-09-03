import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUserPayload } from './current-user.decorator';

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtUserPayload }>();
    // Extraemos el organizationId parseado previamente por el RolesGuard u otro middleware
    return request.user?.organizationId;
  },
);
