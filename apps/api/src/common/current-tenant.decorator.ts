import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    // Extraemos el organizationId parseado previamente por el RolesGuard u otro middleware
    return request.user?.organizationId;
  },
);
